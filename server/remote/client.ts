import { parseRemoteWorkspaceTarget } from '@/lib/workspace-config'
import { decodeJwt } from 'jose'
import { Mutex } from 'async-mutex'
import { lock } from 'proper-lockfile'
import { z } from 'zod'
import { access as fileAccess, chmod, mkdir, rename, rm } from 'node:fs/promises'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { canUseDataDir, DATA_DIR } from '../data-dir'
import { isBundled } from '../package-paths'
import { allowedCloudRequest, cloudRoutes } from './routes'
import { controlBroker } from './broker-client'
import { CloudSignInRequired } from './errors'
import {
  agentCredentialsSchema,
  agentAuthorization,
  agentJoinBody,
  createAgentKeys,
  agentClientSchema
} from './agent'

export type RemoteRequestOptions = {
  method?: string
  body?: string | Blob | Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>
  /** Byte length of a stream body, so the upload keeps a known length. */
  contentLength?: string
  signal?: AbortSignal
  contentType?: string
}
export type RemoteLogin = 'human' | 'agent'
/** A Cloud answer, and which kind of login sent the request. */
export type RemoteReply = { response: Response; agent: boolean }
/** A running Moi server that sends listed Cloud requests with its own login.
 * Both calls answer undefined when no such server is running. */
export type RemoteBroker = {
  info(): Promise<{ url: string; login?: RemoteLogin } | undefined>
  fetch(path: string, options: RemoteRequestOptions): Promise<RemoteReply | undefined>
}

export { CloudSignInRequired }

const humanCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  url: z.string().min(1),
  clientId: z.string().min(1)
})
const credentialsSchema = z.union([agentCredentialsSchema, humanCredentialsSchema])
type Credentials = z.infer<typeof credentialsSchema>
const isAgent = (value: Credentials): value is z.infer<typeof agentCredentialsSchema> =>
  'kind' in value && value.kind === 'agent'
const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1)
})
const deviceSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri_complete: z.url(),
  expires_in: z.number().positive().max(3600),
  interval: z.number().positive().max(60).default(5)
})
const humanProfileSchema = z
  .object({ id: z.string(), name: z.string(), email: z.string() })
  .passthrough()
const agentProfileSchema = z.object({
  id: z.string(),
  type: z.literal('agent'),
  name: z.string(),
  client: agentClientSchema
})
const profileSchema = z.union([agentProfileSchema, humanProfileSchema])
const workspacesSchema = z.object({
  workspaces: z.array(z.object({ id: z.string(), owner: humanProfileSchema }))
})
const remoteSchema = z.object({
  url: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  managed: z.boolean().optional()
})
const configSchema = z.object({ remote: remoteSchema.optional() })
type RemoteConfig = { url: string; clientId: string; managed: boolean }
export type Profile = z.infer<typeof profileSchema>
export type RemoteWorkspace = { id: string; owner: z.infer<typeof humanProfileSchema> }
export type RemoteStatus = { me: Profile; workspaces: RemoteWorkspace[] }
const CLOUD_URL = 'https://moi.computer/cloud'
const LEGACY_ORIGIN = 'https://run.moi.computer'

function canonicalCloudUrl(url: string) {
  return url.replace(/\/+$/, '') === LEGACY_ORIGIN + '/cloud' ? CLOUD_URL : url
}

export function resolveRemoteConfig(
  remote: z.infer<typeof remoteSchema>,
  directory = DATA_DIR
): RemoteConfig {
  if (!isBundled && !remote.url) {
    throw new Error(
      `Set remote.url in ${join(directory, 'config.json')} to use Moi Cloud from source\n` +
        'For example, http://localhost:8787/cloud'
    )
  }
  const url = new URL(remote.url ?? CLOUD_URL)
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error('Remote URL must use HTTPS (HTTP is allowed for localhost)')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Cloud URL must not contain credentials, a query, or a fragment')
  }
  return {
    url: canonicalCloudUrl(url.href.replace(/\/+$/, '')),
    clientId: remote.clientId ?? 'moi-cli',
    managed: remote.managed === true
  }
}

