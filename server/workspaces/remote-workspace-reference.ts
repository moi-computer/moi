import { lstat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createdWorkspacesRoot } from '../app-config'
import { workspaceIdFromName } from '@/lib/workspace-name'
import {
  parseRemoteWorkspaceTarget,
  sameRemoteWorkspace,
  type RemoteWorkspaceTarget
} from '@/lib/workspace-config'
import type { HarnessType } from '@/lib/types'
import { provisionWorkspace } from './init'
import { getLayoutPath, initializeRemoteWorkspaceConfig, loadWorkspaceFileConfig } from './layout'
import { registerWorkspace } from './registry'

export function remoteReferenceFolderName(remote: RemoteWorkspaceTarget) {
  const hash = new Bun.CryptoHasher('sha256')
    .update(JSON.stringify([remote.user_id, remote.workspace_id]))
    .digest('hex')
    .slice(0, 12)
  return `remote-${workspaceIdFromName(remote.workspace_id)}-${hash}`
}

// The app and CLI both register a local folder that points to the owner’s workspace.
export async function registerRemoteWorkspaceReference(
  path: string,
  remote: RemoteWorkspaceTarget,
  harness?: HarnessType
) {
  remote = parseRemoteWorkspaceTarget(remote)
  const file = Bun.file(getLayoutPath(path))
  if (await file.exists()) {
    const config = await loadWorkspaceFileConfig(path)
    if (!sameRemoteWorkspace(config.remote, remote))
      throw new Error('This folder already has a different workspace configuration')
  } else await initializeRemoteWorkspaceConfig(path, remote)
  await provisionWorkspace(path, harness)
  return registerWorkspace(path, { harness })
}

export async function createRemoteWorkspaceReference(
  remote: RemoteWorkspaceTarget,
  harness?: HarnessType
) {
  remote = parseRemoteWorkspaceTarget(remote)
  const root = createdWorkspacesRoot()
  const name = remoteReferenceFolderName(remote)
  await mkdir(root, { recursive: true })
  for (let suffix = 1; ; suffix++) {
    const path = join(root, suffix === 1 ? name : `${name}-${suffix}`)
    try {
      await mkdir(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // Reuse a matching reference after an interrupted registration. Leave other folders alone.
      if (!(await lstat(path)).isDirectory()) continue
      const config = await loadWorkspaceFileConfig(path).catch(() => undefined)
      if (!sameRemoteWorkspace(config?.remote, remote)) continue
    }
    return registerRemoteWorkspaceReference(path, remote, harness)
  }
}
