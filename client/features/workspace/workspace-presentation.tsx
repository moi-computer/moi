import { harnessIcon } from '@/client/components/shared/workspace-icon'
import type { WorkspaceSuggestion, WorkspaceEntry, HarnessType } from '@/lib/types'

import { harnessLabel } from '@/client/features/harness/harness-presentation'

type WorkspaceAgentIconsProps = {
  harnesses: HarnessType[]
}

export function WorkspaceAgentIcons({ harnesses }: WorkspaceAgentIconsProps) {
  const label = harnesses.map(harness => harnessLabel[harness]).join(', ')

  return (
    <span role="img" aria-label={label} className="inline-flex shrink-0 items-center -space-x-0.5">
      {harnesses.map(harness => (
        <img
          key={harness}
          src={harnessIcon[harness]}
          alt=""
          className="size-4 shrink-0 rounded-full bg-muted ring-2 ring-muted"
        />
      ))}
    </span>
  )
}

type WorkspaceDisplaySource = WorkspaceEntry | WorkspaceSuggestion

export function workspaceDisplayName(workspace: WorkspaceDisplaySource): string {
  if ('harnesses' in workspace) return workspace.path.split('/').pop() || workspace.path
  if (workspace.name) return workspace.name
  if (workspace.harness === 'openclaw') return workspace.agentId ?? 'OpenClaw agent'
  if (workspace.harness === 'hermes') return workspace.agentId ?? 'Hermes agent'
  return workspace.path.split('/').pop() || workspace.path
}
