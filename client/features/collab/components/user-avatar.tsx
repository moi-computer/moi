import type { UserAvatarProps as UserAvatarContainerProps } from 'moi/collab'
import type { UserProfile } from '@/lib/collab/types'
import { IconRobotFace, IconUser } from '@tabler/icons-react'
import { Blobatar } from '@blobatar/react'
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/ui-components/avatar'
import { cn } from '@/client/lib/cn'
import { userDisplayName } from '@/client/lib/user-display-name'
import { isAgentProfileId } from '../../identity/types'
import { useUser } from '../presence/hooks'

export function UserAvatarContainer({
  id,
  size,
  showStatusBadge,
  className
}: UserAvatarContainerProps) {
  const user = useUser(id)
  return (
    <UserAvatar
      profile={user}
      size={size}
      active={showStatusBadge && user?.status === 'active'}
      className={className}
    />
  )
}

export type UserAvatarProps = {
  profile?: UserProfile
  size?: 'xs' | 'sm' | 'default' | 'lg'
  className?: string
  active?: boolean
}

export function UserAvatar({
  profile: user,
  size = 'default',
  className,
  active
}: UserAvatarProps) {
  const agent = user && isAgentProfileId(user.id)
  const name = user ? userDisplayName(user) : 'Unknown user'

  return (
    <Avatar size={size} aria-label={name} className={cn('after:border-0', className)}>
      {user?.avatar && <AvatarImage src={user.avatar} alt="" />}
      <AvatarFallback className={agent ? 'bg-transparent' : undefined}>
        {agent ? (
          <IconRobotFace size={size === 'xs' ? 12 : 16} stroke={1.75} />
        ) : user ? (
          <Blobatar
            className="scale-150"
            name={user.id}
            animate="hover"
            background="circle"
            palette={{
              bg: 'color-mix(in srgb, var(--muted) 85%, var(--foreground))',
              head: 'color-mix(in srgb, var(--muted) 85%, var(--foreground))',
              eye: 'var(--foreground)'
            }}
          />
        ) : (
          <IconUser size={size === 'xs' || size === 'sm' ? 12 : 16} stroke={1.75} />
        )}
      </AvatarFallback>
      {active && <AvatarBadge className="bg-success" />}
    </Avatar>
  )
}
