import type { ViewInfo, WidgetInfo } from '@/lib/types'

import { useWorkspaceLayoutCtx } from './workspace-layout-context'
import { WorkspaceContent } from './workspace-content'
import { useWorkspaceSetup } from './setup/workspace-setup'
import { WorkspaceFallbackScreen } from './workspace-fallback-screen'

type WorkspaceScreenProps = {
  contentPending: boolean
  widgets: WidgetInfo[]
  views: ViewInfo[]
}

export function WorkspaceScreen({ contentPending, widgets, views }: WorkspaceScreenProps) {
  const { layout, workspaceId, name, harness } = useWorkspaceLayoutCtx()
  const { content, ready, showPanel } = useWorkspaceSetup(workspaceId, contentPending, {
    name: name ?? 'Workspace',
    icon: layout.icon,
    harness: harness,
    workspaceTheme: layout.theme
  })

  return ready ? (
    <WorkspaceContent widgets={widgets} views={views} />
  ) : (
    <WorkspaceFallbackScreen showPanel={showPanel}>{content}</WorkspaceFallbackScreen>
  )
}
