import { profileDisplayName } from '@/client/lib/profile-display-name'
import { expect, test } from 'bun:test'
import type { ConnectionStatus } from 'moi/collab'
import type { Connection } from '@/lib/collab/types'
import { summarizeMemberPresence, resolvePeers, resolveMember } from './member-profiles'

const alice = { type: 'user', id: 'alice', name: 'Alice', color: 'emerald' } as const
const bob = { type: 'user', id: 'bob', name: 'Bob', color: 'blue' } as const
const eve = { type: 'user', id: 'eve', name: 'Eve', color: 'blue' } as const
function connection(
  connectionId: string,
  identityId: string,
  page: string | null,
  status: ConnectionStatus = 'active'
): Connection {
  return {
    connectionId,
    identityId,
    location: page === null ? null : { page, status },
    presence: []
  }
}
const connections = [
  connection('self', 'alice', 'board'),
  connection('self-2', 'alice', 'board'),
  connection('b1', 'bob', 'board'),
  connection('b2', 'bob', null),
  connection('e1', 'eve', null)
]
const source = { connections, profiles: [alice, bob, eve] }

test('display names fall back to email or stable id without changing profile fields', () => {
  const nameless = {
    type: 'user',
    id: 'user-id',
    color: 'emerald',
    name: '  ',
    email: '  user@example.test  '
  } as const
  expect(profileDisplayName({ ...nameless, name: '  Named user  ' })).toBe('Named user')
  expect(profileDisplayName(nameless)).toBe('user@example.test')
  expect(profileDisplayName({ ...nameless, email: '  ' })).toBe('user-id')
  expect(profileDisplayName({ type: 'user', id: 'only-id', color: 'emerald' })).toBe('only-id')
  expect(nameless.name).toBe('  ')
  expect(nameless.email).toBe('  user@example.test  ')
})

test('peers are other profiles, deduplicated across tabs, with page/workspace and status filters', () => {
  expect(resolvePeers(source, 'alice', { page: 'board', status: 'active' })).toEqual([
    { ...bob, status: 'active' }
  ])
  expect(
    resolvePeers(source, 'alice', { page: 'board', status: 'active' }, { scope: 'workspace' })
  ).toEqual([
    { ...bob, status: 'active' },
    { ...eve, status: 'away' }
  ])
  expect(resolvePeers(source, 'alice', null)).toEqual([])
  expect(resolvePeers(source, 'alice', null, { scope: 'workspace', status: 'away' })).toEqual([
    { ...eve, status: 'away' }
  ])
})

test('hidden tabs stay in their page peers and support the away filter', () => {
  const connections = [
    connection('self', 'alice', 'board'),
    connection('b1', 'bob', 'board', 'away'),
    connection('b2', 'bob', 'notes', 'away'),
    connection('e1', 'eve', 'notes', 'away')
  ]
  const source = { connections, profiles: [alice, bob, eve] }
  expect(resolvePeers(source, 'alice', { page: 'board', status: 'active' })).toEqual([
    { ...bob, status: 'away' }
  ])
  expect(
    resolvePeers(source, 'alice', { page: 'board', status: 'active' }, { status: 'away' })
  ).toEqual([{ ...bob, status: 'away' }])
  expect(
    resolvePeers(source, 'alice', { page: 'board', status: 'active' }, { status: 'active' })
  ).toEqual([])
  expect(
    summarizeMemberPresence(connections, {
      currentProfile: alice,
      page: 'board',
      profiles: source.profiles
    }).find(user => user.profile.id === 'bob')
  ).toMatchObject({ page: undefined, status: 'away' })
})

test('a visible connection makes the user active across their away page connections', () => {
  const connections = [connection('b1', 'bob', 'board', 'away'), connection('b2', 'bob', 'notes')]
  const source = { connections, profiles: [bob] }
  expect(resolveMember(source, 'bob')?.status).toBe('active')
  expect(
    resolvePeers(source, 'alice', { page: 'board', status: 'active' }, { status: 'away' })
  ).toEqual([])
  expect(
    resolvePeers(source, 'alice', { page: 'board', status: 'active' }, { status: 'active' })
  ).toEqual([{ ...bob, status: 'active' }])
})

test.each(['__proto__', 'constructor', 'toString'])('%s resolves as an ordinary user id', id => {
  const user = { ...alice, id }
  expect(resolveMember({ connections: [], profiles: [user] }, user.id)).toEqual({
    ...user,
    status: 'offline'
  })
  expect(resolveMember({ connections: [], profiles: [] }, id)).toBeUndefined()
})

test('member summary includes offline profiles and puts self first', () => {
  const profiles = [...source.profiles, { ...eve, id: 'offline' }]
  const result = summarizeMemberPresence(connections, {
    currentProfile: alice,
    page: 'board',
    profiles
  })
  expect(result[0]).toMatchObject({ profile: alice, self: true, page: 'board' })
  expect(result[1]).toMatchObject({ profile: bob, page: 'board', status: 'active' })
  expect(result.at(-1)).toMatchObject({ page: undefined, status: 'offline' })
})

test('summary prefers an active page, keeps the first active connection, and uses my current page', () => {
  const result = summarizeMemberPresence(
    [
      connection('self-other', 'alice', 'notes'),
      connection('b-away', 'bob', 'old-page', 'away'),
      connection('b-active', 'bob', 'board'),
      connection('b-other', 'bob', 'notes'),
      connection('e-away', 'eve', 'notes', 'away')
    ],
    { currentProfile: alice, page: 'current-page', profiles: [alice, bob, eve] }
  )
  expect(result[0]).toMatchObject({ self: true, page: 'current-page' })
  expect(result[1]).toMatchObject({ page: 'board', status: 'active' })
  expect(result[2]).toMatchObject({ page: undefined, status: 'away' })
})
