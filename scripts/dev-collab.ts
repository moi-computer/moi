import { mkdtemp } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'

import type { WorkspaceMember } from '../client/features/collab/members/types'

const loopback = '127.0.0.1'
const workspaceId = 'collab'
export const members = [
  { type: 'user', id: 'anna', name: 'Anna', email: 'anna@example.test', isAnonymous: false },
  {
    type: 'user',
    id: 'boris',
    name: 'Boris',
    email: 'boris@example.test',
    isAnonymous: false,
    membershipId: 'member-boris'
  }
] satisfies WorkspaceMember[]

// Each origin represents one browser identity, including on reload and in a new tab.
// Only the host's read-only account data is simulated. Moi owns the workspace and sockets.
export function participantHost(viewer: WorkspaceMember, moiPort: number) {
  const snapshot = [{ id: workspaceId, members, invitations: [] }]
  const bootstrap = `<script type="module">window.moi.identity.set(${JSON.stringify(viewer)});window.moi.workspaceMembers.setAll(${JSON.stringify(snapshot)});</script>`
  const host = createServer((req, res) => {
    const path = req.url ?? '/'
    if (path.startsWith('/cloud/')) {
      const reads: Record<string, unknown> = {
        '/cloud/api/me': viewer,
        '/cloud/api/workspaces/shared': { workspaces: [] },
        '/cloud/api/workspaces/invitations': { invitations: [] }
      }
      const body = req.method === 'GET' ? reads[path.split('?')[0]!] : undefined
      res.writeHead(body ? 200 : 404, {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      })
      res.end(JSON.stringify(body ?? { error: 'Unavailable in the local collaboration fixture' }))
      return
    }

    const upstream = request(
      {
        hostname: loopback,
        port: moiPort,
        path,
        method: req.method,
        headers: { ...req.headers, 'accept-encoding': 'identity' }
      },
      async reply => {
        try {
          const headers = { ...reply.headers }
          if (headers['content-type']?.includes('text/html')) {
            const html = await new HTMLRewriter()
              .on('#moi-start', {
                element(element) {
                  element.before(bootstrap, { html: true })
                }
              })
              .transform(new Response(await text(reply)))
              .text()
            delete headers['content-length']
            delete headers['transfer-encoding']
            headers['cache-control'] = 'no-store'
            res.writeHead(reply.statusCode!, headers)
            res.end(html)
          } else {
            res.writeHead(reply.statusCode!, headers)
            reply.pipe(res)
          }
        } catch {
          res.destroy()
        }
      }
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })

  // Tunnel the original upgrade, including Bun's HMR subprotocol and binary frames.
  host.on('upgrade', (req, socket, head) => {
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      socket.destroy()
      return
    }
    const upstream = connect(moiPort, loopback, () => {
      upstream.write(`GET ${req.url} HTTP/1.1\r\n`)
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`)
      upstream.write('\r\n')
      upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    socket.on('error', () => upstream.destroy())
    upstream.on('error', () => socket.destroy())
    socket.on('close', () => upstream.destroy())
    upstream.on('close', () => socket.destroy())
  })
  return host
}

if (import.meta.main) {
  const root = await mkdtemp(join(tmpdir(), 'moi-dev-collab-'))
  const workspace = join(root, 'workspaces', workspaceId)
  // Server modules capture their data paths and ports at import time.
  Object.assign(process.env, {
    MOI_DATA_DIR: root,
    MOI_ENVIRONMENT: 'cloud',
    MOI_DEV: '1',
    MOI_DEMO: '0',
    MOI_SECRET_BACKEND: 'file',
    HOST: loopback,
    PORT: '13338',
    MOI_CONTROL_PORT: '13060',
    PUBLIC_TLDRAW_LICENSE_KEY: process.env.PUBLIC_TLDRAW_LICENSE_KEY ?? ''
  })
  await Bun.write(
    join(root, 'config.json'),
    JSON.stringify({ workspacesDir: join(root, 'workspaces') })
  )
  const { registerWorkspace } = await import('../server/workspaces/registry')
  const { saveLayout, loadLayout } = await import('../server/workspaces/layout')
  const { provisionWorkspace } = await import('../server/workspaces/init')
  await provisionWorkspace(workspace, 'codex')
  await saveLayout({ ...(await loadLayout(workspace)), name: 'Collaboration test' }, workspace)
  await registerWorkspace(workspace, {
    id: workspaceId,
    name: 'Collaboration test',
    harness: 'codex'
  })
  const { app } = await import('../server/web')
  console.log(`Workspace files: ${workspace}`)
  for (const viewer of members) {
    const host = participantHost(viewer, app.port!)
    host.listen(0, loopback, () => {
      const address = host.address()
      if (address && typeof address !== 'string')
        console.log(
          `Open as ${viewer.name}: http://${loopback}:${address.port}/workspace/${workspaceId}`
        )
    })
  }
}
