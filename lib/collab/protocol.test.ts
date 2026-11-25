import { expect, test } from 'bun:test'

import {
  COLLAB_MAX_AVATAR_BYTES,
  COLLAB_MAX_EMAIL_BYTES,
  COLLAB_MAX_PRESENCE_BYTES,
  isCollabClientMessage,
  isProfile
} from './protocol'

const profile = { type: 'user', id: 'anna', name: 'Anna', color: 'violet' } as const
const presence = {
  type: 'presence:set',
  registrationId: 'field',
  appletId: 'views/board',
  channel: 'focus'
}

test('profiles have bounded identifiers and optional avatar and email data', () => {
  expect(isProfile(profile)).toBe(true)
  expect(isProfile({ ...profile, type: 'agent', ownerId: 'inviter' })).toBe(true)
  expect(isProfile({ ...profile, type: 'user', ownerId: 'inviter' })).toBe(false)
  expect(isProfile({ ...profile, type: 'agent', ownerId: 1 })).toBe(false)
  expect(isProfile({ ...profile, type: 'unknown' })).toBe(false)
  expect(isProfile({ ...profile, color: '#7c3aed' })).toBe(false)
  expect(isProfile({ ...profile, color: 'red' })).toBe(false)
  expect(
    isProfile({
      ...profile,
      email: 'anna@example.com',
      avatar: 'https://example.com/avatar'
    })
  ).toBe(true)
  expect(isProfile({ ...profile, id: '🙂'.repeat(100) })).toBe(false)
  expect(isProfile({ ...profile, id: 'a\0b' })).toBe(false)
  expect(isProfile({ ...profile, email: 'x'.repeat(COLLAB_MAX_EMAIL_BYTES) })).toBe(true)
  expect(isProfile({ ...profile, email: 'x'.repeat(COLLAB_MAX_EMAIL_BYTES + 1) })).toBe(false)
  expect(isProfile({ ...profile, email: '🙂'.repeat(81) })).toBe(false)
  expect(isProfile({ ...profile, email: null })).toBe(false)
  expect(isProfile({ ...profile, avatar: 'x'.repeat(COLLAB_MAX_AVATAR_BYTES + 1) })).toBe(false)
})

test('only protocol v1 clients with a profile can join', () => {
  expect(isCollabClientMessage({ type: 'join', version: 1, profile })).toBe(true)
  expect(isCollabClientMessage({ type: 'join', version: 2, profile })).toBe(false)
  expect(
    isCollabClientMessage({ type: 'join', version: 1, profile: null, anonymousId: 'tab' })
  ).toBe(false)
  expect(
    isCollabClientMessage({
      type: 'join',
      version: 1,
      profile,
      location: { page: 'views/board', status: 'active' }
    })
  ).toBe(true)
  expect(
    isCollabClientMessage({
      type: 'join',
      version: 1,
      profile,
      location: { page: '', status: 'active' }
    })
  ).toBe(false)
})

test('join and profile updates accept missing names and reject blank names', () => {
  const unnamed = { type: 'user', id: 'anna', color: 'violet' } as const
  for (const profile of [
    unnamed,
    { ...unnamed, email: 'anna@example.com', avatar: 'https://example.com/avatar' }
  ]) {
    expect(isProfile(profile)).toBe(true)
    expect(isCollabClientMessage({ type: 'join', version: 1, profile })).toBe(true)
    expect(isCollabClientMessage({ type: 'profile', profile })).toBe(true)
  }
  for (const profile of [
    { color: unnamed.color },
    { ...unnamed, id: '' },
    { ...unnamed, id: ' \t ' },
    { ...unnamed, id: null },
    { ...unnamed, name: null },
    { ...unnamed, name: '' },
    { ...unnamed, name: ' \t ' },
    { ...unnamed, name: 7 },
    { ...unnamed, name: 'a\0b' },
    { ...unnamed, name: '🙂'.repeat(65) },
    { id: unnamed.id }
  ]) {
    expect(isProfile(profile)).toBe(false)
    expect(isCollabClientMessage({ type: 'join', version: 2, profile })).toBe(false)
    expect(isCollabClientMessage({ type: 'profile', profile })).toBe(false)
  }
  expect(isProfile({ ...unnamed, name: '🙂'.repeat(64) })).toBe(true)
})

test('presence bounds JSON bytes, nesting and finite numbers', () => {
  expect(isCollabClientMessage({ ...presence, value: { x: 12, focused: true } })).toBe(true)
  expect(isCollabClientMessage({ ...presence, value: 'x'.repeat(COLLAB_MAX_PRESENCE_BYTES) })).toBe(
    false
  )
  expect(isCollabClientMessage({ ...presence, value: '🙂'.repeat(1100) })).toBe(false)
  expect(isCollabClientMessage({ ...presence, value: NaN })).toBe(false)
  expect(isCollabClientMessage({ ...presence, value: Infinity })).toBe(false)
  let nested: unknown = null
  for (let index = 0; index < 26; index++) nested = [nested]
  expect(isCollabClientMessage({ ...presence, value: nested })).toBe(false)
})

test('locations require an active or away connection status', () => {
  for (const status of ['active', 'away']) {
    const location = { page: 'views/board', status }
    expect(isCollabClientMessage({ type: 'location', location })).toBe(true)
    expect(isCollabClientMessage({ type: 'join', version: 1, profile, location })).toBe(true)
  }
  for (const status of [undefined, null, false, true, 0, 'offline', 'unknown']) {
    const location = { page: 'views/board', status }
    expect(isCollabClientMessage({ type: 'location', location })).toBe(false)
    expect(isCollabClientMessage({ type: 'join', version: 1, profile, location })).toBe(false)
  }
  for (const location of [{ page: 'views/board' }, { page: 'views/board', away: true }]) {
    expect(isCollabClientMessage({ type: 'location', location })).toBe(false)
    expect(isCollabClientMessage({ type: 'join', version: 1, profile, location })).toBe(false)
  }
})

test('storage operations are no longer part of the protocol', () => {
  for (const type of ['subscribe', 'unsubscribe', 'mutate', 'receipts', 'snapshot', 'export']) {
    expect(
      isCollabClientMessage({
        type,
        scope: 'board',
        subscriptionId: 'sub',
        operationId: 'op',
        operations: [{ type: 'set', key: 'title', value: 'Hello' }],
        requestId: 'req',
        operationIds: ['op']
      })
    ).toBe(false)
  }
  expect(isCollabClientMessage({ type: 'ping' })).toBe(true)
  expect(isCollabClientMessage({ type: 'location', location: null })).toBe(true)
  expect(isCollabClientMessage({ type: 'presence:delete', registrationId: '' })).toBe(false)
})
