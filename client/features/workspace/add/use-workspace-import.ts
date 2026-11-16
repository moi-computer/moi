import { useState } from 'react'

import { useImportWorkspace } from '@/client/features/workspace/add/api'
import { HARNESS_ORDER } from '@/lib/harness-types'
import type { DiscoveredWorkspace, WorkspaceEntry, HarnessType } from '@/lib/types'

export function workspaceImportDefaultType(workspace: DiscoveredWorkspace): HarnessType {
  return workspace.harnesses[0] ?? HARNESS_ORDER[0]
}

type UseWorkspaceImportProps = {
  onSuccess: (entry: WorkspaceEntry) => void
}

export type WorkspaceImportChoice = {
  workspace: DiscoveredWorkspace
  selectedHarness: HarnessType
}

export function useWorkspaceImport({ onSuccess }: UseWorkspaceImportProps) {
  const mutation = useImportWorkspace()
  const [choice, setChoice] = useState<WorkspaceImportChoice | null>(null)

  function startImport(workspace: DiscoveredWorkspace) {
    mutation.reset()
    setChoice({
      workspace,
      selectedHarness: workspaceImportDefaultType(workspace)
    })
  }

  function selectHarness(harness: HarnessType) {
    setChoice(current => (current ? { ...current, selectedHarness: harness } : current))
  }

  function submit() {
    if (!choice || mutation.isPending) return
    mutation.mutate(
      {
        path: choice.workspace.path,
        harness: choice.selectedHarness
      },
      { onSuccess }
    )
  }

  function reset() {
    setChoice(null)
    mutation.reset()
  }

  return {
    choice,
    isPending: mutation.isPending,
    error: mutation.error,
    startImport,
    selectHarness,
    submit,
    reset
  }
}
