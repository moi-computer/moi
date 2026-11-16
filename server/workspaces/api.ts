import type { RemoteWorkspaceTarget } from '@/lib/workspace-config'
import { remoteRequest } from '../remote/client'

export type WorkspaceApiTarget = { remote: RemoteWorkspaceTarget }

// CLI requests for a linked folder's shared content go to the owner's workspace API.
// Local workspaces never come through here; their handlers read the folder directly.
// `path` comes from `cloudRoutes` (server/remote/routes.ts).
export async function requestWorkspace(path: string, init?: RequestInit): Promise<Response> {
  // Serialize multipart bodies once so the signature and content type match the bytes sent.
  const payload = new Request('http://workspace.local', {
    method: init?.method ?? 'POST',
    body: init?.body,
    headers: init?.headers
  })
  // Bun materializes multipart headers lazily; read the boundary before consuming the body.
  const contentType = payload.headers.get('content-type') ?? undefined
  return remoteRequest(path, {
    method: init?.method,
    body: init?.body == null ? undefined : new Uint8Array(await payload.arrayBuffer()),
    signal: init?.signal ?? undefined,
    contentType
  })
}
