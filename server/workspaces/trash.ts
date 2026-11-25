import { existsSync } from 'node:fs'
import { lstat, rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { sameRemoteWorkspace } from '@/lib/workspace-config'
import type { WorkspaceEntry } from '@/lib/types'

import { getAppConfig } from '../app-config'
import { collabManager } from '../collab/manager'
import { publishEvent } from '../events'
import { harnessFor } from '../harness/registry'
import { clearWorkspaceAccess } from '../remote/client'
import { removeWorkspaceSkill, workspaceSkillDirectories } from '../skills/workspace'
import { deleteWorkspaceState } from '../workspace-state'
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

async function removeDirectoryIfEmpty(path: string) {
  await rmdir(path).catch(error => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error
  })
}

function entryAt(path: string) {
  return lstat(path).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
}

async function deleteWorkspaceFiles(ws: WorkspaceEntry): Promise<void> {
  const folder = await entryAt(ws.path)
  // A replaced symlink can point at a different workspace.
  if (folder?.isSymbolicLink()) return
  const moiDir = join(ws.path, '.moi')
  if (ws.remote) {
    if (
      existsSync(moiDir) &&
      !sameRemoteWorkspace((await loadWorkspaceFileConfig(ws.path)).remote, ws.remote)
    )
      return
    await stopWorkspaceActivity(ws)
  }
  await clearWorkspaceEnv(ws.path)
  for (const skills of workspaceSkillDirectories(ws.path, ws.harness)) {
    const parent = dirname(skills)
    // Never follow a user symlink while removing the skill or its empty folders.
    const parentEntry = await entryAt(parent)
    if (parentEntry && !parentEntry.isDirectory()) continue
    const directory = await entryAt(skills)
    if (directory && !directory.isDirectory()) continue
    await removeWorkspaceSkill(skills)
    await removeDirectoryIfEmpty(skills)
    if (parent !== ws.path) await removeDirectoryIfEmpty(parent)
  }
  await rm(moiDir, { recursive: true, force: true })
  await removeDirectoryIfEmpty(ws.path)
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
