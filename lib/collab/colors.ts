import type { ProfileColor } from 'moi/collab'

export type { ProfileColor } from 'moi/collab'

// The eight Tailwind palette names available for profiles. Their shades live in CSS.
export const PROFILE_COLORS = [
  'pink',
  'orange',
  'amber',
  'lime',
  'emerald',
  'cyan',
  'blue',
  'violet'
] as const satisfies readonly ProfileColor[]

export function isProfileColor(value: unknown): value is ProfileColor {
  return typeof value === 'string' && (PROFILE_COLORS as readonly string[]).includes(value)
}

// A random-looking but stable pick (FNV-1a), so an identity ID gets the same color
// on the server and in every browser.
export function colorForId(id: string): ProfileColor {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return PROFILE_COLORS[(hash >>> 0) % PROFILE_COLORS.length] ?? PROFILE_COLORS[0]
}
