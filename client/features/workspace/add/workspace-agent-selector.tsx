import { HarnessSelector } from '@/client/features/harness/harness-selector'
import type { ReactNode } from 'react'

import { Button } from '@/client/components/ui/button'
import { DialogDescription, DialogTitle } from '@/client/components/ui/dialog'
import { Skeleton } from '@/client/components/ui/skeleton'
import type { HarnessStatuses, HarnessType } from '@/lib/types'

import {
  resolveWorkspaceHarnessSelection,
  type WorkspaceAgentOption
} from './workspace-agent-options'

const WORKSPACE_AGENT_DESCRIPTION = 'Choose the agent to build the workspace'
type WorkspaceAgentSelectorProps = {
  title: string
  description?: string
  selectedHarness?: HarnessType
  options: WorkspaceAgentOption[]
  statuses?: HarnessStatuses
  detectedHarnesses?: HarnessType[]
  isLoading?: boolean
  isPending: boolean
  errorMessage?: string
  emptyMessage?: string
  secondaryAction: ReactNode
  primaryLabel: string
  pendingLabel?: string
  onHarnessChange: (harness: HarnessType) => void
  onSubmit: (harness: HarnessType) => void
}

export function WorkspaceAgentSelector({
  title,
  description = WORKSPACE_AGENT_DESCRIPTION,
  selectedHarness,
  options,
  statuses,
  detectedHarnesses,
  isLoading = false,
  isPending,
  errorMessage,
  emptyMessage,
  secondaryAction,
  primaryLabel,
  pendingLabel,
  onHarnessChange,
  onSubmit
}: WorkspaceAgentSelectorProps) {
  const harness = resolveWorkspaceHarnessSelection(
    options,
    selectedHarness,
    statuses,
    detectedHarnesses
  )

  return (
    <div className="flex min-w-[min(22rem,calc(100vw-5rem))] flex-col gap-5">
      <div className="flex w-0 min-w-full flex-col gap-0.5 pr-8">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </div>

      <div className="flex flex-col gap-4">
        {isLoading ? (
          <div
            className="flex flex-wrap justify-center gap-2"
            role="status"
            aria-label="Checking installed agents"
          >
            <Skeleton className="h-32 min-w-32 flex-1" />
            <Skeleton className="h-32 min-w-32 flex-1" />
          </div>
        ) : (
          <HarnessSelector
            disabled={isPending}
            options={options}
            selectedHarness={harness}
            onHarnessChange={onHarnessChange}
          />
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="w-0 min-w-full text-xs text-destructive">
          {errorMessage}
        </p>
      )}

      {emptyMessage && !harness && !isPending && !errorMessage && (
        <p className="w-0 min-w-full text-sm text-muted-foreground">{emptyMessage}</p>
      )}

      <div className="flex items-center justify-end gap-2">
        {secondaryAction}
        <Button onClick={() => harness && onSubmit(harness)} disabled={isPending || !harness}>
          {isPending && pendingLabel ? pendingLabel : primaryLabel}
        </Button>
      </div>
    </div>
  )
}
