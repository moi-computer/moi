import { realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { sameRemoteWorkspace } from '@/lib/workspace-config'
import type { WorkspaceEntry } from '@/lib/types'

import { createdWorkspacesRoot, getAppConfig } from '../app-config'
import { collabManager } from '../collab/manager'
import { publishEvent } from '../events'
import { harnessFor } from '../harness/registry'
import { clearWorkspaceAccess } from '../remote/client'
import { deleteWorkspaceState } from '../workspace-state'
import { remoteReferenceFolderName } from './remote-workspace-reference'
import { clearWorkspaceEnv } from './env'
import { loadWorkspaceFileConfig } from './layout'
import {
  claimExpiredWorkspaces,
  claimRevokedReferences,
  finishWorkspaceDeletion,
  setWorkspaceTrashed
} from './registry'

export async function stopWorkspaceActivity(ws: WorkspaceEntry) {
  harnessFor(ws).stopWorkspace?.(ws.path)
  await collabManager.stopWorkspace(ws.path)
}

export async function changeWorkspaceTrash(id: string, trashed: boolean) {
  const result = await setWorkspaceTrashed(id, trashed, clearWorkspaceAccess)
  if (result.status === 'updated') {
    if (trashed) await stopWorkspaceActivity(result.entry)
    publishEvent({ type: 'workspaces-list:changed' })
  }
  return result
}

// A folder Moi made is deleted whole: a direct child of the created-workspaces
// root, and for a reference to someone else's workspace also one named as Moi
// names them. Anywhere else the user's own files may sit beside `.moi/`.
async function isMoiOwnedFolder({ path, remote }: WorkspaceEntry): Promise<boolean> {
  const root = createdWorkspacesRoot()
  if (dirname(resolve(path)) !== resolve(root)) return false
  const [realRoot, realPath] = await Promise.all([
    realpath(root).catch(() => undefined),
    realpath(path).catch(() => undefined)
  ])
  // A symlink inside the root points at a folder Moi does not own.
  if (!realRoot || !realPath || dirname(realPath) !== realRoot) return false
  return !remote || basename(realPath) === remoteReferenceFolderName(remote)
}

async function deleteWorkspaceFiles(ws: WorkspaceEntry): Promise<void> {
  if (ws.remote) {
    // Cleanup can resume after the folder disappeared or was linked elsewhere.
    const config = await loadWorkspaceFileConfig(ws.path)
    if (!sameRemoteWorkspace(config.remote, ws.remote)) return
    await stopWorkspaceActivity(ws)
  }
  await clearWorkspaceEnv(ws.path)
  const target = (await isMoiOwnedFolder(ws)) ? ws.path : join(ws.path, '.moi')
  await rm(target, { recursive: true, force: true })
}

async function purgeWorkspaces(pending: WorkspaceEntry[]) {
  for (const ws of pending) {
    try {
      await deleteWorkspaceFiles(ws)
      await deleteWorkspaceState(ws.id)
      await finishWorkspaceDeletion(ws.id)
    } catch (error) {
      console.warn(`Could not finish deleting workspace ${ws.id}; it will be retried`, error)
    }
  }
}

export async function purgeRevokedReferences(references: WorkspaceEntry[]) {
  const pending = await claimRevokedReferences(references)
  if (pending.length) publishEvent({ type: 'workspaces-list:changed' })
  await purgeWorkspaces(pending)
}

let sweeping: Promise<void> | undefined
export function sweepTrash(now = new Date()): Promise<void> {
  sweeping ??= claimExpiredWorkspaces(now)
    .then(purgeWorkspaces)
    .finally(() => (sweeping = undefined))
  return sweeping
}

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

// A cloud machine sleeps when idle, so the first sweep after a start is the one
// that usually finds expired workspaces.
export function startTrashSweeper(): void {
  if (getAppConfig().environment !== 'cloud') return
  void sweepTrash()
  const timer = setInterval(() => void sweepTrash(), SWEEP_INTERVAL_MS)
  timer.unref?.()
}
