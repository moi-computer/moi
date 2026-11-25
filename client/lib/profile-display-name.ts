import type { Profile } from '@/lib/collab/types'

// Presentation only: keep the supplied profile unchanged in applet APIs.
export function profileDisplayName(user: Profile): string {
  return user.name?.trim() || user.email?.trim() || user.id
}
