import type { ReactNode } from 'react'
import { homePath } from '@/client/api/app-config'
import { HttpError } from '@/client/api/http'
import { useLocation } from 'wouter'
import { IconFolderOff } from '@tabler/icons-react'

import { harnessIcon } from '@/client/components/shared/workspace-icon'
import { Button } from '@/client/components/ui/button'
import { useDeleteWorkspace } from '@/client/features/home/api'
import type { HarnessAvailability, HarnessType } from '@/lib/types'

type RetryProps = {
  retrying: boolean
  onRetry: () => void
}

type HarnessCheckFailedStateProps = RetryProps

export function HarnessCheckFailedState(props: HarnessCheckFailedStateProps) {
  return (
    <WorkspaceErrorMessage title="Could not check your agent" {...props}>
      Could not check this workspace’s agent. Try again.
    </WorkspaceErrorMessage>
  )
}

type WorkspaceFolderMissingStateProps = {
  workspaceId: string
}

export function WorkspaceFolderMissingState({ workspaceId }: WorkspaceFolderMissingStateProps) {
  const deleteWorkspace = useDeleteWorkspace()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <IconFolderOff size={56} stroke={0.5} className="text-muted-foreground" aria-hidden />
      <h1 className="font-medium">The workspace folder is missing</h1>
      <Button
        variant="secondary"
        disabled={deleteWorkspace.isPending}
        onClick={() => deleteWorkspace.mutate(workspaceId)}
      >
        {deleteWorkspace.isPending ? 'Deleting workspace…' : 'Delete workspace'}
      </Button>
      {deleteWorkspace.error && (
        <p role="alert" className="text-sm text-destructive">
          {deleteWorkspace.error.message}
        </p>
      )}
    </div>
  )
}

type HarnessUnavailableStateProps = RetryProps & {
  harness: HarnessType
  availability: Exclude<HarnessAvailability, { status: 'available' }>
}

export function HarnessUnavailableState({
  harness,
  availability,
  ...retry
}: HarnessUnavailableStateProps) {
  const needsTerminalLogin = availability.status === 'login-required'
  return (
    <WorkspaceErrorMessage
      title={needsTerminalLogin ? 'Connect your agent' : 'Your agent is unavailable'}
      harness={harness}
      {...retry}
    >
      {availability.reason}
      {needsTerminalLogin && (
        <>
          <br />
          <br />
          Complete sign-in in your agent’s terminal, then try again.
        </>
      )}
    </WorkspaceErrorMessage>
  )
}

type WorkspaceOpenErrorProps = RetryProps & { error: Error }

export function WorkspaceOpenError({ error, retrying, onRetry }: WorkspaceOpenErrorProps) {
  if (error instanceof HttpError && error.status === 404) return <WorkspaceUnavailableState />
  return (
    <WorkspaceErrorMessage title="Couldn’t open workspace" retrying={retrying} onRetry={onRetry}>
      {error.message}
    </WorkspaceErrorMessage>
  )
}

export function WorkspaceUnavailableState() {
  const [, navigate] = useLocation()
  return (
    <WorkspaceErrorMessage
      title="Workspace not found or you don’t have access"
      retrying={false}
      onRetry={() => navigate(homePath())}
      actionLabel="Back to home"
    />
  )
}

type WorkspaceErrorMessageProps = RetryProps & {
  title: string
  harness?: HarnessType
  children?: ReactNode
  actionLabel?: string
}

export function WorkspaceErrorMessage({
  title,
  harness,
  children,
  retrying,
  onRetry,
  actionLabel = 'Try again'
}: WorkspaceErrorMessageProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        {harness && <img src={harnessIcon[harness]} alt="" className="size-10 self-center" />}
        <h1 className="text-center text-xl font-medium">{title}</h1>
        <div role="alert" className="flex flex-col items-center gap-4">
          {children && (
            <p className="text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">
              {children}
            </p>
          )}
          <Button variant="secondary" disabled={retrying} onClick={onRetry}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
