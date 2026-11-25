import { WorkspaceSuggestions } from './workspace-suggestions'
import { WorkspaceInvitations } from './workspace-invitations'
import { WorkspaceTrash } from './workspace-trash'
import { workspaceDisplayName } from '@/client/features/workspace/workspace-presentation'
import type { WorkspaceEntry } from '@/lib/types'

import { IconEggCracked, IconLoader2, IconPlus } from '@tabler/icons-react'
import { Link } from 'wouter'

import {
  useWorkspacePreview,
  useWorkspacePreviews,
  useWorkspaces,
  useWorkspaceMetadata
} from './api'
import { CreateWorkspaceDialog } from '@/client/features/workspace/add/create-workspace-dialog'
import { HomeLogo } from './home-logo'
import { useAppConfig } from '@/client/api/app-config'
import { AgentBlobatar } from '@/client/components/shared/agent-blobatar'
import { WorkspaceIcon } from '@/client/components/shared/workspace-icon'
import { Button } from '@/client/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/client/components/ui/tooltip'
import { hasRunningWorkspaceActivity, useLive } from '@/client/features/chat/chat-store'
import { getWorkspaceThemeStyle, usePreloadWorkspaceFonts } from '@/client/runtime/workspace-theme'
import { resolveWorkspaceTheme } from '@/lib/themes'
import { resolveUrl } from '@/lib/navigation'

import { WorkspacePreview } from './workspace-preview'

export function HomePage() {
  usePreloadWorkspaceFonts()
  const workspacesQuery = useWorkspaces()
  useWorkspacePreviews()
  const appConfig = useAppConfig()

  const workspaces = useWorkspaceMetadata(workspacesQuery.data ?? [])

  if (workspacesQuery.isPending) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <IconLoader2 size={20} stroke={1.5} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (workspacesQuery.isError && !workspacesQuery.data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Could not load spaces.</p>
      </div>
    )
  }

  const count = workspaces.length

  return (
    <div className="mx-auto w-full max-w-3xl px-8 pt-14 pb-16">
      <HomeLogo className="mb-10" />

      {count > 0 ? (
        <section className="mb-12">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h1 className="text-sm font-medium text-foreground">Workspaces</h1>
            <CreateWorkspaceDialog
              trigger={
                <Button variant="outline" size="sm">
                  <IconPlus data-icon="inline-start" stroke={1.75} />
                  New
                </Button>
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 md:grid-cols-3">
            {workspaces.map(workspace => (
              <WorkspaceCard key={workspace.id} workspace={workspace} />
            ))}
          </div>
        </section>
      ) : (
        <div className="mb-10 flex flex-col items-center gap-4 px-8 pt-8 pb-16 text-center">
          <IconEggCracked size={56} stroke={0.75} className="text-muted-foreground" />
          <div className="flex flex-col gap-1.5">
            <h2 className="font-medium">Create your first workspace</h2>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Workspace is a place for all views and widgets that share the same context. Create a
              new one or import an existing folder you&rsquo;ve worked in before.
            </p>
          </div>
          <CreateWorkspaceDialog trigger={<Button>New workspace</Button>} />
        </div>
      )}

      <div className="grid gap-8">
        <WorkspaceInvitations />
        {!appConfig.demo && <WorkspaceSuggestions />}
        <WorkspaceTrash />
      </div>
    </div>
  )
}

type WorkspaceCardProps = {
  workspace: WorkspaceEntry
}

function WorkspaceCard({ workspace }: WorkspaceCardProps) {
  const name = workspaceDisplayName(workspace)
  const previewQuery = useWorkspacePreview(workspace.id)
  const theme = workspace.theme ?? previewQuery.data?.theme
  const agent = resolveWorkspaceTheme(theme).agent
  const running = useLive(state => hasRunningWorkspaceActivity(state.activity, workspace.id))
  const updatedAt =
    previewQuery.data?.updatedAt ??
    (workspace.addedAt ? new Date(workspace.addedAt).getTime() : undefined)
  const workspaceHref = `/workspace/${workspace.id}`

  return (
    <div className="group flex min-w-0 flex-col gap-3">
      <div className="relative">
        <WorkspacePreview workspaceId={workspace.id} />
        <Link
          href={workspaceHref}
          aria-label={`Open ${name}`}
          className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {previewQuery.data && !workspace.remote && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  href={resolveUrl('moi:/chat', { workspaceId: workspace.id })}
                  aria-label={`Chat in ${name}`}
                  style={getWorkspaceThemeStyle(theme)}
                  className="absolute right-3 bottom-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <AgentBlobatar
                    preset={agent}
                    color="primary"
                    animated={running}
                    expression={running ? 'thinking' : undefined}
                    size={48}
                    className="drop-shadow-sm drop-shadow-primary/20"
                  />
                </Link>
              }
            />
            <TooltipContent>Chat</TooltipContent>
          </Tooltip>
        )}
      </div>
      <Link
        href={workspaceHref}
        className="flex min-w-0 flex-col gap-2 rounded-lg px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div
          className="flex min-w-0 items-center gap-1.5 font-sans"
          style={getWorkspaceThemeStyle(theme)}
        >
          <WorkspaceIcon
            icon={workspace.icon}
            harness={workspace.harness}
            workspaceTheme={theme}
            className="size-4 shrink-0 rounded-xs"
          />
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
        </div>
        {updatedAt !== undefined && (
          <span className="text-xs text-muted-foreground">{formatUpdatedAt(updatedAt)}</span>
        )}
      </Link>
    </div>
  )
}

function formatUpdatedAt(timestamp: number): string {
  const ms = Date.now() - timestamp
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'Updated just now'
  if (mins < 60) return `Updated ${mins} min${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `Updated ${days} day${days === 1 ? '' : 's'} ago`
  return `Updated ${new Date(timestamp).toLocaleDateString()}`
}
