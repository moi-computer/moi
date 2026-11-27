import { useId } from 'react'
import { IconArrowUpRight } from '@tabler/icons-react'
import { agentIcon } from '@/client/lib/agent-client'
import { cn } from '@/client/lib/cn'
import {
  WorkspaceSettingsDialog,
  WorkspaceSettingsDialogTrigger
} from '../../workspace/settings/workspace-settings-dialog'
import { CopyAgentPromptButton } from './copy-agent-prompt-button'

const avatars = [
  { client: 'grok-bot', position: 'top-12 -left-5 rotate-5' },
  { client: 'duet', position: 'bottom-3 -left-4 rotate-60' },
  { client: 'dot', position: '-bottom-3 left-9 rotate-4' },
  { client: 'instinct', position: '-bottom-4 left-24 rotate-12' },
  { client: 'muse', position: '-bottom-2 left-40 -rotate-5' }
]

type AgentInviteProps = {
  workspaceId: string
  workspaceName?: string
}

export function AgentInvite({ workspaceId, workspaceName }: AgentInviteProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className="relative flex flex-col overflow-clip rounded-2xl bg-popover texture-gradient-linear p-5 shadow-md"
    >
      {avatars.map(({ client, position }) => (
        <img
          key={client}
          src={agentIcon(client)}
          alt={client}
          className={cn('absolute size-10 rounded-full shadow-sm', position)}
        />
      ))}
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-medium">
          Invite your agent
        </h3>
        <WorkspaceSettingsDialog initialPage="agents">
          <WorkspaceSettingsDialogTrigger className="inline-flex shrink-0 cursor-pointer items-center text-sm text-muted-foreground opacity-0 group-hover/sharing-menu:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(hover:none)]:opacity-100">
            See all
            <IconArrowUpRight size={16} stroke={1.5} aria-hidden="true" />
          </WorkspaceSettingsDialogTrigger>
        </WorkspaceSettingsDialog>
      </div>
      <p className="mt-2 max-w-64 pl-4 text-sm text-muted-foreground">
        Give your agent a prompt to work in this workspace on your behalf
      </p>
      <div className="mt-3 self-end">
        <CopyAgentPromptButton workspaceId={workspaceId} workspaceName={workspaceName} />
      </div>
    </section>
  )
}
