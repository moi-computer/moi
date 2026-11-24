import { IconLoader2 } from '@tabler/icons-react'

import { useAppConfig } from '@/client/api/app-config'
import { WorkspaceIcon } from '@/client/components/shared/workspace-icon'
import { Button } from '@/client/components/ui/button'
import { WorkspaceListRow, WorkspaceListSection } from './workspace-list-section'
import { toast } from '@/client/components/ui/toast'
import type { TrashedWorkspace } from '@/lib/types'

import { useRestoreWorkspace, useTrashedWorkspaces } from './api'

export function WorkspaceTrash() {
  const { environment, demo } = useAppConfig()
  const trash = useTrashedWorkspaces(environment === 'cloud' && !demo)
  const workspaces = trash.data ?? []
  if (workspaces.length === 0) return null
  return (
    <WorkspaceListSection
      title="Trash"
      defaultOpen={false}
      footerNote="Workspaces in trash are automatically deleted after 30 days"
    >
      {workspaces.map(workspace => (
        <TrashRow key={workspace.id} workspace={workspace} />
      ))}
    </WorkspaceListSection>
  )
}

type TrashRowProps = { workspace: TrashedWorkspace }

function TrashRow({ workspace }: TrashRowProps) {
  const restore = useRestoreWorkspace()
  return (
    <WorkspaceListRow>
      <WorkspaceIcon
        icon={workspace.icon}
        harness={workspace.harness}
        workspaceTheme={workspace.theme}
        className="size-4 shrink-0 rounded-xs"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {workspace.name}
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-busy={restore.isPending}
        disabled={restore.isPending}
        onClick={() =>
          restore.mutate(workspace.id, {
            onError: error => toast.add({ title: error.message, type: 'error' })
          })
        }
      >
        {restore.isPending && (
          <IconLoader2 data-icon="inline-start" stroke={1.75} className="animate-spin" />
        )}
        Restore
      </Button>
    </WorkspaceListRow>
  )
}
