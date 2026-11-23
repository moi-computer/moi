import { useState } from 'react'

import { Button } from '@/client/components/ui/button'
import { Dialog, DialogClose } from '@/client/components/ui/dialog'
import { workspaceDisplayName } from '@/client/features/workspace/workspace-presentation'
import type { DiscoveredWorkspace, HarnessType } from '@/lib/types'

import { WorkspaceAgentSelector } from './workspace-agent-selector'
import { useHarnessStatuses } from '@/client/features/harness/api'
import { getWorkspaceAgentOptions } from './workspace-agent-options'
import { WorkspaceDialogContent } from './workspace-dialog-content'

type AddWorkspaceDialogProps = {
  isPending: boolean
  errorMessage?: string
  onSubmit: (harness: HarnessType) => void
  onClose: () => void
} & (
  | { workspace: DiscoveredWorkspace; workspaceName?: never }
  | { workspace?: never; workspaceName: string }
)

export function AddWorkspaceDialog({
  workspace,
  workspaceName,
  isPending,
  errorMessage,
  onSubmit,
  onClose
}: AddWorkspaceDialogProps) {
  const [open, setOpen] = useState(true)
  const [harness, setHarness] = useState<HarnessType>()
  const info = useHarnessStatuses()
  const isChecking = info.isPending || info.isFetching
  const installed = info.isError ? undefined : info.data
  const options = getWorkspaceAgentOptions(installed, workspace?.harnesses).filter(
    ({ harness }) => workspace || harness === 'claude-code' || harness === 'codex'
  )
  const detectionError = !isChecking && !installed ? 'Could not check installed agents.' : undefined

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isPending) return
    setOpen(nextOpen)
  }

  function handleOpenChangeComplete(nextOpen: boolean) {
    if (!nextOpen) onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
    >
      <WorkspaceDialogContent showCloseButton={!isPending}>
        <WorkspaceAgentSelector
          title={workspace ? `Import ${workspaceDisplayName(workspace)}` : 'Add shared workspace'}
          description={workspaceName ? `Choose an agent for ${workspaceName}` : undefined}
          selectedHarness={harness}
          options={options}
          statuses={installed}
          detectedHarnesses={workspace?.harnesses}
          isLoading={isChecking && !installed}
          isPending={isPending || isChecking || Boolean(detectionError)}
          errorMessage={detectionError ?? errorMessage}
          secondaryAction={
            <DialogClose render={<Button variant="secondary" />} disabled={isPending}>
              Cancel
            </DialogClose>
          }
          primaryLabel="Add workspace"
          pendingLabel={isPending ? 'Adding…' : undefined}
          onHarnessChange={setHarness}
          onSubmit={onSubmit}
        />
      </WorkspaceDialogContent>
    </Dialog>
  )
}
