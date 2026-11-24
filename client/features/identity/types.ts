import { isRecord } from '@/lib/collab/protocol'

export type Identity =
  | { id: string; type: 'user'; name: string; email: string; avatar?: string; isAnonymous: boolean }
  | { id: string; type: 'agent'; name: string; client?: string; avatar?: string; ownerId?: string }

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !value.includes('\0')
}
function isAvatar(value: unknown): value is string {
  if (!text(value, 2048)) return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
export function parseIdentity(value: unknown): Identity {
  if (
    !isRecord(value) ||
    !text(value.id, 240) ||
    !value.id.trim() ||
    value.id !== value.id.trim() ||
    !text(value.name, 256) ||
    (value.avatar !== undefined && !isAvatar(value.avatar))
  )
    throw new Error('Invalid identity')
  const common = {
    id: value.id,
    name: value.name,
    ...(value.avatar !== undefined ? { avatar: value.avatar } : {})
  }
  if (value.type === 'agent') {
    const ownerId = value.ownerId
    if (ownerId !== undefined && (!text(ownerId, 240) || !ownerId || ownerId.trim() !== ownerId))
      throw new Error('Invalid agent owner id')
    return {
      ...common,
      type: 'agent',
      ...(text(value.client, 256) && { client: value.client }),
      ...(ownerId && { ownerId })
    }
  }
  if (value.type === 'user' && text(value.email, 320) && typeof value.isAnonymous === 'boolean')
    return { ...common, type: 'user', email: value.email, isAnonymous: value.isAnonymous }
  throw new Error('Invalid identity')
}
export const identityKey = (identity: Identity) => `${identity.type}:${identity.id}`
