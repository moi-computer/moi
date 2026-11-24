import { useHarnessStatus, useRetryHarnessStatus } from '@/client/features/harness/api'
import { useCallback } from 'react'
import { useAppConfig } from '@/client/api/app-config'

import { WorkspaceLoadingState } from '../workspace-pending-screen'
import { useWorkspaceHarness } from '../api'
import {
  useWorkspaceWelcome,
  WorkspaceWelcomeState,
  type WorkspaceWelcomeStateProps
} from './workspace-welcome-state'
import { WorkspaceLoginState } from './workspace-login-state'
import {
  HarnessUnavailableState,
  HarnessCheckFailedState,
  WorkspaceFolderMissingState
} from '../workspace-error-states'

export function useWorkspaceSetup(
  workspaceId: string,
  contentPending = false,
  welcome: WorkspaceWelcomeStateProps = {}
) {
  const { environment, demo } = useAppConfig()
  const workspace = useWorkspaceHarness(workspaceId)
  const { data } = workspace
  const status = useHarnessStatus(
    data?.hasAuthOverrides || data?.isFolderMissing ? undefined : data?.harness
  )
  const retry = useRetryHarnessStatus()
  const readiness = status.isEnabled ? status : workspace
  const isFetching = readiness.isFetching || workspace.isFetching || retry.isPending
  const refetch = workspace.isError ? workspace.refetch : readiness.refetch
  const availability = readiness.data?.availability
  const isError = readiness.isError || workspace.isError || retry.isError
  const checking = workspace.isPending || readiness.isPending
  const recheck = useCallback(() => {
    void refetch()
  }, [refetch])

  const retryStatus = () => {
    if (status.isEnabled && !workspace.isError) retry.mutate()
    else recheck()
  }

  function renderRecovery() {
    if (checking) return undefined
    // Background network failures do not invalidate a known working workspace.
    if (isError && availability?.status === 'available') return undefined
    if (isError || !data || !availability) {
      return <HarnessCheckFailedState retrying={isFetching} onRetry={retryStatus} />
    }
    if (data.isFolderMissing) {
      return <WorkspaceFolderMissingState workspaceId={workspaceId} />
    }
    const { harness } = data
    if (availability.status === 'available') return undefined
    if (
      (availability.status === 'login-required' ||
        (environment === 'local' &&
          !demo &&
          availability.status === 'unavailable' &&
          availability.code === 'not-installed')) &&
      (harness === 'claude-code' || harness === 'codex')
    ) {
      return (
        <WorkspaceLoginState
          harness={harness}
          reason={availability.reason}
          checking={isFetching}
          onConnected={recheck}
          onRecheck={retryStatus}
        />
      )
    }
    return (
      <HarnessUnavailableState
        harness={harness}
        availability={availability}
        retrying={isFetching}
        onRetry={retryStatus}
      />
    )
  }

  const welcoming = useWorkspaceWelcome(workspaceId)
  const recovery = renderRecovery()
  const ready = !recovery && !contentPending && !checking
  return {
    content: welcoming ? (
      <WorkspaceWelcomeState {...welcome} />
    ) : (
      (recovery ?? <WorkspaceLoadingState />)
    ),
    ready: ready && !welcoming,
    setupRequired: welcoming || !!recovery
  }
}
