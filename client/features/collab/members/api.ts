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

export async function createAgentInviteLink(workspaceId: string, workspaceName?: string) {
  const response = await cloudRequest(
    `${getWorkspaceApiBase(workspaceId)}/agent-invitations/link`,
    jsonRequest('POST', { workspaceName })
  )
  if (response.status !== 201 || !response.headers.get('content-type')?.startsWith('text/plain'))
    throw new Error('The workspace did not return an invitation')
  return response.text()
}
