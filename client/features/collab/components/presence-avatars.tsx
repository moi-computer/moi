import type { PresenceAvatarsProps as PresenceAvatarsContainerProps } from 'moi/collab'
import type { Profile } from '@/lib/collab/types'
import { useContext } from 'react'
import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/client/lib/cn'
import { PresenceGroupContext, usePresenceTarget, useTargetPresence } from './presence-helpers'
import { useMembers } from '../presence/hooks'
import { ProfileAvatar } from './profile-avatar'

export function PresenceAvatarsContainer({
  id,
  present,
  align,
  children,
  className
}: PresenceAvatarsContainerProps) {
  const target = usePresenceTarget(id)
  const presence = useTargetPresence(target, present)
  const profiles = useMembers(presence.peers.map(peer => peer.id))
  const grouped = useContext(PresenceGroupContext).length > 0
  return (
    <PresenceAvatars
      {...presence.props}
      profiles={presence.peers.map((peer, index) => ({ ...peer, profile: profiles[index] }))}
      // Controlled presence can occupy several targets at once; only focus moves between them.
      animate={grouped && present === undefined}
      align={align}
      className={className}
    >
      {children}
    </PresenceAvatars>
  )
}

export type PresenceAvatarsProps = HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>
  profiles: readonly { id: string; connectionId: string; profile?: Profile }[]
  children: ReactNode
  animate?: boolean
  align?: PresenceAvatarsContainerProps['align']
}

// A target owns its own gutter. Optional group-scoped layout IDs let the same
// user's face glide between targets without searching or guessing DOM order.
export function PresenceAvatars({
  profiles,
  children,
  animate = false,
  align = 'center',
  className,
  ...rest
}: PresenceAvatarsProps) {
  return (
    <div className={cn('relative pl-8', className)} {...rest}>
      {children}
      <div
        data-align={align}
        className="pointer-events-none absolute inset-y-0 left-0 flex items-center -space-x-3 data-[align=end]:items-end data-[align=start]:items-start"
        aria-hidden="true"
      >
        {profiles.map(({ id, connectionId, profile }) => (
          <motion.span key={id} layoutId={animate ? `presence:${connectionId}` : undefined}>
            <ProfileAvatar
              profile={profile}
              size="sm"
              className="animate-in duration-200 zoom-in-75 fade-in"
            />
          </motion.span>
        ))}
      </div>
    </div>
  )
}
