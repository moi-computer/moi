// Local remote-workspace fixture and browser proxy.
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { connect } from 'node:net'
import { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'
import envPaths from 'env-paths'

import { colorForId } from '../lib/collab/colors'
import type { WorkspaceEntry, WorkspaceInfoResponse } from '../lib/types'
import { sameRemoteWorkspace, workspaceApiBase } from '../lib/workspace-config'
import { COLLAB_PROTOCOL_VERSION } from '../lib/collab/protocol'
import type { WorkspaceMember } from '../client/features/collab/members/types'

// Local-only Cloud fixture. State resets when the mock owner restarts.
type MockUser = Extract<WorkspaceMember, { type: 'user' }>
const mockTarget = { user_id: 'alice', workspace_id: 'owner-board' }
const initialMembers: WorkspaceMember[] = [
  { id: 'alice', type: 'user', name: 'Alice', email: 'alice@example.com', isAnonymous: false },
  {
    id: 'jamie',
    type: 'user',
    name: 'Jamie',
    email: 'jamie@example.com',
    isAnonymous: false,
    membershipId: 'member-jamie'
  },
  {
    id: 'launch-bot',
    type: 'agent',
    name: 'Pip',
    client: 'dot',
    membershipId: 'member-launch-bot'
  },
  {
    id: 'review-bot',
    type: 'agent',
    name: 'Cleo',
    client: 'duet',
    membershipId: 'member-review-bot'
  },
  {
    id: 'research-bot',
    type: 'agent',
    name: 'Jamie’s Grok',
    client: 'grok-bot',
    membershipId: 'member-research-bot'
  },
  {
    id: 'instinct',
    type: 'agent',
    name: 'Frankie',
    client: 'instinct',
    membershipId: 'member-instinct'
  },
  {
    id: 'muse',
    type: 'agent',
    name: 'Peach',
    client: 'muse',
    membershipId: 'member-muse'
  },
  {
    id: 'other',
    type: 'agent',
    name: 'Shipmate',
    client: 'town-assistant',
    membershipId: 'member-other'
  }
]
export function createMockRemoteInvitations() {
  const members = [...initialMembers]
  const acceptedInvites = new Set<string>()
  const invitations: { id: string; email: string; expiresAt: string }[] = []
  return async function (request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    const suffix = path.slice('/mock/sharing'.length)
    const viewerHeader = request.headers.get('x-moi-mock-viewer')
    if (!viewerHeader) return Response.json({ error: 'Sign in required' }, { status: 401 })
    const viewer = JSON.parse(decodeURIComponent(viewerHeader)) as MockUser
    const memberIndex = members.findIndex(
      member => member.type === 'user' && member.id === viewer.id
    )
    if (path === '/mock/cloud/api/workspaces/invitations' && request.method === 'GET')
      return Response.json({
        invitations:
          memberIndex >= 0 || acceptedInvites.has(viewer.id)
            ? []
            : [
                {
                  id: 'mock-owner-invite',
                  workspaceName: 'Product launch',
                  inviter: { name: 'Alice' }
                }
              ]
      })
    if (
      path === '/mock/cloud/api/invitations/mock-owner-invite/accept' &&
      request.method === 'POST'
    ) {
      if (memberIndex < 0) {
        if (acceptedInvites.has(viewer.id))
          return new Response('Invitation expired', { status: 404 })
        acceptedInvites.add(viewer.id)
        members.push({ ...viewer, membershipId: `member-${viewer.id}` })
      }
      return Response.json({
        success: true,
        remote: mockTarget,
        membershipId: `member-${viewer.id}`
      })
    }
    if (path === '/mock/snapshot' && request.method === 'GET')
      return Response.json({
        workspaces: memberIndex >= 0 ? [{ id: 'alice:owner-board', members, invitations }] : []
      })
    if (path === '/mock/cloud/api/workspaces/remote' && request.method === 'GET')
      return Response.json({
        workspaces:
          memberIndex >= 0
            ? [
                {
                  id: 'owner-board',
                  name: 'Product launch',
                  owner: { id: 'alice', name: 'Alice' }
                }
              ]
            : []
      })
    if (memberIndex < 0)
      return Response.json(
        { error: 'Workspace not available', code: 'WORKSPACE_NOT_AVAILABLE' },
        { status: 404 }
      )
    if (path === '/mock/leave' && request.method === 'DELETE') {
      if (!members[memberIndex].membershipId)
        return new Response('Owners cannot leave', { status: 403 })
      members.splice(memberIndex, 1)
      acceptedInvites.add(viewer.id)
      return new Response(null, { status: 204 })
    }
    if (path === '/mock/access') return new Response(null, { status: 204 })
    if (suffix === '/members' && request.method === 'GET')
      return Response.json({ members, invitations }, { headers: { 'cache-control': 'no-store' } })
    if (suffix === '/invitations' && request.method === 'POST') {
      const { email } = (await request.json()) as { email?: string }
      if (!email || !email.includes('@'))
        return Response.json({ error: 'Enter an email address' }, { status: 400 })
      const normalized = email.trim().toLowerCase()
      if (
        members.some(
          member => member.type === 'user' && member.email.toLowerCase() === normalized
        ) ||
        invitations.some(invite => invite.email === normalized)
      )
        return Response.json({ error: 'Already a member or invited' }, { status: 409 })
      invitations.push({
        id: crypto.randomUUID(),
        email: normalized,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString()
      })
      return Response.json({ success: true })
    }
    if (request.method === 'DELETE') {
      const [, collection, id] = suffix.split('/')
      const index =
        collection === 'members'
          ? members.findIndex(member => member.membershipId === id)
          : collection === 'invitations'
            ? invitations.findIndex(invite => invite.id === id)
            : -1
      if (index < 0) return Response.json({ error: 'Not found' }, { status: 404 })
      if (collection === 'members') members.splice(index, 1)
      else invitations.splice(index, 1)
      return Response.json({ success: true })
    }
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

// Keep the visitor's personal state on its machine. Only the proxy knows that
// this local folder represents a share: real Cloud sync cannot vouch for a mock member.
function mockRemoteEntry(entry: WorkspaceEntry): WorkspaceEntry {
  return { ...entry, name: mockTarget.workspace_id, remote: mockTarget }
}

function isMockVisitorFolder(path: string, root: string) {
  return dirname(path) === root && /^mock-owned-[a-f0-9]{24}$/.test(basename(path))
}

// Development-only reverse proxy. Batiok owns sign-in and the visitor machine.
export function createMockRemoteProxy(
  batiok: string,
  owner: string,
  referencePath: string,
  testWorkspaceEntry?: (id: string, trashed?: boolean) => Promise<{ id: string } | undefined>
) {
  for (const origin of [batiok, owner]) {
    const url = new URL(origin)
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw new Error('Mock upstreams must be local HTTP origins')
  }
  const cloud = createMockRemoteInvitations()
  const visitorFolders = new Map<string, string>()
  const agentInvitePaths = new Set<string>()
  const memberStreams = new Set<ServerResponse>()
  const remote = /^\/api\/workspaces\/alice:owner-board(?=\/|\?|$)/
  const positions = new Map<string, number>()
  const testWorkspace = /^\/api\/workspaces\/(?:trash\/)?(mock-owned-[a-f0-9]{24})(?=\/|\?|$)/
  const target = (path: string) => {
    const { pathname, search } = new URL(path, 'http://localhost')
    const fixture = remote.test(pathname) || (testWorkspaceEntry && testWorkspace.test(pathname))
    const url = new URL(fixture ? owner : batiok)
    url.pathname = pathname.replace(remote, '/api/workspaces/owner-board')
    url.search = search
    return url
  }
  const forwardHeaders = (req: IncomingMessage, url: URL) => {
    // HTML is rewritten below, so request an uncompressed upstream body.
    const headers = { ...req.headers, host: url.host, 'accept-encoding': 'identity' }
    const browserOrigin = `http://${req.headers.host}`
    // Translate only this proxy's origin. Foreign origins must still fail upstream checks.
    if (headers.origin === browserOrigin) headers.origin = new URL(batiok).origin
    if (headers.referer?.startsWith(`${browserOrigin}/`))
      headers.referer = new URL(batiok).origin + headers.referer.slice(browserOrigin.length)
    return headers
  }
  const authorize = async (req: IncomingMessage) => {
    const origin = req.headers.origin
    if (
      (origin && origin !== `http://${req.headers.host}`) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      return { response: Response.json({ error: 'Invalid origin' }, { status: 403 }) }
    const session = await fetch(new URL('/cloud/api/auth/get-session', batiok), {
      headers: { cookie: req.headers.cookie ?? '' },
      redirect: 'manual'
    })
    if (!session.ok) throw new Error('Could not read the Batiok session')
    const identity = (await session.json()) as { user?: MockUser } | null
    if (!identity?.user || identity.user.isAnonymous)
      return { response: Response.json({ error: 'Sign in required' }, { status: 401 }) }
    const headers = new Headers({
      'x-moi-mock-viewer': encodeURIComponent(JSON.stringify({ ...identity.user, type: 'user' }))
    })
    const testId =
      'mock-owned-' +
      new Bun.CryptoHasher('sha256').update(identity.user.id).digest('hex').slice(0, 24)
    return { headers, session, testId }
  }
  const ownerAccess = async (req: IncomingMessage) => {
    const auth = await authorize(req)
    return (
      auth.response ?? cloud(new Request('http://localhost/mock/access', { headers: auth.headers }))
    )
  }
  const fixtureAccess = async (req: IncomingMessage) => {
    const path = new URL(req.url!, 'http://localhost').pathname
    const id = testWorkspaceEntry && testWorkspace.exec(path)?.[1]
    const personalId = /^\/api\/workspaces\/([^/]+)/.exec(path)?.[1]
    const visitor = personalId && visitorFolders.get(personalId)
    if (visitor) {
      const auth = await authorize(req)
      if (auth.response) return auth.response
      if (visitor !== auth.testId) return new Response('Workspace not found', { status: 404 })
      return cloud(new Request('http://localhost/mock/access', { headers: auth.headers }))
    }
    if (!id) return remote.test(path) ? ownerAccess(req) : undefined
    const auth = await authorize(req)
    if (auth.response) return auth.response
    if (id !== auth.testId) return new Response('Workspace not found', { status: 404 })
    await testWorkspaceEntry(id)
    return undefined
  }
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname
    const sharing =
      /^\/cloud\/api\/workspaces\/alice:owner-board(\/(?:members|invitations)(?:\/[^/]+)?)$/.exec(
        path
      )
    const remoteWorkspaceRequest = [
      '/cloud/api/workspaces/invitations',
      '/cloud/api/workspaces/remote',
      '/cloud/api/invitations/mock-owner-invite/accept'
    ].includes(path)
    try {
      if (
        path === '/cloud/api/workspaces/alice:owner-board/agent-invitations' &&
        req.method === 'POST'
      ) {
        const access = await ownerAccess(req)
        if (!access.ok) {
          res.writeHead(access.status, { 'content-type': 'application/json' })
          res.end(await access.text())
          return
        }
        const invitePath = `/mock/agent-invites/${crypto.randomUUID()}`
        agentInvitePaths.add(invitePath)
        const ttl = 15 * 60_000
        setTimeout(() => agentInvitePaths.delete(invitePath), ttl).unref()
        res.writeHead(201, {
          'content-type': 'application/json',
          'cache-control': 'no-store'
        })
        res.end(
          JSON.stringify({
            invitationUrl: `http://${req.headers.host}${invitePath}`,
            expiresAt: new Date(Date.now() + ttl).toISOString()
          })
        )
        return
      }
      if (path.startsWith('/mock/agent-invites/') && req.method === 'GET') {
        const valid = agentInvitePaths.has(path)
        res.writeHead(valid ? 200 : 404, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store'
        })
        res.end(
          valid
            ? 'Product launch agent invitation. This local preview is for testing Copy prompt.'
            : 'Invitation unavailable'
        )
        return
      }
      if (path === '/mock/member-events' || path === '/mock/snapshot') {
        const auth = await authorize(req)
        if (auth.response) {
          res.writeHead(auth.response.status)
          res.end()
          return
        }
        if (path === '/mock/snapshot') {
          const response = await cloud(
            new Request('http://localhost/mock/snapshot', { headers: auth.headers })
          )
          res.writeHead(response.status, {
            'content-type': 'application/json',
            'cache-control': 'no-store'
          })
          res.end(await response.text())
          return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
        res.write('data: ready\n\n')
        memberStreams.add(res)
        res.on('close', () => memberStreams.delete(res))
        return
      }
      if (path === '/cloud/api/bootstrap' && req.method === 'GET') {
        const auth = await authorize(req)
        const upstream =
          auth.response ??
          (await fetch(new URL(path, batiok), {
            headers: { cookie: req.headers.cookie ?? '' },
            redirect: 'manual'
          }))
        let body = await upstream.text()
        if (upstream.ok && auth.headers) {
          const snapshot = JSON.parse(body) as { workspaces: { id: string }[] }
          const mock = (await (
            await cloud(
              new Request('http://localhost/mock/snapshot', {
                headers: auth.headers
              })
            )
          ).json()) as { workspaces: { id: string }[] }
          snapshot.workspaces = [
            ...snapshot.workspaces.filter(workspace => workspace.id !== 'alice:owner-board'),
            ...mock.workspaces
          ]
          body = JSON.stringify(snapshot)
        }
        res.writeHead(upstream.status, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'set-cookie': [
            ...upstream.headers.getSetCookie(),
            ...(auth.session?.headers.getSetCookie() ?? [])
          ]
        })
        res.end(body)
        return
      }
      const personalId = /^\/api\/workspaces\/([^/]+)\/?$/.exec(path)?.[1]
      const visitor = personalId && visitorFolders.get(personalId)
      const leave = req.method === 'DELETE' && visitor
      if (remoteWorkspaceRequest || sharing || leave) {
        const auth = await authorize(req)
        if (auth.response) {
          res.writeHead(auth.response.status, { 'content-type': 'application/json' })
          res.end(await auth.response.text())
          return
        }
        if (leave && visitor !== auth.testId) return void res.writeHead(404).end()
        const { headers, session } = auth
        const mockPath = leave
          ? '/mock/leave'
          : sharing
            ? `/mock/sharing${sharing[1]}`
            : `/mock${path}`
        const response = await cloud(
          new Request(`http://localhost${mockPath}`, {
            method: req.method,
            headers,
            body: ['GET', 'HEAD'].includes(req.method!)
              ? undefined
              : (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>)
          })
        )
        res.writeHead(response.status, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'set-cookie': session.headers.getSetCookie()
        })
        res.end(await response.text())
        if (response.ok && req.method !== 'GET')
          for (const stream of memberStreams) stream.write('data: updated\n\n')
        return
      }
      const access = await fixtureAccess(req)
      if (access && !access.ok) {
        res.writeHead(access.status, { 'content-type': 'application/json' })
        res.end(await access.text())
        return
      }
      const url = target(req.url!)
      const upstreamHeaders = forwardHeaders(req, url)
      let body: Buffer | undefined
      // The fixture lives on the mock owner. Batiok handles the visitor's real rows and order.
      const reorder = path === '/api/workspaces/order' && req.method === 'PUT'
      const listing =
        req.method === 'GET' && (path === '/api/workspaces' || path === '/api/workspaces/trash')
      let fixtureSession: Awaited<ReturnType<typeof authorize>> | undefined
      let fixturePosition: number | undefined
      if ((testWorkspaceEntry && reorder) || listing) {
        const auth = await authorize(req)
        if (auth.response)
          return void res.writeHead(auth.response.status).end(await auth.response.text())
        fixtureSession = auth
        if (reorder) {
          const order = JSON.parse((await buffer(req)).toString())
          if (!Array.isArray(order?.ids))
            return void res.writeHead(400).end('Expected workspace ids')
          fixturePosition = order.ids.indexOf(auth.testId)
          body = Buffer.from(
            JSON.stringify({ ids: order.ids.filter((id: string) => id !== auth.testId) })
          )
          delete upstreamHeaders['transfer-encoding']
          upstreamHeaders['content-length'] = String(body.length)
        }
      }
      if (path === '/api/workspaces' && req.method === 'POST') {
        body = await buffer(req)
        const input = await new Response(body.toString()).json().catch(() => undefined)
        if (sameRemoteWorkspace(input?.remote, mockTarget)) {
          const auth = await authorize(req)
          if (auth.response)
            return void res.writeHead(auth.response.status).end(await auth.response.text())
          const access = await cloud(
            new Request('http://localhost/mock/access', { headers: auth.headers })
          )
          if (!access.ok) {
            res.writeHead(access.status, { 'content-type': 'application/json' })
            res.end(await access.text())
            return
          }
          if (input.harness !== undefined && !['claude-code', 'codex'].includes(input.harness)) {
            res.writeHead(400).end('Unknown workspace type')
            return
          }
          const folder = join(referencePath, auth.testId)
          // Applets run on the mock owner. A visitor folder needs no applet dependencies.
          await mkdir(join(folder, '.moi'), { recursive: true })
          await writeFile(join(folder, '.moi/package.json'), '{"private":true}\n', {
            flag: 'wx'
          }).catch(error => {
            if (error.code !== 'EEXIST') throw error
          })
          const registration = await fetch(url, {
            method: 'POST',
            headers: {
              cookie: req.headers.cookie ?? '',
              origin: url.origin,
              'content-type': 'application/json'
            },
            body: JSON.stringify({ path: folder, harness: input.harness }),
            redirect: 'manual'
          })
          let reply = await registration.text()
          if (registration.ok) {
            const entry: WorkspaceEntry = JSON.parse(reply)
            visitorFolders.set(entry.id, auth.testId)
            reply = JSON.stringify(mockRemoteEntry(entry))
          }
          res
            .writeHead(registration.status, {
              'content-type': registration.headers.get('content-type') ?? 'text/plain',
              'set-cookie': registration.headers.getSetCookie()
            })
            .end(reply)
          return
        }
      }
      const upstream = httpRequest(
        url,
        { method: req.method, headers: upstreamHeaders },
        async reply => {
          const headers = { ...reply.headers }
          if (visitor && req.method === 'GET' && reply.statusCode === 200) {
            try {
              const { cwd, harness, agentId }: WorkspaceInfoResponse = JSON.parse(
                (await buffer(reply)).toString()
              )
              const info: WorkspaceInfoResponse = {
                version: 2,
                isRemote: true,
                cwd,
                harness,
                agentId,
                remote: mockTarget,
                apiBase: workspaceApiBase(mockTarget.workspace_id, mockTarget.user_id)
              }
              delete headers['content-length']
              res.writeHead(200, headers).end(JSON.stringify(info))
            } catch {
              res.writeHead(502).end('Could not read the mock visitor workspace')
            }
            return
          }
          if (fixtureSession?.testId && reply.statusCode === 200) {
            const fixtureId = fixtureSession.testId
            try {
              const rows: WorkspaceEntry[] = JSON.parse((await buffer(reply)).toString())
              const entries: { id: string }[] = []
              for (const entry of rows) {
                if (!entry.path || !isMockVisitorFolder(entry.path, referencePath)) {
                  entries.push(entry)
                  continue
                }
                const viewer = basename(entry.path)
                visitorFolders.set(entry.id, viewer)
                if (viewer !== fixtureId) continue
                const access = await cloud(
                  new Request('http://localhost/mock/access', { headers: fixtureSession.headers })
                )
                if (access.ok) entries.push(mockRemoteEntry(entry))
              }
              const owned = await testWorkspaceEntry?.(fixtureId, path === '/api/workspaces/trash')
              if (fixturePosition !== undefined) positions.set(fixtureId, fixturePosition)
              const index = positions.get(fixtureId) ?? -1
              if (owned) entries.splice(index < 0 ? entries.length : index, 0, owned)
              headers['set-cookie'] = [
                ...(headers['set-cookie'] ?? []),
                ...fixtureSession.session.headers.getSetCookie()
              ]
              delete headers['content-length']
              res.writeHead(200, headers).end(JSON.stringify(entries))
            } catch {
              res.writeHead(502).end('Could not list mock workspaces')
            }
            return
          }
          if (headers.location) {
            const redirect = new URL(headers.location, url)
            if (redirect.origin === new URL(batiok).origin)
              headers.location = redirect.pathname + redirect.search + redirect.hash
          }
          if (headers['content-type']?.includes('text/html')) {
            try {
              const auth = await authorize(req)
              if (auth.headers) {
                const snapshot = (await (
                  await cloud(
                    new Request('http://localhost/mock/snapshot', {
                      headers: auth.headers
                    })
                  )
                ).json()) as { workspaces: { id: string }[] }
                // Batiok publishes its own members first. Add the mock before Moi mounts.
                const data = JSON.stringify(snapshot.workspaces).replaceAll('<', '\\u003c')
                const body = await new HTMLRewriter()
                  .on('script#moi-start', {
                    element(element) {
                      element.before(
                        `<script type="module">const api = window.moi;
for (const workspace of ${data}) api.workspaceMembers.set(workspace.id, workspace);
const events = new EventSource('/mock/member-events');
let revision = 0;
events.onmessage = async () => {
  const current = ++revision;
  const identity = api.identity.getRevision();
  try {
    const response = await fetch('/mock/snapshot', { cache: 'no-store' });
    if (!response.ok) return;
    const snapshot = await response.json();
    if (current !== revision || identity !== api.identity.getRevision()) return;
    const workspace = snapshot.workspaces[0];
    if (workspace) api.workspaceMembers.set(workspace.id, workspace);
    else api.workspaceMembers.remove('alice:owner-board');
  } catch { /* Reconnection and cloud bootstrap refresh repair missed updates. */ }
};
window.addEventListener('pagehide', () => events.close());</script>`,
                        { html: true }
                      )
                    }
                  })
                  .transform(
                    new Response(Readable.toWeb(reply) as unknown as ReadableStream<Uint8Array>)
                  )
                  .text()
                delete headers['content-length']
                delete headers['content-encoding']
                headers['cache-control'] = 'no-store'
                res.writeHead(reply.statusCode!, headers)
                res.end(body)
                return
              }
            } catch {
              res.writeHead(502)
              res.end('Could not load mock membership snapshot')
              return
            }
          }
          res.writeHead(reply.statusCode!, headers)
          reply.pipe(res)
        }
      )
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502)
        res.end('Local upstream unavailable')
      })
      res.on('close', () => upstream.destroy())
      if (body === undefined) req.pipe(upstream)
      else upstream.end(body)
    } catch {
      res.writeHead(502)
      res.end('Local upstream unavailable. Check Batiok and the mock owner')
    }
  })
  // Translate upgrade headers too, then tunnel bytes for collaboration and live updates.
  server.on('upgrade', async (req, socket, head) => {
    try {
      const access = await fixtureAccess(req)
      if (access && !access.ok) {
        socket.end(
          `HTTP/1.1 ${access.status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
        )
        return
      }
    } catch {
      socket.destroy()
      return
    }
    const url = target(req.url!)
    const upstream = connect(Number(url.port || 80), url.hostname, () => {
      const headers = forwardHeaders(req, url)
      upstream.write(
        `${req.method} ${url.pathname}${url.search} HTTP/1.1\r\n` +
          Object.entries(headers)
            .flatMap(([key, value]) =>
              value === undefined
                ? []
                : (Array.isArray(value) ? value : [value]).map(item => `${key}: ${item}\r\n`)
            )
            .join('') +
          '\r\n'
      )
      upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
    upstream.on('close', () => socket.destroy())
  })
  return server
}

// Reset the mock registration locally. Its membership exists only in this fixture.
export async function resetMockRegistration(
  visitorOrigin: string,
  registryPath = join(
    process.env.MOI_DATA_DIR || envPaths('moi', { suffix: '' }).data,
    'workspaces.json'
  ),
  visitorRoot?: string
) {
  const url = new URL(visitorOrigin)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Mock visitor must be a local HTTP origin')
  const response = await fetch(new URL('/api/workspaces', url))
  if (!response.ok) throw new Error('Could not list visitor workspaces; start Moi first')
  const entries = (await response.json()) as {
    id: string
    path: string
    remote?: { user_id: string; workspace_id: string }
  }[]
  for (const entry of entries) {
    if (
      !sameRemoteWorkspace(entry.remote, mockTarget) &&
      !(visitorRoot && isMockVisitorFolder(entry.path, visitorRoot))
    )
      continue
    const registry = (await Bun.file(registryPath).json()) as { id: string; path: string }[]
    if (!registry.some(item => item.id === entry.id && item.path === entry.path))
      throw new Error(
        `Mock workspace ${entry.id} does not match the local registry; check MOI_DATA_DIR`
      )
    const temporary = `${registryPath}.${crypto.randomUUID()}.tmp`
    try {
      await Bun.write(
        temporary,
        JSON.stringify(
          registry.filter(item => item.id !== entry.id),
          null,
          2
        )
      )
      await rename(temporary, registryPath)
    } finally {
      await rm(temporary, { force: true })
    }
  }
}

if (import.meta.main) {
  const root = resolve(process.env.MOCK_OWNER_DATA_DIR ?? join(tmpdir(), 'moi-mock-owner'))
  const referencePath = join(root, 'visitor-backings')
  await resetMockRegistration(
    process.env.MOCK_VISITOR_ORIGIN ?? 'http://localhost:13337',
    undefined,
    referencePath
  )
  // Set isolation before loading server modules, which capture DATA_DIR at import time.
  process.env.MOI_DATA_DIR = root
  process.env.MOI_SECRET_BACKEND = 'file'
  process.env.MOI_ENVIRONMENT = 'cloud'
  const { recordAgentActivity } = await import('../server/collab/agent-activity')
  const { collabManager } = await import('../server/collab/manager')
  const { setEventServer, workspaceEventsTopic } = await import('../server/events')
  const { api } = await import('../server/api')
  const { registerWorkspace, getWorkspace, listTrashedWorkspaces } =
    await import('../server/workspaces/registry')
  const { saveLayout, loadLayout } = await import('../server/workspaces/layout')
  const { buildAllViews } = await import('../server/applets/views')
  const { buildAllWidgets } = await import('../server/applets/widgets')
  const { createDefaultWorkspaceLayout } = await import('../lib/workspace-layout')
  const { killAllWorkers } = await import('../server/applets/functions')

  const owner = join(root, 'owner-board')
  await mkdir(join(owner, '.moi/views'), { recursive: true })
  await mkdir(join(owner, '.moi/widgets'), { recursive: true })
  await symlink(
    resolve(import.meta.dir, '../node_modules'),
    join(owner, '.moi/node_modules')
  ).catch(error => {
    if (error.code !== 'EEXIST') throw error
  })
  await registerWorkspace(owner, { id: 'owner-board', harness: 'claude-code' })
  const layout = await loadLayout(owner)
  if (!layout.name || layout.name === 'Shared counter') {
    await saveLayout(
      {
        ...layout,
        name: 'Product launch',
        widgetGrid: [
          ...createDefaultWorkspaceLayout().widgetGrid,
          { i: 'launch-brief', x: 0, y: 1 },
          { i: 'launch-progress', x: 2, y: 1 }
        ]
      },
      owner
    )
  }
  // Retire only the original generated applets; keep their saved counter data.
  for (const kind of ['views', 'widgets'])
    for (const suffix of ['tsx', 'server.ts'])
      await rm(join(owner, `.moi/${kind}/counter.${suffix}`), { force: true })

  const brief = `
export const config = { colSpan: 2, rowSpan: 1 };
export default function LaunchBrief() {
  return <div className="h-full w-full bg-background p-4 text-foreground">
    <h2 className="text-sm font-medium">Launch brief</h2>
    <p className="mt-3 text-sm">A private beta for our first 50 customers.</p>
    <p className="mt-2 text-xs text-muted-foreground">Alice · Team review this week</p>
  </div>;
}`
  const progress = `
export const config = { colSpan: 2, rowSpan: 1 };
export default function LaunchProgress() {
  return <div className="h-full w-full bg-background p-4 text-foreground">
    <h2 className="text-sm font-medium">Launch readiness</h2>
    <p className="mt-3 text-2xl font-medium">2 of 6 ready</p>
    <p className="mt-2 text-xs text-muted-foreground">Next: review the landing page</p>
  </div>;
}`
  const plan = `
export const config = { title: 'Launch plan', icon: 'rocket' };
export default function LaunchPlan() {
  return <div className="h-full w-full overflow-auto bg-background p-6 text-foreground">
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">Launch plan</h1>
      <p className="mt-2 text-sm text-muted-foreground">The essentials for our private beta.</p>
      <ul className="mt-6 divide-y divide-border">
        {[
          ['Launch story', 'Alice', 'Ready'],
          ['Landing page', 'Jamie', 'In review'],
          ['Product demo', 'Alice', 'To do'],
          ['Customer email', 'Sam', 'Ready'],
          ['Mobile signup', 'Jamie', 'To do'],
          ['Support answers', 'Sam', 'To do']
        ].map(([task, owner, status]) => <li key={task} className="flex items-center gap-4 py-3 text-sm">
          <span className="min-w-0 flex-1">{task}<span className="mt-1 block text-xs text-muted-foreground">{owner}</span></span>
          <span className="shrink-0 text-xs text-muted-foreground">{status}</span>
        </li>)}
      </ul>
    </div>
  </div>;
}`
  // These applets are static fixtures. Leave any saved owner data untouched.
  for (const path of ['widgets/launch-progress.server.ts', 'views/launch-plan.server.ts'])
    await rm(join(owner, '.moi', path), { force: true })
  for (const [path, source] of Object.entries({
    'widgets/launch-brief.tsx': brief,
    'widgets/launch-progress.tsx': progress,
    'views/launch-plan.tsx': plan
  }))
    await Bun.write(join(owner, '.moi', path), source)
  await buildAllViews(owner)
  await buildAllWidgets(owner)

  const { spyOn } = await import('bun:test')
  const remoteClient = await import('../server/remote/client')
  const { startTrashSweeper } = await import('../server/workspaces/trash')
  startTrashSweeper()
  // The mock owner serves only its fixtures and has no real sharing records.
  spyOn(remoteClient, 'clearWorkspaceAccess').mockResolvedValue({ success: true })
  const fixtures = new Map<string, Promise<void>>()
  async function seedWorkspace(id: string) {
    if ((await getWorkspace(id)) || (await listTrashedWorkspaces()).some(ws => ws.id === id)) return
    const path = join(root, id)
    await saveLayout({ ...createDefaultWorkspaceLayout(), name: 'Test workspace' }, path)
    await registerWorkspace(path, { id, harness: 'claude-code' })
  }
  async function testWorkspaceEntry(id: string, trashed?: boolean) {
    if (!fixtures.has(id))
      fixtures.set(
        id,
        seedWorkspace(id).catch(error => {
          fixtures.delete(id)
          throw error
        })
      )
    await fixtures.get(id)
    if (trashed === undefined) return
    const response = await api.request(trashed ? '/api/workspaces/trash' : '/api/workspaces')
    if (!response.ok) throw new Error('Could not list fixture workspaces')
    return ((await response.json()) as { id: string }[]).find(entry => entry.id === id)
  }
  const present = new WeakSet<object>()
  const ownerServer = Bun.serve<{ workspaceId: string; path: string }>({
    hostname: '127.0.0.1',
    port: Number(process.env.MOCK_OWNER_PORT ?? 13340),
    fetch: async (request, server) => {
      const { pathname } = new URL(request.url)
      const id = /^\/api\/workspaces\/(?:trash\/)?([^/]+)/.exec(pathname)?.[1]
      if (!id || (id !== 'owner-board' && !fixtures.has(id))) {
        return new Response('Unknown mock owner or workspace', { status: 404 })
      }
      console.log(`OWNER ${request.method} ${pathname}`)
      if (
        id === 'owner-board' &&
        pathname === '/api/workspaces/owner-board' &&
        request.method === 'DELETE'
      )
        return new Response('Use Leave for a remote workspace', { status: 403 })
      if (pathname === `/api/workspaces/${id}/events`) {
        const ws = await getWorkspace(id)
        if (!ws) return new Response('Workspace not found', { status: 404 })
        if (server.upgrade(request, { data: { workspaceId: id, path: ws.path } })) return
        return new Response('WebSocket upgrade required', { status: 426 })
      }
      return api.fetch(request)
    },
    websocket: {
      open: socket => {
        socket.subscribe(workspaceEventsTopic(socket.data.workspaceId))
      },
      // Same rule as server/web.ts: presence starts with the first presence message.
      message: (socket, message) => {
        if (!present.has(socket)) {
          if (String(message) === '{"type":"ping"}') return void socket.send('{"type":"pong"}')
          present.add(socket)
          collabManager.open(socket, socket.data.path, { workspaceId: socket.data.workspaceId })
        }
        collabManager.message(socket, message)
      },
      close: socket => collabManager.close(socket)
    }
  })
  setEventServer(ownerServer)
  const alice = initialMembers.find(member => member.id === 'alice')!
  const socket = new WebSocket(
    `ws://127.0.0.1:${ownerServer.port}/api/workspaces/owner-board/events`
  )
  socket.onopen = () =>
    socket.send(
      JSON.stringify({
        type: 'join',
        version: COLLAB_PROTOCOL_VERSION,
        profile: { type: 'user', id: alice.id, name: alice.name, color: colorForId(alice.id) },
        location: { page: 'overview', status: 'active' }
      })
    )
  function simulateAgentCommands() {
    recordAgentActivity('owner-board', 'launch-bot')
    recordAgentActivity('owner-board', 'review-bot')
  }
  simulateAgentCommands()
  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}')
  }, 15_000)
  const commands = setInterval(simulateAgentCommands, 30_000)

  const proxyPort = Number(process.env.MOCK_PROXY_PORT ?? 9898)
  const batiok = process.env.MOCK_BATIOK_ORIGIN ?? 'http://localhost:8787'
  const proxy = createMockRemoteProxy(
    batiok,
    ownerServer.url.origin,
    referencePath,
    testWorkspaceEntry
  )
  proxy.listen(proxyPort, '127.0.0.1', () => {
    const address = proxy.address()
    if (address && typeof address !== 'string')
      console.log(`Open Moi at http://localhost:${address.port}`)
  })
  console.log(`Mock owner: ${ownerServer.url}; Batiok: ${batiok}`)
  const stop = async () => {
    clearInterval(commands)
    clearInterval(heartbeat)
    socket.close()
    await collabManager.shutdown()
    proxy.close()
    proxy.closeAllConnections()
    ownerServer.stop(true)
    killAllWorkers()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
