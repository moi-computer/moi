import { Spinner } from '@/client/components/ui/spinner'
import { useWorkspaceMembers } from '@/client/features/collab/members/hooks'
import { RemoveButton } from '@/client/features/collab/sharing/remove-button'
import { useWorkspaceId } from '../workspace-context'
import { SettingsPage, SettingsRow, SettingsSection } from './settings-layout'

export function AgentsSettings() {
  const workspaceId = useWorkspaceId()
  const { members } = useWorkspaceMembers(workspaceId)
  const agents = members?.filter(member => member.type === 'agent')
  return (
    <SettingsPage title="Agents">
      {!agents ? (
        <Spinner aria-label="Loading agents" />
      ) : agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents connected to this workspace.</p>
      ) : (
        <SettingsSection>
          {agents.map(agent => (
            <SettingsRow
              key={agent.id}
              title={agent.name || 'Unnamed agent'}
              control={
                agent.membershipId && (
                  <RemoveButton
                    workspaceId={workspaceId}
                    label={`Remove ${agent.name || 'agent'}`}
                    action={{ type: 'remove', membershipId: agent.membershipId }}
                  />
                )
              }
            />
          ))}
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