/** Each client owns one data directory. Tests use an isolated directory.
 *
 * A request uses the login saved in that directory. Given a broker, a caller
 * with no readable login of its own asks the running Moi server to send the
 * request instead, so the agent's OS user on a managed machine never holds a
 * credential. With no login and no server, the caller is signed out.
 */
export function createRemoteClient(directory: string, broker?: RemoteBroker) {
  const authFile = join(directory, 'remote-auth.json')
  const mutex = new Mutex()
  const pendingFile = join(directory, 'remote-agent-pending.json')
  const ownLogin = () =>
    fileAccess(authFile, constants.R_OK).then(
      () => true,
      () => false
    )
  // Sign-in and changes to the account belong to whoever holds the login.
  function ownDirectory() {
    if (!usable()) throw new Error('This is only available to the user that runs Moi')
  }
  // A directory that does not exist yet can still be created and used.
  function usable(): boolean {
    try {
      accessSync(directory, constants.R_OK | constants.W_OK | constants.X_OK)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
    }
  }

  async function json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    // A parser error can quote the response body, which may contain tokens.
    const parsed = schema.safeParse(await response.json().catch(() => undefined))
    if (!parsed.success) throw new Error('Cloud returned an invalid response')
    return parsed.data
  }

  async function remoteConfig(): Promise<RemoteConfig> {
    let raw: unknown = {}
    try {
      raw = await Bun.file(join(directory, 'config.json')).json()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Could not read Moi config.json')
    }
    const parsed = configSchema.safeParse(raw)
    if (!parsed.success) throw new Error('Invalid remote settings in config.json')
    return resolveRemoteConfig(parsed.data.remote ?? {}, directory)
  }

  async function post(config: RemoteConfig, path: string, values: Record<string, string>) {
    return fetch(`${config.url}/api/auth${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, ...values })
    })
  }

  async function readStoredCredentials(): Promise<Credentials> {
    let value: unknown
    try {
      value = await Bun.file(authFile).json()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new CloudSignInRequired('Sign in with moi remote login to see remote workspaces')
      throw new Error('Could not read remote credentials — run moi remote login')
    }
    const parsed = credentialsSchema.safeParse(value)
    if (!parsed.success) throw new Error('Invalid remote credentials — run moi remote login')
    return { ...parsed.data, url: canonicalCloudUrl(parsed.data.url) }
  }

  async function read(config: RemoteConfig): Promise<Credentials> {
    const credentials = await readStoredCredentials()
    if (credentials.url !== config.url || credentials.clientId !== config.clientId) {
      throw new Error('Your saved login is not valid — sign in again with `moi remote login`')
    }
    return credentials
  }

  async function writePrivate(path: string, value: unknown, assertLock: () => void) {
    const temporary = `${path}.${crypto.randomUUID()}.tmp`
    try {
      await Bun.write(temporary, JSON.stringify(value) + '\n', { mode: 0o600 })
      await chmod(temporary, 0o600)
      assertLock()
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async function save(
    response: Response,
    config: RemoteConfig,
    assertLock: () => void
  ): Promise<Credentials> {
    if (!response.ok)
      throw new Error(`Could not refresh login (${response.status}) — run moi remote login`)
    const value = await json(response, tokensSchema)
    const pair = {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      url: config.url,
      clientId: config.clientId
    }
    await writePrivate(authFile, pair, assertLock)
    return pair
  }

  // Only mutations take a cross-process lock. Heartbeats let later commands
  // recover a lock abandoned by a crash; the in-process mutex avoids retry delays.
  async function locked<T>(action: (assertLock: () => void) => Promise<T>): Promise<T> {
    return mutex.runExclusive(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      let compromised: Error | undefined
      const release = await lock(directory, {
        lockfilePath: `${authFile}.lock`,
        stale: 60_000,
        update: 10_000,
        retries: { retries: 80, factor: 1.5, minTimeout: 50, maxTimeout: 1000 },
        onCompromised: error => {
          compromised = error
        }
      })
      const assertLock = () => {
        if (compromised) throw new Error('Remote credentials lock was lost — retry the command')
      }
      try {
        return await action(assertLock)
      } finally {
        if (!compromised) await release()
      }
    })
  }

  async function login(
    announce: (url: string, code: string) => void | Promise<void>
  ): Promise<void> {
    const config = await remoteConfig()
    if (config.managed) throw new Error('Cloud manages sign-in on this machine')
    // A fresh human login can replace credentials for previous Cloud settings.
    // Inspect identity without authorizing those credentials for the new server.
    if ((await Bun.file(authFile).exists()) && isAgent(await readStoredCredentials()))
      throw new Error('Signed in as an agent — use a separate Moi data directory for human login')
    if (await Bun.file(pendingFile).exists())
      throw new Error('An agent join is pending — retry that invitation first')
    const response = await post(config, '/device/code', {
      scope: 'profile:read workspaces:read workspaces:access offline_access',
      resource: 'urn:moi:cloud'
    })
    if (!response.ok) throw new Error(`Could not start login (${response.status})`)
    const device = await json(response, deviceSchema)
    const verification = new URL(device.verification_uri_complete)
    if (
      verification.origin !== new URL(config.url).origin ||
      verification.username ||
      verification.password
    )
      throw new Error('Cloud returned a login URL on a different origin')
    await announce(verification.href, device.user_code)
    let interval = device.interval
    const deadline = Date.now() + device.expires_in * 1000
    while (Date.now() < deadline) {
      await Bun.sleep(interval * 1000)
      if (Date.now() >= deadline) break
      const token = await post(config, '/oauth2/token', {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: device.device_code
      })
      if (token.ok) {
        await locked(async assertLock => {
          if ((await Bun.file(authFile).exists()) && isAgent(await readStoredCredentials()))
            throw new Error(
              'An agent signed in while browser login was pending; agent credentials kept'
            )
          if (await Bun.file(pendingFile).exists())
            throw new Error('An agent join is pending; its keys were kept')
          return save(token, config, assertLock)
        })
        return
      }
      if (token.status === 429) {
        interval = Math.min(
          60,
          Math.max(interval + 5, Number(token.headers.get('retry-after')) || 0)
        )
        continue
      }
      const result = await json(token, z.object({ error: z.string() }))
      if (result.error === 'slow_down') interval = Math.min(60, interval + 5)
      else if (result.error !== 'authorization_pending')
        throw new Error(`Login failed (${token.status}) — run moi remote login again`)
    }
    throw new Error('Login expired — run moi remote login again')
  }

  async function logout(confirmed = false): Promise<void> {
    const config = await remoteConfig()
    if (config.managed) throw new Error('Cloud manages sign-in on this machine')
    await locked(async assertLock => {
      if (!(await Bun.file(authFile).exists())) {
        if (await Bun.file(pendingFile).exists())
          throw new Error(
            'An agent join is unfinished — retry the same invitation before logging out'
          )
        return
      }
      const pair = await read(config)
      if (isAgent(pair)) {
        if (!confirmed)
          throw new Error(
            'Logging out permanently revokes this agent login and deletes its local keys. It cannot be restored. Run moi remote logout --yes to confirm'
          )
        await answer(
          {
            response: await localSend(config, pair, 'api/agents/logout', jsonRequest({})),
            agent: true
          },
          z.object({ success: z.boolean() })
        )
        assertLock()
        await rm(authFile, { force: true })
        await rm(pendingFile, { force: true })
        return
      }
      const response = await post(config, '/oauth2/revoke', {
        token_type_hint: 'refresh_token',
        token: pair.refreshToken
      })
      if (!response.ok)
        throw new Error(`Logout failed (${response.status}); credentials kept so you can retry`)
      assertLock()
      await rm(authFile, { force: true })
    })
  }

  function fresh(pair: z.infer<typeof humanCredentialsSchema>): boolean {
    try {
      return (decodeJwt(pair.accessToken).exp ?? 0) * 1000 > Date.now() + 30_000
    } catch {
      return false
    }
  }

  async function access(config: RemoteConfig): Promise<Credentials> {
    const pair = await read(config)
    if (isAgent(pair) || fresh(pair)) return pair
    return locked(async assertLock => {
      const current = await read(config)
      if (isAgent(current) || fresh(current)) return current
      return save(
        await post(config, '/oauth2/token', {
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken
        }),
        config,
        assertLock
      )
    })
  }

  const jsonRequest = (body: unknown | undefined, method?: string): RemoteRequestOptions => ({
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    body: body === undefined ? undefined : JSON.stringify(body),
    contentType: 'application/json',
    signal: AbortSignal.timeout(30_000)
  })

  // The one place a credential meets a request. Answers with whatever Cloud
  // returned; callers decide what a failure status means.
  async function localSend(
    config: RemoteConfig,
    pair: Credentials,
    path: string,
    options: RemoteRequestOptions
  ): Promise<Response> {
    const url = new URL(path, config.url.replace(/\/+$/, '') + '/').href
    const method = options.method ?? 'GET'
    const limit = 16 * 1024 * 1024
    const tooLarge = () => new Error('Agent uploads are limited to 16 MiB')
    let body = options.body
    let authorization = isAgent(pair) ? '' : `Bearer ${pair.accessToken}`
    if (isAgent(pair)) {
      // Agent Auth signs the exact bytes, so they are read before sending.
      let bytes: string | Uint8Array<ArrayBuffer> = ''
      if (body instanceof ReadableStream) {
        if (Number(options.contentLength) > limit) throw tooLarge()
        const chunks: Uint8Array[] = []
        let size = 0
        for await (const chunk of body) {
          if ((size += chunk.byteLength) > limit) throw tooLarge()
          chunks.push(chunk)
        }
        bytes = new Uint8Array(Buffer.concat(chunks))
      } else if (body instanceof Blob) {
        if (body.size > limit) throw tooLarge()
        bytes = new Uint8Array(await body.arrayBuffer())
      } else if (body !== undefined) bytes = body
      if ((typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength) > limit)
        throw tooLarge()
      if (body !== undefined) body = bytes
      authorization = await agentAuthorization(pair, url, method, bytes)
    }
    return fetch(url, {
      method,
      body,
      redirect: 'error',
      signal: options.signal,
      headers: {
        authorization,
        ...(options.contentType ? { 'content-type': options.contentType } : {}),
        ...(body instanceof ReadableStream && options.contentLength
          ? { 'content-length': options.contentLength }
          : {})
      }
    })
  }

  /** Send a listed Cloud request with this directory's login, or through the
   * running Moi server when the caller has no login of its own. */
  async function send(path: string, options: RemoteRequestOptions = {}): Promise<RemoteReply> {
    const { access: allowed } = allowedCloudRequest(options.method ?? 'GET', path)
    if (allowed === 'own login') ownDirectory()
    else if (broker && !(await ownLogin())) {
      const brokered = await broker.fetch(path, options)
      if (brokered) return brokered
      if (!usable()) throw new Error('Moi is not running, so this user cannot reach Moi Cloud')
    }
    const config = await remoteConfig()
    const pair = await access(config)
    return { response: await localSend(config, pair, path, options), agent: isAgent(pair) }
  }

  async function answer<T>({ response, agent }: RemoteReply, schema: z.ZodType<T>): Promise<T> {
    if (response.status === 401) {
      await response.body?.cancel()
      throw new Error(
        agent ? 'Agent login is no longer valid' : 'Sign-in expired — run moi remote login'
      )
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Cloud request failed (${response.status})`)
    }
    return json(response, schema)
  }
  async function request<T>(
    path: string,
    body: unknown | undefined,
    schema: z.ZodType<T>,
    method?: string
  ) {
    return answer(await send(path, jsonRequest(body, method)), schema)
  }

  /** The saved login's kind and Cloud URL, for a server lending it to callers. */
  async function loginInfo(): Promise<{ url: string; login?: RemoteLogin }> {
    const config = await remoteConfig()
    try {
      return { url: config.url, login: isAgent(await read(config)) ? 'agent' : 'human' }
    } catch (error) {
      if (error instanceof CloudSignInRequired) return { url: config.url }
      throw error
    }
  }
  // The login requests go out with: this directory's, else the running server's.
  async function activeLogin(): Promise<{ url: string; login?: RemoteLogin }> {
    if (broker && !(await ownLogin())) {
      const info = await broker.info()
      if (info) return { ...info, url: canonicalCloudUrl(info.url) }
    }
    return loginInfo()
  }
  async function cloudUrl(): Promise<string> {
    return (await activeLogin()).url
  }
  const invitationSchema = z.object({
    id: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
    inviter: humanProfileSchema,
    expiresAt: z.string()
  })
  async function invitations() {
    return (
      await request(
        cloudRoutes.invitations.path(),
        undefined,
        z.object({ invitations: z.array(invitationSchema) })
      )
    ).invitations
  }
  function invitation(value: string, config: { url: string }) {
    if (!value.includes('://')) {
      if (!/^[A-Za-z0-9_-]{1,240}$/.test(value)) throw new Error('Invalid invitation ID')
      return { id: value, token: undefined, agent: false }
    }
    const url = new URL(value)
    const root = new URL(config.url)
    if (config.url === CLOUD_URL && url.origin === LEGACY_ORIGIN) url.host = root.host
    const prefix = root.pathname.replace(/\/$/, '')
    const match = new RegExp(
      `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(agent-invite|invite)/([A-Za-z0-9_-]{1,240})$`
    ).exec(url.pathname)
    const token = url.searchParams.get('token')
    if (
      url.origin !== root.origin ||
      url.username ||
      url.password ||
      !match ||
      !token ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)
    )
      throw new Error('Use an invitation URL from your configured Cloud URL')
    return { id: match[2]!, token, agent: match[1] === 'agent-invite' }
  }
  const accepted = z.object({
    success: z.literal(true),
    remote: z
      .object({ user_id: z.string(), workspace_id: z.string() })
      .transform(parseRemoteWorkspaceTarget),
    membershipId: z.string()
  })
  const acceptPath = (id: string) => cloudRoutes.acceptInvitation.path(id)
  async function accept(value: string, name?: string, client?: string) {
    if (client !== undefined && !agentClientSchema.max(25).safeParse(client).success)
      throw new Error(
        'Invalid client — use up to 25 characters, with lowercase letters, digits, and single hyphens between words'
      )
    ownDirectory()
    const config = await remoteConfig(),
      target = invitation(value, config)
    const acceptWith = async (pair: Credentials) =>
      answer(
        {
          response: await localSend(
            config,
            pair,
            acceptPath(target.id),
            jsonRequest(target.token ? { token: target.token } : {})
          ),
          agent: isAgent(pair)
        },
        accepted
      )
    if (await Bun.file(authFile).exists()) {
      const saved = await read(config)
      if (!isAgent(saved) && (target.agent || name !== undefined || client !== undefined))
        throw new Error(
          'Already signed in as a human — use a separate Moi data directory for this agent'
        )
      return acceptWith(await access(config))
    }
    if (!target.agent)
      throw new CloudSignInRequired(
        'Sign in with moi remote login before accepting a human invitation'
      )
    if (config.managed) throw new Error('Cloud manages sign-in on this machine')
    return locked(async assertLock => {
      if (await Bun.file(authFile).exists()) {
        const pair = await read(config)
        if (!isAgent(pair))
          throw new Error(
            'Already signed in as a human — use a separate Moi data directory for this agent'
          )
        return acceptWith(pair)
      }
      if (!target.token) throw new Error('First agent acceptance requires an invitation URL')
      const fingerprint = new Bun.CryptoHasher('sha256').update(target.token).digest('hex')
      const pendingSchema = z.object({
        fingerprint: z.string(),
        name: z.string(),
        client: agentClientSchema,
        keys: agentCredentialsSchema
      })
      let pending: z.infer<typeof pendingSchema>
      if (await Bun.file(pendingFile).exists()) {
        const saved = pendingSchema.safeParse(
          await Bun.file(pendingFile)
            .json()
            .catch(() => undefined)
        )
        if (!saved.success)
          throw new Error('Could not read pending agent keys; credentials were kept')
        pending = saved.data
        pending.keys.url = canonicalCloudUrl(pending.keys.url)
        if (
          pending.fingerprint !== fingerprint ||
          pending.keys.url !== config.url ||
          pending.keys.clientId !== config.clientId
        )
          throw new Error(
            'Retry the original pending agent invitation before switching accounts or clouds'
          )
      } else {
        if (!name?.trim() || name.trim().length > 80 || !client)
          throw new Error(
            'Create your agent identity with --name and --client\n' +
              '--name: your display name, shown to workspace members (for example, "Research assistant")\n' +
              '--client: the app you run in (for example, dot or grok-bot)\n' +
              'Retry: moi remote accept "<invitation-url>" --name "Research assistant" --client grok-bot'
          )
        pending = {
          fingerprint,
          name: name.trim(),
          client: agentClientSchema.parse(client),
          keys: await createAgentKeys(config)
        }
        await writePrivate(pendingFile, pending, assertLock)
      }
      const body = await agentJoinBody(pending.keys, target.token, pending.name, pending.client)
      const response = await fetch(`${config.url}/api/agents/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000)
      })
      if (!response.ok)
        throw new Error(
          `Agent acceptance failed (${response.status}); keys kept so you can retry the same invitation`
        )
      const joined = await json(
        response,
        accepted.extend({ agentId: z.string(), hostId: z.string() })
      )
      if (joined.agentId !== pending.keys.agentId || joined.hostId !== pending.keys.hostId)
        throw new Error('Cloud returned an unexpected agent identity')
      await writePrivate(authFile, pending.keys, assertLock)
      await rm(pendingFile, { force: true })
      return joined
    })
  }
  async function renameAgent(name: string) {
    ownDirectory()
    if (!isAgent(await access(await remoteConfig()))) throw new Error('This command is for agents')
    return request(cloudRoutes.me.path(), { name }, agentProfileSchema, 'PATCH')
  }
  async function leave(ownerId: string, workspaceId: string) {
    return request(
      cloudRoutes.leave.path({ user_id: ownerId, workspace_id: workspaceId }),
      {},
      z.object({ success: z.literal(true) })
    )
  }

  const done = z.object({ success: z.literal(true) })
  async function clearWorkspaceAccess(workspaceId: string) {
    return request(cloudRoutes.workspace.path(workspaceId), undefined, done, 'DELETE')
  }

  /** Read accepted remote workspaces using this machine's configured cloud login.
   * Refreshes credentials automatically; requires no browser or running Moi server.
   */
  async function fetchRemoteWorkspaces(): Promise<RemoteWorkspace[]> {
    return (await request(cloudRoutes.remoteWorkspaces.path(), undefined, workspacesSchema))
      .workspaces
  }

  /** Send a request built from `cloudRoutes` and answer with Cloud's response.
   * Bytes are preserved and writes are never automatically replayed. */
  async function remoteRequest(path: string, options: RemoteRequestOptions = {}) {
    const { response } = await send(path, options)
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(
        response.status === 401
          ? 'Cloud login expired or revoked — run moi remote login'
          : `Remote operation failed (${response.status})`
      )
    }
    return response
  }

  async function remoteStatus(): Promise<RemoteStatus> {
    const [me, { workspaces }] = await Promise.all([
      request(cloudRoutes.me.path(), undefined, profileSchema),
      request(cloudRoutes.remoteWorkspaces.path(), undefined, workspacesSchema)
    ])
    return { me, workspaces }
  }

  return {
    remoteConfig,
    cloudUrl,
    loginInfo,
    send,
    login,
    logout,
    fetchRemoteWorkspaces,
    remoteRequest,
    remoteStatus,
    invitations,
    accept,
    renameAgent,
    leave,
    clearWorkspaceAccess
  }
}

// A data directory the caller named and can open is its own: it never borrows
// the running server's login. Standalone bots and tests rely on this.
const ownsDataDir = !!process.env.MOI_DATA_DIR && canUseDataDir()

export const {
  remoteConfig,
  cloudUrl,
  login,
  logout,
  fetchRemoteWorkspaces,
  remoteRequest,
  remoteStatus,
  invitations,
  accept,
  renameAgent,
  leave,
  clearWorkspaceAccess
} = createRemoteClient(DATA_DIR, ownsDataDir ? undefined : controlBroker)
