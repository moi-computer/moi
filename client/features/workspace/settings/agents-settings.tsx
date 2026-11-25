import { Profile } from '@/client/features/collab/components/profile'
import { agentClientLabel } from '@/client/lib/agent-client'
import { identityProfile } from '@/client/features/collab/host-state'
import { Spinner } from '@/client/components/ui/spinner'
import { useWorkspaceMembership } from '@/client/features/collab/members/hooks'
import { MembershipMenu } from '@/client/features/collab/sharing/membership-menu'
import { useWorkspaceId } from '../workspace-context'
import { SettingsPage, SettingsSection } from './settings-layout'

export function AgentsSettings() {
  const workspaceId = useWorkspaceId()
  const { members } = useWorkspaceMembership(workspaceId)
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
            <div key={agent.id} className="flex items-center gap-3 px-3.5 py-3">
              <Profile
                profile={identityProfile({ ...agent, name: agent.name || 'Unnamed agent' })}
                description={agentClientLabel(agent.client)}
                className="flex-1"
              />
              {agent.membershipId && (
                <MembershipMenu
                  removeLabel="Remove from workspace"
                  workspaceId={workspaceId}
                  action={{ type: 'remove', membershipId: agent.membershipId }}
                />
              )}
            </div>
          ))}
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
