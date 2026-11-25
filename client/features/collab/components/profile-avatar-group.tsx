import type { ProfileAvatarGroupProps as ProfileAvatarGroupContainerProps } from 'moi/collab'
import type { Profile } from '@/lib/collab/types'
import { AvatarGroup as AvatarGroupPrimitive, AvatarGroupCount } from '@/ui-components/avatar'
import { ProfileAvatar } from './profile-avatar'
import type { ProfileAvatarProps } from './profile-avatar'
import { useMembers } from '../presence/hooks'

export function ProfileAvatarGroupContainer({ ids, ...props }: ProfileAvatarGroupContainerProps) {
  const profiles = useMembers([...new Set(ids)])
  return <ProfileAvatarGroup profiles={profiles} {...props} />
}

export type ProfileAvatarGroupProps = {
  profiles: readonly (Profile | undefined)[]
  max?: number
  size?: ProfileAvatarProps['size']
  className?: string
}

export function ProfileAvatarGroup({
  profiles,
  max = 3,
  size = 'sm',
  className
}: ProfileAvatarGroupProps) {
  const shown = profiles.slice(0, max)
  const hidden = profiles.length - shown.length
  return (
    <AvatarGroupPrimitive className={className} aria-label={`${profiles.length} profiles`}>
      {shown.map((profile, index) => (
        <ProfileAvatar key={profile?.id ?? index} profile={profile} size={size} />
      ))}
      {hidden > 0 && (
        <AvatarGroupCount size={size} aria-label={`${hidden} more`}>
          +{hidden}
        </AvatarGroupCount>
      )}
    </AvatarGroupPrimitive>
  )
}
