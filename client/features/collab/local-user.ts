import { PROFILE_COLORS } from '@/lib/collab/colors'
import type { ProfileColor } from '@/lib/collab/colors'
import type { Profile } from '@/lib/collab/types'

const LOCAL_USER_NAMES = [
  'Curious Kiwi',
  'Cheerful Cherry',
  'Sleepy Peach',
  'Excited Banana',
  'Cosmic Mango',
  'Velvet Lemon',
  'Electric Plum',
  'Wandering Pear',
  'Dramatic Papaya',
  'Suspicious Pineapple',
  'Confused Coconut',
  'Sneaky Tangerine',
  'Gentle Fig',
  'Quiet Apricot',
  'Mellow Melon',
  'Dreamy Guava'
]

export type LocalUserDraft = { name: string; color: ProfileColor }

function pick<T>(items: readonly T[], except?: T): T {
  const pool = items.filter(item => item !== except)
  return pool[Math.floor(Math.random() * pool.length)] ?? items[0]
}

export function randomLocalUser(current?: LocalUserDraft): LocalUserDraft {
  return {
    name: pick(LOCAL_USER_NAMES, current?.name),
    color: pick(PROFILE_COLORS, current?.color)
  }
}

export function localUserProfile(id: string, draft: LocalUserDraft): Profile {
  const name = draft.name.trim()
  return { id, type: 'user', ...(name ? { name } : {}), color: draft.color }
}

// The id stays with the browser through renames, so peers keep seeing one user.
export function createLocalUser(): Profile {
  return localUserProfile(`local-${crypto.randomUUID().slice(0, 8)}`, randomLocalUser())
}
