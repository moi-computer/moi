import { useRef, useState, type ReactNode } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { useRouter } from 'wouter'
import { usePathname } from 'wouter/use-browser-location'
import { Button } from '@/client/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/client/components/ui/popover'
import type { Icon as TabIcon } from '@tabler/icons-react'
import type { WorkspaceTabId } from '@/lib/types'
import { tabFromPath } from '@/lib/workspace-tabs'
import { cn } from '@/client/lib/cn'
import { userDisplayName } from '@/client/lib/user-display-name'
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent
} from '@/client/components/ui/tooltip'
import { UserAvatar } from '../components/user-avatar'
import { AvatarGroupCount } from '@/ui-components/avatar'
import { useWorkspaceMembers } from '../members/hooks'
import { isAgentProfileId } from '@/lib/ids'
import { collabIdentityId } from '../../identity/types'
import { pageFromPath } from '../presence/provider'
import { useConnectionState, useWorkspaceUsers, useMe } from '../presence/hooks'
import { summarizeWorkspaceUsers, type WorkspaceUserInfo } from '../presence/users'
import { WorkspaceMembers } from './workspace-members'
import { AgentInvite } from './agent-invite'

export type TabInfo = { label: string; Icon: TabIcon }
type WorkspaceSharingMenuProps = {
  workspaceName?: string
  workspaceId: string
  describeTab: (tab: WorkspaceTabId) => TabInfo | null
  onOpenTab: (tab: WorkspaceTabId) => void
}
export function WorkspaceSharingMenu({
  workspaceId,
  workspaceName,
  describeTab,
  onOpenTab
}: WorkspaceSharingMenuProps) {
  const state = useConnectionState()
  const workspaceUsers = useWorkspaceUsers()
  const currentUser = useMe()
  const router = useRouter()
  const page = pageFromPath(usePathname(router), workspaceId, router.base)
  const membership = useWorkspaceMembers(workspaceId)
  const memberIds = membership.members && new Set(membership.members.map(collabIdentityId))
  const members = memberIds
    ? workspaceUsers.filter(user => user.id === currentUser?.id || memberIds.has(user.id))
    : workspaceUsers
  const users = summarizeWorkspaceUsers(state.connections, {
    currentUser,
    users:
      membership.isSuccess && currentUser && !members.some(user => user.id === currentUser.id)
        ? [currentUser, ...members]
        : members,
    page
  })
  const agents = users.filter(
    user =>
      isAgentProfileId(user.profile.id) &&
      (state.activeAgentIds.includes(user.profile.id) || user.status === 'active')
  )
  const people = users.filter(user => !isAgentProfileId(user.profile.id))
  const headerUsers = people.filter(
    user => user.status === 'active' || (user.self && memberIds?.has(user.profile.id))
  )
  const [open, setOpen] = useState(false)
  const [hoveredGroup, setHoveredGroup] = useState<'users' | 'agents' | null>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex shrink-0 items-center gap-1">
      {agents.length > 0 && (
        <div
          className="flex h-7 items-center"
          onPointerEnter={event => {
            if (event.pointerType !== 'touch') setHoveredGroup('agents')
          }}
          onPointerLeave={() => setHoveredGroup(null)}
        >
          <PresenceStack
            users={agents}
            label="Recently active agents"
            hovered={hoveredGroup === 'agents'}
          >
            {agent => <AgentAvatar agent={agent} describeTab={describeTab} />}
          </PresenceStack>
        </div>
      )}
      <Popover
        open={open}
        onOpenChange={(nextOpen, details) => {
          // Sibling avatar controls handle their own clicks, including toggling sharing.
          if (
            details.reason === 'outside-press' &&
            details.event.target instanceof Node &&
            headerRef.current?.contains(details.event.target)
          ) {
            details.cancel()
            return
          }
          setOpen(nextOpen)
        }}
      >
        <div
          ref={headerRef}
          onPointerEnter={event => {
            if (event.pointerType !== 'touch') setHoveredGroup('users')
          }}
          onPointerLeave={() => setHoveredGroup(null)}
          className="group/sharing relative inline-flex items-center rounded-full"
        >
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                aria-label="Users in this workspace"
                className="absolute inset-0 h-full w-full justify-end gap-0.5 rounded-full pr-1 pl-1 group-hover/sharing:bg-accent data-popup-open:bg-accent"
              />
            }
          >
            <IconChevronDown stroke={2.5} className="size-3! text-muted-foreground" />
          </PopoverTrigger>
          <div className="pointer-events-none flex h-7 items-center gap-0.5 px-1">
            <PresenceStack
              users={headerUsers}
              label="Active users"
              hovered={hoveredGroup === 'users'}
            >
              {user => (
                <MemberAvatar
                  user={user}
                  page={page}
                  describeTab={describeTab}
                  onToggleSharing={() => setOpen(value => !value)}
                  onOpenTab={tab => {
                    setOpen(false)
                    onOpenTab(tab)
                  }}
                />
              )}
            </PresenceStack>
            <span aria-hidden="true" className="size-3" />
          </div>
        </div>
        <PopoverContent
          initialFocus={false}
          align="end"
          className="w-96 max-w-[calc(100vw-2rem)] gap-2 bg-transparent p-0 shadow-none"
        >
          <WorkspaceMembers workspaceId={workspaceId} users={people} membership={membership} />
          <AgentInvite workspaceId={workspaceId} workspaceName={workspaceName} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

