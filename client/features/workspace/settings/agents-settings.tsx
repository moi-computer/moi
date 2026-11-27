import { Profile } from '@/client/features/collab/components/profile'
import { agentClientLabel } from '@/client/lib/agent-client'
import { identityProfile } from '@/client/features/collab/host-state'
import { Spinner } from '@/client/components/ui/spinner'
import { useWorkspaceMembership } from '@/client/features/collab/members/hooks'
import { MembershipMenu } from '@/client/features/collab/sharing/membership-menu'
import { CopyAgentPromptButton } from '@/client/features/collab/sharing/copy-agent-prompt-button'
import { useWorkspaceLayoutCtx } from '../workspace-layout-context'
import { SettingsPage, SettingsSection } from './settings-layout'

export function AgentsSettings() {
  const { workspaceId, name } = useWorkspaceLayoutCtx()
  const { members } = useWorkspaceMembership(workspaceId)
  const agents = members?.filter(member => member.type === 'agent')
  return (
    <SettingsPage title="Agents">
      <div className="flex flex-col items-start gap-3">
        <p className="max-w-sm text-sm text-balance">
          To invite an agent to this workspace, copy the prompt and paste it into a chat with your
          agent.
        </p>
        <CopyAgentPromptButton
          workspaceId={workspaceId}
          workspaceName={name?.trim() || undefined}
        />
      </div>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">In this workspace</h3>
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
                    workspaceId={workspaceId}
                    action={{ type: 'remove', membershipId: agent.membershipId }}
                  />
                )}
              </div>
            ))}
          </SettingsSection>
        )}
      </section>
    </SettingsPage>
  )
}
