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
import { profileDisplayName } from '@/client/lib/profile-display-name'
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent
} from '@/client/components/ui/tooltip'
import { ProfileAvatar } from '../components/profile-avatar'
import { AvatarGroupCount } from '@/ui-components/avatar'
import { useWorkspaceMembership } from '../members/hooks'
import { pageFromPath } from '../presence/provider'
import { useConnectionState, useWorkspaceMembers, useMe } from '../presence/hooks'
import { summarizeMemberPresence, type MemberPresence } from '../presence/member-profiles'
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
  const memberProfiles = useWorkspaceMembers()
  const currentProfile = useMe()
  const router = useRouter()
  const page = pageFromPath(usePathname(router), workspaceId, router.base)
  const membership = useWorkspaceMembership(workspaceId)
  const memberIds = membership.members && new Set(membership.members.map(member => member.id))
  const members = memberIds
    ? memberProfiles.filter(member => member.id === currentProfile?.id || memberIds.has(member.id))
    : memberProfiles
  const memberPresence = summarizeMemberPresence(state.connections, {
    currentProfile,
    profiles:
      membership.isSuccess &&
      currentProfile &&
      !members.some(member => member.id === currentProfile.id)
        ? [currentProfile, ...members]
        : members,
    page
  })
  const agents = memberPresence.filter(
    member =>
      member.profile.type === 'agent' &&
      (state.activeAgentIds.includes(member.profile.id) || member.status === 'active')
  )
  const users = memberPresence.filter(member => member.profile.type === 'user')
  const headerUsers = users.filter(
    member => member.status === 'active' || (member.self && memberIds?.has(member.profile.id))
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
            profiles={agents}
            label="Active agents"
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
                aria-label="Members in this workspace"
                className="absolute inset-0 h-full w-full justify-end gap-0.5 rounded-full pr-1 pl-1 group-hover/sharing:bg-accent data-popup-open:bg-accent"
              />
            }
          >
            <IconChevronDown stroke={2.5} className="size-3! text-muted-foreground" />
          </PopoverTrigger>
          <div className="pointer-events-none flex h-7 items-center gap-0.5 px-1">
            <PresenceStack
              profiles={headerUsers}
              label="Active people"
              hovered={hoveredGroup === 'users'}
            >
              {member => (
                <MemberAvatar
                  member={member}
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
          className="group/sharing-menu w-96 max-w-[calc(100vw-2rem)] gap-2 bg-transparent p-0 shadow-none"
        >
          <WorkspaceMembers workspaceId={workspaceId} profiles={users} membership={membership} />
          <AgentInvite workspaceId={workspaceId} workspaceName={workspaceName} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

type PresenceStackProps = {
  profiles: MemberPresence[]
  label: string
  hovered: boolean
  children: (member: MemberPresence) => ReactNode
}

function PresenceStack({ profiles, label, hovered, children }: PresenceStackProps) {
  const [focused, setFocused] = useState(false)
  const expanded = hovered || focused
  const overflow = Math.max(0, profiles.length - 4)
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
      {profiles.toReversed().map((member, index) => (
        <div key={member.profile.id} inert={!expanded && index < overflow} className={slotClass}>
          <TooltipProvider delay={300}>{children(member)}</TooltipProvider>
        </div>
      ))}
    </div>
  )
}

type AgentAvatarProps = {
  agent: MemberPresence
  describeTab: WorkspaceSharingMenuProps['describeTab']
}

function AgentAvatar({ agent, describeTab }: AgentAvatarProps) {
  const tab = agent.page ? tabFromPath(agent.page) : undefined
  const info = tab ? describeTab(tab) : null

  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger render={<span tabIndex={0} className="rounded-full" />}>
        <ProfileAvatar profile={agent.profile} size="xs" />
      </TooltipTrigger>
      <TooltipContent className="flex-col gap-1 text-center">
        <div>{profileDisplayName(agent.profile)}</div>
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
  member: MemberPresence
  page: string
  onToggleSharing: () => void
}

function MemberAvatar({
  member,
  page,
  describeTab,
  onOpenTab,
  onToggleSharing
}: MemberAvatarProps) {
  const tab = member.page ? tabFromPath(member.page) : null
  const info = tab ? describeTab(tab) : null
  const name = profileDisplayName(member.profile)
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
            aria-label={member.self ? `${name} (You), open sharing` : name}
            onClick={() => {
              if (member.self) onToggleSharing()
              else if (tab && info && tab !== page) {
                onOpenTab(tab)
              }
            }}
          />
        }
      >
        <ProfileAvatar profile={member.profile} size="xs" />
      </TooltipTrigger>
      <TooltipContent className="flex-col gap-1 text-center">
        <div>
          {name}
          {member.self ? ' (You)' : ''}
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
