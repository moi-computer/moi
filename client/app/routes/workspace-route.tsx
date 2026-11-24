import { WorkspaceRegistration } from './workspace-registration'
import { WorkspaceErrorMessage } from '@/client/features/workspace/workspace-error-states'
import { WorkspacePendingScreen } from '@/client/features/workspace/workspace-pending-screen'
import { useWorkspaceMembers } from '@/client/features/collab/members/hooks'
import { useWorkspaceHarnessChanges } from '@/client/features/workspace/harness-transition'
import { useWorkspaceTheme } from '@/client/runtime/workspace-theme'
import { CollabProvider } from '@/client/features/collab'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { AddWorkspaceDialog } from '@/client/features/workspace/add/add-workspace-dialog'
import { useChangeWorkspaceHarness } from '@/client/features/workspace/api'
import { useWorkspaceSocket } from '@/client/features/workspace/use-workspace-socket'

import { workspaceKeys } from '@/client/api/workspace-keys'
import { homePath, useAppConfig } from '@/client/api/app-config'
import { SidebarLayout } from '@/client/app/shell/sidebar-layout'
import { useSelectedSession } from '@/client/features/chat/sessions/use-selected-session'
import { useAppletCacheInvalidation } from '@/client/features/applets/use-applet'
import { Workspace } from '@/client/features/workspace/workspace-context'
import {
  WorkspaceLayoutProvider,
  useWorkspaceLayoutCtx
} from '@/client/features/workspace/workspace-layout-context'
import { WorkspaceScreen } from '@/client/features/workspace/workspace-screen'
import { useViews } from '@/client/features/views/api'
import { useWidgets } from '@/client/features/overview/api'
import { useWorkspaceEvent } from '@/client/runtime/use-client-events'
import { BROWSER_TAB_ID } from '@/client/lib/browser-tab-id'

type WorkspaceRouteProps = {
  id: string
}

// Navigation reads the raw browser address so encoded paths and query params
// are decoded exactly once; the route only owns the workspace ID.
export function WorkspaceRoute({ id }: WorkspaceRouteProps) {
  const separator = id.indexOf(':')
  if (separator !== -1)
    return (
      <WorkspaceRegistration
        key={id}
        userId={id.slice(0, separator)}
        workspaceId={id.slice(separator + 1)}
      />
    )
  return (
    <SidebarLayout>
      <Workspace id={id}>
        <WorkspaceLayoutProvider key={id} id={id}>
          <WorkspaceEntry id={id} />
        </WorkspaceLayoutProvider>
      </Workspace>
    </SidebarLayout>
  )
}

function WorkspaceEntry({ id }: WorkspaceRouteProps) {
  const { isRemote, harness, name } = useWorkspaceLayoutCtx()
  const [, navigate] = useLocation()
  const change = useChangeWorkspaceHarness(id)
  const client = useQueryClient()

  if (isRemote && !harness) {
    return (
      <AddWorkspaceDialog
        workspaceName={name || id}
        isPending={change.isPending}
        errorMessage={change.error?.message}
        onClose={() => navigate(homePath())}
        onSubmit={agent =>
          change.mutate(agent, {
            onSuccess: () => void client.invalidateQueries({ queryKey: workspaceKeys.layout(id) })
          })
        }
      />
    )
  }
  return <WorkspaceLive id={id} />
}

// One owner connection carries shared updates always and presence on Cloud.
function WorkspaceLive({ id }: WorkspaceRouteProps) {
  const { environment } = useAppConfig()
  const socket = useWorkspaceSocket(id)
  return (
    <CollabProvider workspaceId={id} enabled={environment === 'cloud'} socket={socket}>
      <WorkspaceContent id={id} />
    </CollabProvider>
  )
}

function WorkspaceContent({ id }: WorkspaceRouteProps) {
  useWorkspaceMembers(id)
  const queryClient = useQueryClient()
  const [selectedSessionId] = useSelectedSession()
  const { isLoading: layoutLoading, layout, harness } = useWorkspaceLayoutCtx()
  useWorkspaceHarnessChanges(id, harness)
  useWorkspaceTheme(layout.theme)
  const widgets = useWidgets(id)
  const views = useViews(id)
  useAppletCacheInvalidation()

  useWorkspaceEvent(id, event => {
    if (event.type === 'workspace-config:changed') {
      // Skip our own save: the cache already holds it, and the refetch could
      // land an older value over a newer optimistic change.
      if (event.origin === BROWSER_TAB_ID) return
      queryClient.invalidateQueries({ queryKey: workspaceKeys.layout(id) })
    } else if (event.type === 'widgets-list:changed' || event.type === 'widget:changed') {
      // widget:changed too: a rebundle bumps the widget's content revision, and
      // the thumbnail invalidation hook reads it off this query.
      queryClient.invalidateQueries({ queryKey: workspaceKeys.widgets(id) })
    } else if (event.type === 'view:changed') {
      // view:changed also bumps the built bundle revision used by thumbnail
      // freshness checks.
      queryClient.invalidateQueries({ queryKey: workspaceKeys.views(id) })
    }
  })

  const contentPending =
    layoutLoading || selectedSessionId === undefined || widgets.isLoading || views.isLoading

  if ((!views.data && views.isError) || (widgets.isError && !widgets.hasData)) {
    return (
      <WorkspacePendingScreen setupRequired>
        <WorkspaceErrorMessage
          title="Couldn’t load workspace content"
          retrying={views.isFetching || widgets.isFetching}
          onRetry={() => {
            void views.refetch()
            void widgets.refetch()
          }}
        >
          Please try again.
        </WorkspaceErrorMessage>
      </WorkspacePendingScreen>
    )
  }

  return (
    <WorkspaceScreen
      contentPending={contentPending}
      widgets={widgets.data}
      views={views.data ?? []}
    />
  )
}
