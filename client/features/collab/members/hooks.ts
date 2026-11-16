import { workspaceKeys } from '@/client/api/workspace-keys'
import type { WorkspaceLayoutResponse } from '@/lib/types'
import { useSyncExternalStore } from 'react'
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import { useWorkspaces } from '../../home/api'
import { getAccountGeneration } from '../../identity/store'
import { useIdentity } from '../../identity/use-identity'
import { getWorkspaceMembers, subscribeWorkspaceDirectory, updateWorkspaceMembers } from './store'
import { inviteWorkspaceMember, removeWorkspaceMember, revokeWorkspaceInvitation } from './api'
import type { WorkspaceMembers } from './types'

export type MembershipAction =
  | { type: 'invite'; email: string }
  | { type: 'remove'; membershipId: string }
  | { type: 'revoke'; invitationId: string }

type PendingAction = { id: number; action: MembershipAction }
export function applyPendingMembership(
  data: WorkspaceMembers | undefined,
  actions: PendingAction[]
) {
  if (!data) return undefined
  let { members, invitations } = data
  for (const { id, action } of actions) {
    if (action.type === 'remove')
      members = members.filter(member => member.membershipId !== action.membershipId)
    else if (action.type === 'revoke')
      invitations = invitations.filter(invitation => invitation.id !== action.invitationId)
    else if (!invitations.some(invitation => invitation.email === action.email))
      invitations = [
        ...invitations,
        { id: `pending:${id}`, email: action.email, expiresAt: '', pending: true }
      ]
  }
  return { members, invitations }
}
// Member lists are published by the cloud host; this only reads what it last sent.
export function useWorkspaceMembers(workspaceId: string | undefined) {
  // The owner-only list is built from the identity, so follow it too.
  useIdentity()
  const mutationKey = ['workspace-members-action', getAccountGeneration(), workspaceId]
  const read = () => (workspaceId ? getWorkspaceMembers(workspaceId) : undefined)
  const published = useSyncExternalStore(subscribeWorkspaceDirectory, read, read)
  const pending = useMutationState({
    filters: { mutationKey, status: 'pending', exact: true },
    select: mutation => ({
      id: mutation.state.submittedAt,
      action: mutation.state.variables as MembershipAction
    })
  })
  const data = applyPendingMembership(published, pending)
  return {
    data,
    members: data?.members,
    invitations: data?.invitations,
    // Unknown until the host publishes its first snapshot for this account.
    isPending: !published,
    isSuccess: !!published
  }
}
export function useMembershipAction(workspaceId: string) {
  const workspaces = useWorkspaces()

  const identity = useIdentity()
  const accountGeneration = getAccountGeneration()
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['workspace-members-action', accountGeneration, workspaceId],
    mutationFn: async (action: MembershipAction) => {
      if (
        !identity ||
        identity.type !== 'user' ||
        identity.isAnonymous ||
        accountGeneration !== getAccountGeneration()
      )
        throw new Error('Sign in to manage workspace members')
      if (action.type === 'invite') {
        const layout = client.getQueryData<WorkspaceLayoutResponse>(
          workspaceKeys.layout(workspaceId)
        )
        const name = layout?.isRemote
          ? layout.name
          : workspaces.data?.find(workspace => workspace.id === workspaceId)?.name
        return inviteWorkspaceMember(workspaceId, action.email, name?.trim() || undefined)
      }
      if (action.type === 'remove') return removeWorkspaceMember(workspaceId, action.membershipId)
      return revokeWorkspaceInvitation(workspaceId, action.invitationId)
    },
    // The optimistic overlay ends here, so keep its result until the host's next snapshot.
    onSuccess: (_response, action) => {
      if (accountGeneration !== getAccountGeneration()) return
      updateWorkspaceMembers(
        workspaceId,
        current => applyPendingMembership(current, [{ id: Date.now(), action }])!
      )
    }
  })
}
