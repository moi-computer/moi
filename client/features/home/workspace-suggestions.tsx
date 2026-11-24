import { useState } from 'react'
import { IconPlus } from '@tabler/icons-react'
import { useLocation } from 'wouter'

import { useAppConfig } from '@/client/api/app-config'
import { Button } from '@/client/components/ui/button'
import { DemoDialog } from '@/client/features/demo/demo-dialog'
import { AddWorkspaceDialog } from '@/client/features/workspace/add/add-workspace-dialog'
import { useWorkspaceImport } from '@/client/features/workspace/add/use-workspace-import'
import {
  WorkspaceAgentIcons,
  workspaceDisplayName
} from '@/client/features/workspace/workspace-presentation'
import { useWorkspaceSuggestions } from './api'
import { WorkspaceListRow, WorkspaceListSection } from './workspace-list-section'

export function WorkspaceSuggestions() {
  const { data: workspaces = [] } = useWorkspaceSuggestions()
  const { demo } = useAppConfig()
  const [promoOpen, setPromoOpen] = useState(false)
  const [, navigate] = useLocation()
  const importFlow = useWorkspaceImport({
    onSuccess: entry => navigate(`/workspace/${entry.id}`)
  })

  return (
    <>
      {workspaces.length > 0 && (
        <WorkspaceListSection title="Suggestions" defaultOpen={false}>
          {workspaces.map(workspace => (
            <WorkspaceListRow key={workspace.path}>
              <WorkspaceAgentIcons harnesses={workspace.harnesses} />
              <span className="shrink-0 text-sm font-medium text-foreground">
                {workspaceDisplayName(workspace)}
              </span>
              <span
                title={workspace.path}
                className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
              >
                {workspace.displayPath ?? workspace.path}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (demo ? setPromoOpen(true) : importFlow.startImport(workspace))}
              >
                <IconPlus stroke={1.75} />
                Add
              </Button>
            </WorkspaceListRow>
          ))}
        </WorkspaceListSection>
      )}

      {importFlow.workspace && (
        <AddWorkspaceDialog
          key={importFlow.workspace.path}
          workspace={importFlow.workspace}
          isPending={importFlow.isPending}
          errorMessage={importFlow.error?.message}
          onSubmit={importFlow.submit}
          onClose={importFlow.reset}
        />
      )}
      <DemoDialog open={promoOpen} onOpenChange={setPromoOpen} />
    </>
  )
}