type PresenceStackProps = {
  users: WorkspaceUserInfo[]
  label: string
  hovered: boolean
  children: (user: WorkspaceUserInfo) => ReactNode
}

function PresenceStack({ users, label, hovered, children }: PresenceStackProps) {
  const [focused, setFocused] = useState(false)
  const expanded = hovered || focused
  const overflow = Math.max(0, users.length - 4)
  const slotClass = cn(
    'relative grid size-5 shrink-0 items-center justify-items-start rounded-full not-last:me-(--presence-gap)',
    'not-last:mask-[radial-gradient(circle_at_calc(100%_+_var(--presence-gap)_+_var(--avatar-radius))_50%,transparent_calc(var(--avatar-radius)_+_2px),black_calc(var(--avatar-radius)_+_2.5px))]',
    'transition-[width,opacity] duration-100 ease-in-out inert:invisible inert:me-0 inert:w-0 inert:overflow-hidden inert:opacity-0 motion-reduce:transition-none'
  )
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'pointer-events-auto flex items-center transition-[--presence-gap] duration-100 ease-in-out [--avatar-radius:--spacing(2.5)] motion-reduce:transition-none',
        expanded ? '[--presence-gap:--spacing(0.5)]' : '[--presence-gap:calc(--spacing(2)*-1)]'
      )}
      onFocus={event => setFocused(event.target.matches(':focus-visible'))}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      {overflow > 0 && (
        <div inert={expanded} className={slotClass}>
          <AvatarGroupCount size="xs">+{overflow}</AvatarGroupCount>
        </div>
      )}
      {users.toReversed().map((user, index) => (
        <div key={user.profile.id} inert={!expanded && index < overflow} className={slotClass}>
          <TooltipProvider delay={300}>{children(user)}</TooltipProvider>
        </div>
      ))}
    </div>
  )
}

type AgentAvatarProps = {
  agent: WorkspaceUserInfo
  describeTab: WorkspaceSharingMenuProps['describeTab']
}

function AgentAvatar({ agent, describeTab }: AgentAvatarProps) {
  const tab = agent.page ? tabFromPath(agent.page) : undefined
  const info = tab ? describeTab(tab) : null

  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger render={<span tabIndex={0} className="rounded-full" />}>
        <UserAvatar profile={agent.profile} size="xs" />
      </TooltipTrigger>
      <TooltipContent className="flex-col gap-1 text-center">
        <div>{userDisplayName(agent.profile)}</div>
        {agent.status === 'active' ? (
          <TabSubtitle info={info} />
        ) : (
          <div className="text-muted-foreground">Active now</div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

type MemberAvatarProps = Pick<WorkspaceSharingMenuProps, 'describeTab' | 'onOpenTab'> & {
  user: WorkspaceUserInfo
  page: string
  onToggleSharing: () => void
}

function MemberAvatar({ user, page, describeTab, onOpenTab, onToggleSharing }: MemberAvatarProps) {
  const tab = user.page ? tabFromPath(user.page) : null
  const info = tab ? describeTab(tab) : null
  const name = userDisplayName(user.profile)
  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <Button
            variant={null}
            size="icon-xs"
            data-slot="avatar"
            data-size="xs"
            className="pointer-events-auto relative size-5 rounded-full p-0"
            aria-label={user.self ? `${name} (You), open sharing` : name}
            onClick={() => {
              if (user.self) onToggleSharing()
              else if (tab && info && tab !== page) {
                onOpenTab(tab)
              }
            }}
          />
        }
      >
        <UserAvatar profile={user.profile} size="xs" />
      </TooltipTrigger>
      <TooltipContent className="flex-col gap-1 text-center">
        <div>
          {name}
          {user.self ? ' (You)' : ''}
        </div>
        <TabSubtitle info={info} />
      </TooltipContent>
    </Tooltip>
  )
}

function TabSubtitle({ info }: { info: TabInfo | null }) {
  return (
    info && (
      <div className="flex items-center justify-center gap-0.5 text-muted-foreground">
        <info.Icon size={12} stroke={1.75} />
        {info.label}
      </div>
    )
  )
}
