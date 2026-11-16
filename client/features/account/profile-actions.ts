import { getIdentity, setIdentity, getAccountGeneration } from '../identity/store'
import type { Identity } from '../identity/types'
import { refreshMemberProfile } from '../collab/members/store'

export async function saveCloudProfile(field: 'name' | 'avatar', update: () => Promise<Identity>) {
  const before = getIdentity()
  const accountGeneration = getAccountGeneration()
  if (!before || before.type !== 'user' || before.isAnonymous)
    throw new Error('Sign in to change your profile')
  const saved = await update()
  const current = getIdentity()
  if (
    accountGeneration !== getAccountGeneration() ||
    !current ||
    current.type !== 'user' ||
    current.id !== before.id
  )
    throw new Error('Your account changed. Reload Moi to try again.')
  // A newer server-pushed value wins. Apply only fields still equal to their original value.
  setIdentity({
    ...current,
    ...(field === 'name' && current.name === before.name ? { name: saved.name } : {}),
    ...(field === 'avatar' && current.avatar === before.avatar ? { avatar: saved.avatar } : {})
  })
  // Our identity write can supersede the event bridge's in-flight snapshot, so
  // put the saved profile into the member lists without waiting for the next one.
  const profile = getIdentity()
  if (accountGeneration === getAccountGeneration() && profile) refreshMemberProfile(profile)
}
