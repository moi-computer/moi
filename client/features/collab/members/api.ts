import { getWorkspaceApiBase } from '@/client/features/workspace/remote'
import { cloudRequest } from '../../account/api'
import { jsonRequest } from '@/client/api/http'

export const inviteWorkspaceMember = (id: string, email: string, workspaceName?: string) =>
  cloudRequest(
    `${getWorkspaceApiBase(id)}/invitations`,
    jsonRequest('POST', { email, workspaceName })
  )
export const removeWorkspaceMember = (id: string, membershipId: string) =>
  cloudRequest(`${getWorkspaceApiBase(id)}/members/${encodeURIComponent(membershipId)}`, {
    method: 'DELETE'
  })
export const revokeWorkspaceInvitation = (id: string, invitationId: string) =>
  cloudRequest(`${getWorkspaceApiBase(id)}/invitations/${encodeURIComponent(invitationId)}`, {
    method: 'DELETE'
  })
