import { Mutex } from 'async-mutex'
import { getAppConfig } from '../app-config'
import {
  parseRemoteWorkspaceTarget,
  sameRemoteWorkspace,
  workspaceAddress,
  type RemoteWorkspaceTarget
} from '@/lib/workspace-config'
import type { HarnessType, WorkspaceEntry } from '@/lib/types'
import { getWorkspace, listWorkspaces, updateWorkspaceHarness } from './registry'
import { createRemoteWorkspaceReference } from './remote-workspace-reference'
import { publishEvent } from '../events'
import { CloudSignInRequired, fetchRemoteWorkspaces, leave } from '../remote/client'
import { purgeRevokedReferences } from './trash'

const syncLock = new Mutex()

// Opening and scheduled sync share the lock. A first open queued behind an
// older sync gets a fresh membership list if its reference is still missing.
export async function syncRemoteWorkspaces(remote?: RemoteWorkspaceTarget, harness?: HarnessType) {
  const requested = remote && parseRemoteWorkspaceTarget(remote)
  return syncLock.runExclusive(async () => {
    const registered = await listWorkspaces()
    const existing = requested && registered.find(ws => sameRemoteWorkspace(ws.remote, requested))
    if (existing) {
      if (!harness || existing.harness) return existing
      await updateWorkspaceHarness(existing.id, harness)
      return { ...existing, harness }
    }

    const available = new Map<string, RemoteWorkspaceTarget>()
    for (const { id, owner } of await fetchRemoteWorkspaces()) {
      available.set(workspaceAddress(id, owner.id), { workspace_id: id, user_id: owner.id })
    }
    const missing = new Map(available)
    const revoked: WorkspaceEntry[] = []
    for (const ws of registered) {
      if (!ws.remote) continue
      const address = workspaceAddress(ws.remote.workspace_id, ws.remote.user_id)
      if (available.has(address)) missing.delete(address)
      else revoked.push(ws)
    }
    await purgeRevokedReferences(revoked)

    let opened: WorkspaceEntry | undefined
    for (const target of missing.values()) {
      const opening = requested && sameRemoteWorkspace(target, requested)
      try {
        const entry = await createRemoteWorkspaceReference(target, opening ? harness : undefined)
        publishEvent({ type: 'workspaces-list:changed' })
        if (opening) opened = entry
      } catch (error) {
        if (opening) throw error
        console.warn('Could not create remote workspace reference', target, error)
      }
    }
    return opened
  })
}

export function leaveRemoteWorkspace(id: string, remote: RemoteWorkspaceTarget) {
  return syncLock.runExclusive(async () => {
    const ws = await getWorkspace(id)
    if (!ws) return
    if (!sameRemoteWorkspace(ws.remote, remote)) throw new Error('Workspace reference changed')
    await leave(remote.user_id, remote.workspace_id)
    await purgeRevokedReferences([ws])
  })
}

export function syncRemoteWorkspacesInBackground() {
  if (getAppConfig().environment !== 'cloud') return
  return syncRemoteWorkspaces().catch(error => {
    if (!(error instanceof CloudSignInRequired)) console.warn('Remote workspace sync failed', error)
  })
}

export function startRemoteWorkspaceSync() {
  if (getAppConfig().environment !== 'cloud') return
  void syncRemoteWorkspacesInBackground()
  setInterval(syncRemoteWorkspacesInBackground, 60 * 60 * 1000).unref()
}
