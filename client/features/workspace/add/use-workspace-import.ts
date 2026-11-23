import { useState } from 'react'

import { useImportWorkspace } from '@/client/features/workspace/add/api'
import type { DiscoveredWorkspace, WorkspaceEntry, HarnessType } from '@/lib/types'

type UseWorkspaceImportProps = {
  onSuccess: (entry: WorkspaceEntry) => void
}

export function useWorkspaceImport({ onSuccess }: UseWorkspaceImportProps) {
  const mutation = useImportWorkspace()
  const [workspace, setWorkspace] = useState<DiscoveredWorkspace>()

  function startImport(workspace: DiscoveredWorkspace) {
    mutation.reset()
    setWorkspace(workspace)
  }

  function submit(harness: HarnessType) {
    if (!workspace || mutation.isPending) return
    mutation.mutate(
      {
        path: workspace.path,
        harness
      },
      { onSuccess }
    )
  }

  function reset() {
    setWorkspace(undefined)
    mutation.reset()
  }

  return {
    workspace,
    isPending: mutation.isPending,
    error: mutation.error,
    startImport,
    submit,
    reset
  }
}
