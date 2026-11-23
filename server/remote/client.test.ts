import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRemoteClient, resolveRemoteConfig } from './client'
import { cloudRoutes } from './routes'
import { createAgentKeys } from './agent'

const board = { user_id: 'alice', workspace_id: 'board' }

let directory: string
let server: ReturnType<typeof Bun.serve>
let client: ReturnType<typeof createRemoteClient>
let refreshes: number
let requests: number
let revoked: boolean
let responseMode: 'normal' | 'invalid' | 'reject' | 'redirect'
const jwt = (exp: number) =>
  `e30.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
const cloudUrl = () => server.url.origin + '/custom/cloud'

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'moi-remote-'))
  refreshes = 0
  requests = 0
  revoked = false
  responseMode = 'normal'
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests++
      const path = new URL(request.url).pathname
      expect(path.startsWith('/custom/cloud/api/') || path.startsWith('/api/workspaces/')).toBe(
        true
      )
      if (responseMode === 'invalid') return new Response('{"access_token":"secret-example"')
      if (responseMode === 'reject') return new Response(null, { status: 401 })
      if (responseMode === 'redirect') return Response.redirect(server.url.origin + '/leak')
      if (path.endsWith('/device/code'))
        return Response.json({
          device_code: 'device',
          user_code: 'ABCD',
          verification_uri_complete: cloudUrl() + '/device?user_code=ABCD',
          expires_in: 10,
          interval: 1
        })
      if (path.endsWith('/oauth2/token')) {
        const data = await request.formData()
        expect(data.get('client_id')).toBe('moi-cli')
        if (data.get('grant_type') === 'refresh_token') {
          expect(data.get('refresh_token')).toBe('old-refresh')
          refreshes++
          await Bun.sleep(50) // Other callers arrive while rotation is in progress.
        } else {
          expect(data.get('device_code')).toBe('device')
        }
        return Response.json({
          access_token: jwt(Date.now() / 1000 + 3600),
          refresh_token: 'new-refresh'
        })
      }
      if (path.endsWith('/oauth2/revoke')) {
        expect((await request.formData()).get('token')).toBe('new-refresh')
        revoked = true
        return new Response(null, { status: 200 })
      }
      expect(request.headers.get('authorization')).toStartWith('Bearer ')
      if (path.startsWith('/api/workspaces/')) {
        expect(request.headers.get('cookie')).toBeNull()
        expect(request.headers.get('authorization')).not.toBe('Bearer untrusted')
        return Response.json({ ok: true })
      }
      if (path.endsWith('/me'))
        return Response.json({ id: 'u1', name: 'Test', email: 'test@example.com' })
      return Response.json({
        workspaces: [{ id: 'w1', owner: { id: 'u2', name: 'Owner', email: 'owner@example.com' } }]
      })
    }
  })
  client = createRemoteClient(directory)
  await config()
})
afterEach(async () => {
  server.stop(true)
  await rm(directory, { recursive: true, force: true })
})
async function config(overrides: { url?: string; clientId?: string; managed?: boolean } = {}) {
  await Bun.write(
    join(directory, 'config.json'),
    JSON.stringify({ remote: { url: cloudUrl() + '/', ...overrides } })
  )
}
async function credentials(exp = 1) {
  await Bun.write(
    join(directory, 'remote-auth.json'),
    JSON.stringify({
      accessToken: jwt(exp),
      refreshToken: 'old-refresh',
      url: cloudUrl(),
      clientId: 'moi-cli'
    })
  )
}
const stored = () => Bun.file(join(directory, 'remote-auth.json')).json()

test('refreshes once across concurrent reads, saves privately, and revokes on logout', async () => {
  await credentials()
  const results = await Promise.all([client.remoteStatus(), client.remoteStatus()])
  expect(refreshes).toBe(1)
  expect(results[0]?.workspaces[0]?.id).toBe('w1')
  expect((await stat(join(directory, 'remote-auth.json'))).mode & 0o777).toBe(0o600)
  expect(await stored()).toMatchObject({
    refreshToken: 'new-refresh',
    url: cloudUrl(),
    clientId: 'moi-cli'
  })
  await client.logout()
  expect(revoked).toBe(true)
  expect(await Bun.file(join(directory, 'remote-auth.json')).exists()).toBe(false)
})

test('serializes refresh rotation across separate CLI processes', async () => {
  await credentials()
  const code = `import {createRemoteClient} from ${JSON.stringify(new URL('./client.ts', import.meta.url).pathname)}; await createRemoteClient(${JSON.stringify(directory)}).remoteStatus()`
  const children = Array.from({ length: 3 }, () =>
    Bun.spawn([process.execPath, '-e', code], { stdout: 'pipe', stderr: 'pipe' })
  )
  const results = await Promise.all(
    children.map(async child => ({
      code: await child.exited,
      stderr: await new Response(child.stderr).text()
    }))
  )
  expect(results).toEqual(Array.from({ length: 3 }, () => ({ code: 0, stderr: '' })))
  expect(refreshes).toBe(1)
})

test('recovers an abandoned lock before refreshing', async () => {
  await credentials()
  const path = join(directory, 'remote-auth.json.lock')
  await mkdir(path)
  const earlier = new Date(Date.now() - 120_000)
  await utimes(path, earlier, earlier)
  expect((await client.remoteStatus()).me.id).toBe('u1')
  expect(refreshes).toBe(1)
})

test('fresh tokens use no mutation lock and the server helper makes one request', async () => {
  await credentials(Date.now() / 1000 + 3600)
  await mkdir(join(directory, 'remote-auth.json.lock'))
  expect((await client.fetchSharedWorkspaces())[0]?.id).toBe('w1')
  expect(requests).toBe(1)
  expect(refreshes).toBe(0)
})

test('browser approval binds credentials and loads the account', async () => {
  let code = ''
  await client.login((_url, value) => {
    code = value
  })
  expect(code).toBe('ABCD')
  expect(await stored()).toMatchObject({ url: cloudUrl(), clientId: 'moi-cli' })
  expect((await client.remoteStatus()).me.id).toBe('u1')
})

test('managed credentials can refresh but cannot be replaced by login or logout', async () => {
  await config({ managed: true })
  await credentials()
  expect((await client.remoteStatus()).me.id).toBe('u1')
  await expect(client.logout()).rejects.toThrow('Cloud manages sign-in')
  await expect(client.login(() => {})).rejects.toThrow('Cloud manages sign-in')
})

test('browser login replaces a human login bound to previous Cloud settings', async () => {
  await credentials()
  const previous = {
    ...(await stored()),
    url: 'https://previous.example/cloud',
    clientId: 'old-client'
  }
  await Bun.write(join(directory, 'remote-auth.json'), JSON.stringify(previous))
  await client.login(async () => {
    expect(await stored()).toEqual(previous)
  })
  expect(await stored()).toMatchObject({
    url: cloudUrl(),
    clientId: 'moi-cli',
    refreshToken: 'new-refresh'
  })
  expect(refreshes).toBe(0)
  expect((await client.remoteStatus()).me.id).toBe('u1')
})

test('browser login preserves agent credentials from another cloud, including during login', async () => {
  const agent = await createAgentKeys({
    url: 'https://previous.example/cloud',
    clientId: 'old-client'
  })
  const file = join(directory, 'remote-auth.json')
  await Bun.write(file, JSON.stringify(agent))
  await expect(client.login(() => {})).rejects.toThrow('Signed in as an agent')
  expect(requests).toBe(0)
  await rm(file)
  await expect(
    client.login(async () => {
      await Bun.write(file, JSON.stringify(agent))
    })
  ).rejects.toThrow('agent credentials kept')
  expect(await stored()).toEqual(agent)
})

test('changed URL, mount path, or client ID never receives saved credentials', async () => {
  await credentials()
  for (const overrides of [
    { url: 'https://different.example/cloud' },
    { url: server.url.origin + '/other' },
    { clientId: 'another-client' }
  ]) {
    await config(overrides)
    await expect(client.remoteStatus()).rejects.toThrow('sign in again with `moi remote login`')
    await expect(client.logout()).rejects.toThrow('sign in again with `moi remote login`')
  }
  expect(requests).toBe(0)
})

test('legacy credentials without an environment binding require sign-in', async () => {
  await Bun.write(
    join(directory, 'remote-auth.json'),
    JSON.stringify({ accessToken: jwt(1), refreshToken: 'secret-example' })
  )
  await expect(client.remoteStatus()).rejects.toThrow('Invalid remote credentials')
  expect(requests).toBe(0)
})

test('invalid token responses do not expose secrets or replace saved credentials', async () => {
  await credentials()
  const before = await stored()
  responseMode = 'invalid'
  await expect(client.remoteStatus()).rejects.toThrow('Cloud returned an invalid response')
  expect(await stored()).toEqual(before)
})

test('redirects are not followed with credentials', async () => {
  await credentials(Date.now() / 1000 + 3600)
  responseMode = 'redirect'
  await expect(client.fetchSharedWorkspaces()).rejects.toThrow()
  expect(requests).toBe(1)
})

test('failed logout keeps credentials so revocation can be retried', async () => {
  await credentials()
  responseMode = 'reject'
  await expect(client.logout()).rejects.toThrow('credentials kept')
  expect((await stored()).refreshToken).toBe('old-refresh')
})

test('validates and normalizes the configured Cloud URL', () => {
  expect(resolveRemoteConfig({ url: 'http://localhost:8787/custom/cloud/' }).url).toBe(
    'http://localhost:8787/custom/cloud'
  )
  for (const url of [
    'http://remote.example/cloud',
    'file:///cloud',
    'https://u:secret@example.com/cloud',
    'https://example.com/cloud?token=secret'
  ]) {
    expect(() => resolveRemoteConfig({ url })).toThrow()
  }
})

test('uses a saved legacy login on the canonical Cloud only', async () => {
  const legacy = 'https://run.moi.computer/cloud'
  const canonical = 'https://moi.computer/cloud'
  await credentials()
  await Bun.write(
    join(directory, 'remote-auth.json'),
    JSON.stringify({ ...(await stored()), url: legacy })
  )
  for (const url of [legacy + '/', canonical]) {
    await config({ url })
    expect(await client.loginInfo()).toEqual({ url: canonical, login: 'human' })
  }
  await config()
  await expect(client.loginInfo()).rejects.toThrow('Your saved login is not valid')
})

test('source runs require an explicit Cloud URL', async () => {
  await rm(join(directory, 'config.json'))
  await expect(client.loginInfo()).rejects.toThrow(
    `Set remote.url in ${join(directory, 'config.json')}`
  )
})

test('workspace content requests authenticate and refresh through the same client', async () => {
  await credentials()
  const response = await client.remoteRequest(cloudRoutes.config.path(board))
  expect(response.status).toBe(200)
  expect(refreshes).toBe(1)
})

test('requests that are not on the allowlist never reach Cloud', async () => {
  await credentials(Date.now() / 1000 + 3600)
  await expect(client.remoteRequest('/api/workspaces/alice:board/widgets')).rejects.toThrow(
    'not allowed'
  )
  await expect(client.send('api/cloud/dangerous-moi-action', { method: 'POST' })).rejects.toThrow(
    'not allowed'
  )
  expect(requests).toBe(0)
})

test('workspace content requests reject path escapes and authenticated redirects', async () => {
  await credentials(Date.now() / 1000 + 3600)
  await expect(client.remoteRequest('/api/workspaces/alice:board/../../leak')).rejects.toThrow(
    'not allowed'
  )
  responseMode = 'redirect'
  await expect(client.remoteRequest(cloudRoutes.config.path(board))).rejects.toThrow()
  expect(requests).toBe(1)
})
