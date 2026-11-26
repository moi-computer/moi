import { machine } from '../machine/store'
import { appEvents } from '@/client/runtime/app-events'
import { setIdentity, getIdentityRevision } from './store'
import {
  setWorkspaceMembers,
  setAllWorkspaceMembers,
  removeWorkspaceMembers,
  clearWorkspaceMembers,
  getWorkspaceMembersRevision
} from '../collab/members/store'
import type { Identity } from './types'
import type { WorkspaceMembers, WorkspaceMembersSnapshot } from '../collab/members/types'

export type IdentityHostApi = {
  machine: typeof machine
  identity: { set: (identity: Identity | null) => void; getRevision: () => number }
  remoteWorkspaces: { sync: () => void }
  workspaceMembers: {
    // Workspaces are named by address: `workspaceId`, or `ownerId:workspaceId` when shared.
    set: (address: string, data: WorkspaceMembers) => void
    setAll: (workspaces: WorkspaceMembersSnapshot[]) => void
    remove: (address: string) => void
    clear: () => void
    getRevision: () => number
  }
}
export function installIdentityHostApi() {
  if (typeof window === 'undefined') return
  const host = window as Window & { moi?: Partial<IdentityHostApi> & Record<string, unknown> }
  host.moi ??= {}
  host.moi.machine = machine
  host.moi.identity = { set: setIdentity, getRevision: getIdentityRevision }
  host.moi.remoteWorkspaces = { sync: () => appEvents.syncRemoteWorkspaces() }
  host.moi.workspaceMembers = {
    set: setWorkspaceMembers,
    setAll: setAllWorkspaceMembers,
    remove: removeWorkspaceMembers,
    clear: clearWorkspaceMembers,
    getRevision: getWorkspaceMembersRevision
  }
}
