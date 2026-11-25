import type { ProfileAvatarProps as ProfileAvatarContainerProps } from 'moi/collab'
import type { Profile } from '@/lib/collab/types'
import { IconRobotFace, IconUser } from '@tabler/icons-react'
import { Blobatar } from '@blobatar/react'
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/ui-components/avatar'
import { cn } from '@/client/lib/cn'
import { profileDisplayName } from '@/client/lib/profile-display-name'
import { useMember } from '../presence/hooks'

export function ProfileAvatarContainer({
  id,
  size,
  showStatusBadge,
  className
}: ProfileAvatarContainerProps) {
  const profile = useMember(id)
  return (
    <ProfileAvatar
      profile={profile}
      size={size}
      active={showStatusBadge && profile?.status === 'active'}
      className={className}
    />
  )
}

export type ProfileAvatarProps = {
  profile?: Profile
  size?: 'xs' | 'sm' | 'default' | 'lg'
  className?: string
  active?: boolean
}

export function ProfileAvatar({
  profile,
  size = 'default',
  className,
  active
}: ProfileAvatarProps) {
  const agent = profile?.type === 'agent'
  const name = profile ? profileDisplayName(profile) : 'Unknown member'

  return (
    <Avatar size={size} aria-label={name} className={cn('after:border-0', className)}>
      {profile?.avatar && <AvatarImage src={profile.avatar} alt="" />}
      <AvatarFallback className={agent ? 'bg-muted' : undefined}>
        {agent ? (
          <IconRobotFace className="text-foreground" size={size === 'xs' ? 12 : 16} stroke={1.75} />
        ) : profile ? (
          <Blobatar
            className="scale-150"
            name={profile.id}
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
