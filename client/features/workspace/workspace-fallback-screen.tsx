import type { ReactNode } from 'react'

import { ScreenShell } from '@/client/components/shared/screen-shell'
import { Spinner } from '@/client/components/ui/spinner'
import { WorkspacePane } from './workspace-pane'

type WorkspaceFallbackScreenProps = {
  showPanel?: boolean
  children: ReactNode
}

export function WorkspaceFallbackScreen({
  showPanel = false,
  children
}: WorkspaceFallbackScreenProps) {
  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col font-sans text-foreground">
      {showPanel ? (
        <WorkspacePane mode="fullscreen">
          <ScreenShell aria-label="Workspace setup">{children}</ScreenShell>
        </WorkspacePane>
      ) : (
        children
      )}
    </div>
  )
}

export function WorkspaceLoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner className="size-6 text-muted-foreground" stroke={1.5} />
    </div>
  )
}
