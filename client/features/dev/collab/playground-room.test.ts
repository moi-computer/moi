import { expect, test } from 'bun:test'
import { createFakeEngine } from '@/client/features/collab/testing/fake-engine'
import { connectPlaygroundMembers } from './playground-room'

test('members exchange real publications, clear them, and stop relaying on cleanup', () => {
  const profiles = [
    { type: 'user' as const, id: 'you', name: 'You', color: 'violet' as const },
    { type: 'user' as const, id: 'fig', name: 'Fig', color: 'amber' as const }
  ]
  const rooms = profiles.map(self => createFakeEngine({ self, profiles, page: 'playground' }))
  const [you, fig] = rooms
  const dispose = connectPlaygroundMembers(rooms)
  const registration = { registrationId: 'field', appletId: 'demo', channel: 'focus', value: true }
  you!.setPresence(registration)
  expect(fig!.getPresenceSnapshot('demo', 'focus')).toEqual([
    { registrationId: 'field', connectionId: 'preview:you', identityId: 'you', value: true }
  ])
  // Identical local connection/registration IDs in different engines stay separate.
  fig!.setPresence({ ...registration, value: 'Fig' })
  expect(you!.getPresenceSnapshot('demo', 'focus')).toEqual([
    { registrationId: 'field', connectionId: 'preview:fig', identityId: 'fig', value: 'Fig' }
  ])
  you!.deletePresence('field')
  expect(fig!.getPresenceSnapshot('demo', 'focus')).toEqual([])
  fig!.setLocation({ page: 'elsewhere', status: 'active' })
  expect(
    you!.getSnapshot().connections.find(connection => connection.identityId === 'fig')?.location
      ?.page
  ).toBe('elsewhere')
  dispose()
  you!.setPresence(registration)
  expect(fig!.getPresenceSnapshot('demo', 'focus')).toEqual([])
})
