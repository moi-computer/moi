import { resolve } from 'node:path'
import { fetchRemoteWorkspaces } from './client'
import { parseRemoteWorkspaceTarget, type RemoteWorkspaceTarget } from '@/lib/workspace-config'
import { loadWorkspaceFileConfig } from '../workspaces/layout'
import { registerRemoteWorkspaceReference } from '../workspaces/remote-workspace-reference'
import { listWorkspaces } from '../workspaces/registry'
import { resolveWorkspaceRoot } from '../skills/version'

export async function currentRemoteWorkspace(path = process.cwd()) {
  const root = await resolveWorkspaceRoot(resolve(path))
  const config = await loadWorkspaceFileConfig(root)
  return config.remote ? { path: root, ...config.remote } : undefined
}
export async function initializeRemoteWorkspace(path: string, target: RemoteWorkspaceTarget) {
  target = parseRemoteWorkspaceTarget(target)
  const remoteWorkspaces = await fetchRemoteWorkspaces()
  if (!remoteWorkspaces.some(w => w.id === target.workspace_id && w.owner.id === target.user_id))
    throw new Error('This workspace is not shared with this account')
  // Link the requested folder even if its parent is already registered.
  const root = resolve(path)
  const existing = (await listWorkspaces()).find(
    workspace =>
      workspace.remote?.user_id === target.user_id &&
      workspace.remote.workspace_id === target.workspace_id &&
      resolve(workspace.path) !== root
  )
  if (existing)
    throw new Error(
      `This workspace is already initialized at ${existing.path} — remove that registration in Moi first`
    )
  const entry = await registerRemoteWorkspaceReference(root, target)
  return { path: root, id: entry.id, ...target }
}
