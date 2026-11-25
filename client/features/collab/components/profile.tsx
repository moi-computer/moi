import type { ProfileProps as ProfileContainerProps } from 'moi/collab'
import type { ReactNode } from 'react'
import type { Profile as ProfileData } from '@/lib/collab/types'
import { cn } from '@/client/lib/cn'
import { ProfileAvatar } from './profile-avatar'
import { profileDisplayName } from '@/client/lib/profile-display-name'
import { useMe, useMember } from '../presence/hooks'

export function ProfileContainer({
  id,
  showStatusBadge,
  showYouLabel,
  ...props
}: ProfileContainerProps) {
  const profile = useMember(id)
  const me = useMe()
  return (
    <Profile
      {...props}
      profile={profile}
      active={showStatusBadge && profile?.status === 'active'}
      showYouLabel={showYouLabel && profile !== undefined && profile.id === me?.id}
    />
  )
}

export type ProfileProps = {
  profile?: ProfileData
  size?: 'xs' | 'sm' | 'default'
  active?: boolean
  showYouLabel?: boolean
  description?: ReactNode
  className?: string
}

export function Profile({
  profile,
  size = 'default',
  active,
  showYouLabel,
  description,
  className
}: ProfileProps) {
  const name = profile ? profileDisplayName(profile) : 'Unknown member'

  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <ProfileAvatar profile={profile} size={size} active={active} />
      <span
        className={cn('flex min-w-0 flex-1 text-sm', size === 'xs' ? 'items-baseline' : 'flex-col')}
      >
        <span className="flex min-w-0 items-baseline gap-1">
          <span className={cn('truncate', !profile && 'text-muted-foreground')}>{name}</span>
          {showYouLabel && <span className="shrink-0 text-muted-foreground">(You)</span>}
        </span>
        {description && (
          <span
            className={cn(
              'truncate text-muted-foreground',
              size === 'sm' && 'text-xs leading-tight'
            )}
          >
            {size === 'xs' && (
              <span aria-hidden="true" className="whitespace-pre">
                {' · '}
              </span>
            )}
            {description}
          </span>
        )}
      </span>
    </span>
  )
}
