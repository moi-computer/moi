import { useState } from 'react'
import { useLocation } from 'wouter'
import { parseRemoteWorkspaceTarget } from '@/lib/workspace-config'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppConfig } from '@/client/api/app-config'
import { jsonRequest } from '@/client/api/http'
import { Button } from '@/client/components/ui/button'
import { cloudRequest } from '@/client/features/account/api'
import type { HarnessType } from '@/lib/types'
import { AddWorkspaceDialog } from '@/client/features/workspace/add/add-workspace-dialog'
import { addSharedWorkspace, checkSharedWorkspaceAccess } from '@/client/features/workspace/add/api'

type WorkspaceInvitation = {
  id: string
  workspaceName: string
  inviter: { name: string }
}
const invitationsKey = ['workspace-invitations']

export function WorkspaceInvitations() {
  const cloud = useAppConfig().environment === 'cloud'
  const client = useQueryClient()
  const [, navigate] = useLocation()
  const [choice, setChoice] = useState<WorkspaceInvitation>()
  const query = useQuery({
    queryKey: invitationsKey,
    enabled: cloud,
    queryFn: async () =>
      (await (await cloudRequest('/api/workspaces/invitations')).json()) as {
        invitations: WorkspaceInvitation[]
      },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false
  })
  const add = useMutation({
    mutationFn: async ({
      invitationId,
      harness
    }: {
      invitationId: string
      harness: HarnessType
    }) => {
      const response = await cloudRequest(
        `/api/invitations/${encodeURIComponent(invitationId)}/accept`,
        jsonRequest('POST', {})
      )
      const { remote } = (await response.json()) as { remote: unknown }
      const target = parseRemoteWorkspaceTarget(remote)
      void client.invalidateQueries({ queryKey: invitationsKey })
      void client.invalidateQueries({ queryKey: ['shared-workspaces'] })
      await checkSharedWorkspaceAccess(client, target)
      return addSharedWorkspace(client, target, harness)
    },
    onSuccess: entry => {
      setChoice(undefined)
      navigate(`/workspace/${entry.id}`)
    }
  })
  if (!cloud) return null
  const invitations = query.data?.invitations ?? []
  return (
    <>
      {invitations.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-sm font-medium">Invitations</h2>
          <ul className="border-t border-border">
            {invitations.map(invitation => (
              <li
                key={invitation.id}
                className="flex items-center gap-2 border-b border-border px-1 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{invitation.workspaceName}</p>
                  <p className="text-xs text-muted-foreground">
                    Invited by {invitation.inviter.name}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setChoice(invitation)}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {choice && (
        <AddWorkspaceDialog
          workspaceName={choice.workspaceName}
          isPending={add.isPending}
          errorMessage={add.error?.message}
          onSubmit={harness => add.mutate({ invitationId: choice.id, harness })}
          onClose={() => {
            add.reset()
            setChoice(undefined)
          }}
        />
      )}
    </>
  )
}
