import { IconChevronDown, IconLoader2 } from '@tabler/icons-react'

import { useAppConfig } from '@/client/api/app-config'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/client/components/ui/alert-dialog'
import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { useDeleteWorkspace } from '@/client/features/home/api'
import { useWorkspaceLayoutCtx } from '@/client/features/workspace/workspace-layout-context'
import { harnessIcon, harnessLabel } from '@/client/features/harness/harness-presentation'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from '@/client/components/ui/dropdown-menu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/client/components/ui/tooltip'
import { useLive } from '@/client/features/chat/chat-store'

import { useChangeWorkspaceHarness } from '@/client/features/workspace/api'
import { SettingsPage, SettingsRow, SettingsSection } from './settings-layout'

export function GeneralSettings() {
  const { demo, environment } = useAppConfig()
  const { cwd } = useWorkspaceLayoutCtx()

  return (
    <SettingsPage title="General" description="Basic details for this space">
      <SettingsSection>
        {environment === 'local' && (
          <SettingsRow
            title="Path"
            control={
              <Input
                value={cwd ?? ''}
                aria-label="Workspace path"
                title={cwd ?? undefined}
                className="w-56"
                readOnly
              />
            }
          />
        )}
        <WorkspaceHarnessSetting />
      </SettingsSection>

      {!demo && (
        <SettingsSection label="Danger zone">
          <WorkspaceActionRow />
        </SettingsSection>
      )}
    </SettingsPage>
  )
}

function WorkspaceActionRow() {
  const { workspaceId, isRemote, name } = useWorkspaceLayoutCtx()
  const cloud = useAppConfig().environment === 'cloud'
  const member = cloud && isRemote
  const deleteWorkspace = useDeleteWorkspace(member ? 'leave' : 'delete')
  const error = deleteWorkspace.error && (
    <p role="alert" className="text-xs text-destructive">
      {deleteWorkspace.error.message}
    </p>
  )
  const ownerDescription = cloud
    ? 'Workspaces in trash are automatically deleted after 30 days'
    : 'Workspace files and chats stay on disk'

  return (
    <SettingsRow
      title={member ? 'Leave workspace' : 'Delete workspace'}
      description={member ? 'All local workspace data will be deleted' : ownerDescription}
      control={
        cloud && !member ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button type="button" variant="destructive" />}
              disabled={deleteWorkspace.isPending}
            >
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {name || 'this workspace'}</AlertDialogTitle>
                <AlertDialogDescription>
                  The workspace will be moved to trash and all members and agents will lose access
                  and their local data. You have 30 days to restore it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {error}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteWorkspace.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  type="button"
                  variant="destructive"
                  disabled={deleteWorkspace.isPending}
                  onClick={() => deleteWorkspace.mutate(workspaceId)}
                >
                  {deleteWorkspace.isPending && (
                    <IconLoader2 data-icon="inline-start" stroke={1.75} className="animate-spin" />
                  )}
                  Delete workspace
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Button
              type="button"
              variant="destructive"
              disabled={deleteWorkspace.isPending}
              onClick={() => deleteWorkspace.mutate(workspaceId)}
            >
              {member ? 'Leave' : 'Delete'}
            </Button>
            {!member && error}
          </div>
        )
      }
    />
  )
}

function WorkspaceHarnessSetting() {
  const { demo } = useAppConfig()
  const { workspaceId, harness } = useWorkspaceLayoutCtx()
  const current = harness ?? 'claude-code'
  const change = useChangeWorkspaceHarness(workspaceId)
  const active = useLive(state =>
    Object.entries(state.activity).some(
      ([key, activity]) => key.startsWith(`${workspaceId}:`) && activity !== 'idle'
    )
  )
  const reason = demo
    ? 'Changing agents is unavailable in the demo'
    : current === 'hermes' || current === 'openclaw'
      ? 'This workspace belongs to its agent and cannot use another agent'
      : active
        ? 'Wait for the agent to finish before changing it'
        : undefined
  return (
    <>
      <SettingsRow
        title="Agent"
        description="Changing the agent changes which chats you see in this space"
        control={
          <Tooltip disabled={!reason}>
            <TooltipTrigger render={<span tabIndex={reason ? 0 : undefined} aria-label={reason} />}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" />}
                  disabled={Boolean(reason) || change.isPending}
                  aria-label="Agent"
                >
                  <img src={harnessIcon[current]} alt="" className="size-4 shrink-0" />
                  {harnessLabel[current]}
                  <IconChevronDown stroke={1.5} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuRadioGroup
                    value={current}
                    onValueChange={value => change.mutate(value)}
                  >
                    {(['claude-code', 'codex'] as const).map(option => (
                      <DropdownMenuRadioItem key={option} value={option}>
                        <img src={harnessIcon[option]} alt="" className="size-4 shrink-0" />
                        {harnessLabel[option]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </TooltipTrigger>
            <TooltipContent>{reason}</TooltipContent>
          </Tooltip>
        }
      />
      {change.error && (
        <p role="alert" className="text-sm text-destructive">
          {change.error.message}
        </p>
      )}
    </>
  )
}
