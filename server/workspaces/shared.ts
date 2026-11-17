import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Mutex } from 'async-mutex'
import { createdWorkspacesRoot } from '../app-config'
import { workspaceIdFromName } from '@/lib/workspace-name'
import { parseRemoteWorkspaceTarget, type RemoteWorkspaceTarget } from '@/lib/workspace-config'
import type { HarnessType } from '@/lib/types'
import { listWorkspaces, registerWorkspace } from './registry'
import { provisionWorkspace } from './init'
import { getLayoutPath, initializeRemoteWorkspaceConfig, loadWorkspaceFileConfig } from './layout'
import { publishEvent } from '../events'

const opening = new Mutex()
export async function openSharedWorkspace(remote: RemoteWorkspaceTarget, harness?: HarnessType) {
  remote = parseRemoteWorkspaceTarget(remote)
  return opening.runExclusive(async () => {
    const matches = (target?: RemoteWorkspaceTarget) =>
      target?.user_id === remote.user_id && target.workspace_id === remote.workspace_id
    const existing = (await listWorkspaces()).find(entry => matches(entry.remote))
    if (existing) return existing
    const hash = new Bun.CryptoHasher('sha256')
      .update(JSON.stringify([remote.user_id, remote.workspace_id]))
      .digest('hex')
      .slice(0, 12)
    const root = createdWorkspacesRoot()
    await mkdir(root, { recursive: true })
    const path = join(root, `shared-${workspaceIdFromName(remote.workspace_id)}-${hash}`)
    const created = await mkdir(path).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
        return false
      }
    )
    if (!created) {
      const config = await loadWorkspaceFileConfig(path)
      if (!matches(config.remote))
        throw new Error('The shared workspace folder already contains different content')
    }
    let entry
    try {
      entry = await registerRemoteWorkspaceReference(path, remote, harness)
    } catch (error) {
      // Only remove an empty directory we created; keep a provisioned reference for retry.
      if (created && !(await Bun.file(getLayoutPath(path)).exists()))
        await rm(path, { recursive: true, force: true })
      throw error
    }
    publishEvent({ type: 'workspaces-list:changed' })
    return entry
  })
}

// Shared filesystem operation for UI opening and CLI linking. Callers choose the folder
// and authenticate separately; a matching reference is safe to reuse after a partial failure.
// The agent is the visitor's own: `type` lands on the registry entry, never in the reference.
export async function registerRemoteWorkspaceReference(
  path: string,
  remote: RemoteWorkspaceTarget,
  harness?: HarnessType
) {
  remote = parseRemoteWorkspaceTarget(remote)
  const file = Bun.file(getLayoutPath(path))
  if (await file.exists()) {
    const config = await loadWorkspaceFileConfig(path)
    if (
      config.remote?.user_id !== remote.user_id ||
      config.remote.workspace_id !== remote.workspace_id
    )
      throw new Error('This folder already has a different workspace configuration')
  } else await initializeRemoteWorkspaceConfig(path, remote)
  await provisionWorkspace(path, harness)
  return registerWorkspace(path, harness ? { harness: harness } : {})
}
