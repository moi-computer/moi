import { useState } from 'react'

import { Button } from '@/client/components/ui/button'
import { Dialog, DialogClose } from '@/client/components/ui/dialog'
import { workspaceDisplayName } from '@/client/features/workspace/workspace-presentation'
import type { HarnessType } from '@/lib/types'

import { WorkspaceAgentSelector } from './workspace-agent-selector'
import { useHarnessStatuses } from '@/client/features/harness/api'
import { getWorkspaceAgentOptions } from './workspace-agent-options'
import { WorkspaceDialogContent } from './workspace-dialog-content'
import type { WorkspaceImportChoice } from './use-workspace-import'

type ImportWorkspaceDialogProps = {
  choice: WorkspaceImportChoice
  isPending: boolean
  errorMessage?: string
  onHarnessChange: (harness: HarnessType) => void
  onSubmit: () => void
  onReset: () => void
}

export function ImportWorkspaceDialog({
  choice,
  isPending,
  errorMessage,
  onHarnessChange,
  onSubmit,
  onReset
}: ImportWorkspaceDialogProps) {
  const [open, setOpen] = useState(true)
  const info = useHarnessStatuses()
  const isChecking = info.isPending || info.isFetching
  const installed = info.isError ? undefined : info.data
  const options = getWorkspaceAgentOptions(installed, choice.workspace.harnesses)
  const detectionError = !isChecking && !installed ? 'Could not check installed agents.' : undefined
  const canImport =
    !isPending &&
    !isChecking &&
    !detectionError &&
    options.some(option => option.harness === choice.selectedHarness && !option.disabled)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isPending) return
    setOpen(nextOpen)
  }

  function handleOpenChangeComplete(nextOpen: boolean) {
    if (!nextOpen) onReset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
    >
      <WorkspaceDialogContent showCloseButton={!isPending}>
        <WorkspaceAgentSelector
          title={`Import ${workspaceDisplayName(choice.workspace)}`}
          selectedHarness={choice.selectedHarness}
          options={options}
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
          onHarnessChange={onHarnessChange}
          onSubmit={() => {
            if (canImport) onSubmit()
          }}
        />
      </WorkspaceDialogContent>
    </Dialog>
  )
}
