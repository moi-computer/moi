import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CollabEngineApi } from './client'
import { createFakeEngine } from '../testing/fake-engine'
import { setIdentity } from '../../identity/store'
import { colorForId } from '@/lib/collab/colors'
import {
  useMe,
  usePeers,
  usePresence,
  usePublishPresence,
  useMember,
  useMembers,
  useWorkspaceMembers
} from './hooks'
import { AppletPresenceProvider, CollabContext, pageFromPath } from './provider'
import type { MemberProfile } from './hooks'

const alice = { type: 'user', id: 'alice', name: 'Alice', color: 'emerald' } as const
const bob = { type: 'user', id: 'bob', name: 'Bob', color: 'blue' } as const

test.each(['offline member', 'empty', 'missing'] as const)(
  '%s directory stays authoritative over connected profiles and self',
  kind => {
    const offline = { type: 'user', id: 'offline', name: 'Offline user', color: 'blue' } as const
    const room = createFakeEngine({
      self: alice,
      profiles: [alice, bob],
      otherConnections: [
        {
          connectionId: 'b',
          identityId: 'bob',
          location: { page: 'preview', status: 'active' },
          presence: []
        }
      ]
    })
    // Keep the socket snapshot populated even when membership is absent or changes.
    const directory = kind === 'missing' ? undefined : kind === 'empty' ? [] : [offline]
    const engine: CollabEngineApi = {
      ...room,
      getDirectory: () => directory
    }
    function Members() {
      return encodeURIComponent(
        JSON.stringify({
          profiles: useWorkspaceMembers(),
          connectedUser: useMember('bob'),
          peers: usePeers()
        })
      )
    }
    const snapshot = JSON.parse(
      decodeURIComponent(
        renderToStaticMarkup(
          <CollabContext value={engine}>
            <Members />
          </CollabContext>
        )
      )
    )
    expect(snapshot).toEqual({
      profiles: kind === 'offline member' ? [{ ...offline, status: 'offline' }] : [],
      peers: []
    })
  }
)

test('presence pages follow nested navigation paths and deployment bases, decoding once', () => {
  expect(pageFromPath('/workspace/test/views/board', 'test')).toBe('views/board')
  expect(pageFromPath('/prefix/workspace/test/views/draft', 'test', '/prefix')).toBe('views/draft')
  expect(pageFromPath('/prefix/workspace/test/views/%62oard', 'test', '/prefix')).toBe(
    'views/board'
  )
  expect(pageFromPath('/workspace/test/views/%2562oard', 'test')).toBe('views/%2562oard')
  expect(pageFromPath('/workspace/test/view:board', 'test')).toBe('view:board')
  expect(pageFromPath('/workspace/test', 'test')).toBe('overview')
})

function Observer() {
  return (
    <output>
      {JSON.stringify({
        me: useMe(),
        peers: usePeers(),
        profiles: useWorkspaceMembers(),
        user: useMember('bob'),
        presence: usePresence('editing')
      })}
    </output>
  )
}

test('observers resolve profiles and read presence without creating a publisher', () => {
  const room = createFakeEngine({
    self: alice,
    page: 'board',
    profiles: [alice, bob],
    otherConnections: [
      {
        connectionId: 'b',
        identityId: 'bob',
        location: { page: 'board', status: 'active' },
        presence: [
          {
            registrationId: 'field',
            appletId: 'views/board',
            channel: 'custom:editing',
            value: 'title'
          }
        ]
      }
    ]
  })
  let publications = 0
  const backend: CollabEngineApi = {
    ...room,
    setPresence: registration => {
      publications++
      room.setPresence(registration)
    }
  }
  const html = renderToStaticMarkup(
    <CollabContext value={backend}>
      <AppletPresenceProvider appletId="views/board">
        <Observer />
      </AppletPresenceProvider>
    </CollabContext>
  )
  expect(html).toContain('connectionId')
  expect(html).toContain('title')
  expect(html).toContain('Bob')
  expect(publications).toBe(0)
  expect(room.getSnapshot().connections[0]?.presence).toEqual([])
})

function Disabled() {
  usePublishPresence('editing', 'title')
  expect(useMe()).toBeUndefined()
  expect(useMember('missing')).toBeUndefined()
  expect(useMembers(['missing'])).toEqual([undefined])
  return <Observer />
}
test('hooks are safe without a backend or applet and resolve missing profiles to undefined', () => {
  setIdentity(null)
  const html = renderToStaticMarkup(<Disabled />)
  expect(html).toContain('[]')
})

test('identity does not provide a global member directory', () => {
  setIdentity({ ...alice, type: 'user', email: '', isAnonymous: false })
  try {
    function Global() {
      return encodeURIComponent(
        JSON.stringify({ me: useMe(), user: useMember('bob'), profiles: useWorkspaceMembers() })
      )
    }
    // No workspace means no directory; the current identity is still available.
    expect(JSON.parse(decodeURIComponent(renderToStaticMarkup(<Global />)))).toEqual({
      me: { ...alice, color: colorForId(alice.id), status: 'offline' },
      profiles: []
    })
  } finally {
    setIdentity(null)
  }
})

test('user hooks preserve missing names for self, peers, and offline members', () => {
  const self = { type: 'agent', id: 'self', color: 'emerald' } as const
  const peer = {
    type: 'agent',
    ownerId: 'inviter',
    id: 'bob',
    color: 'blue'
  } as const
  const offline = { type: 'user', id: 'offline', color: 'blue' } as const
  const room = createFakeEngine({
    self,
    page: 'board',
    profiles: [{ ...self, ownerId: 'inviter' }, peer, offline],
    otherConnections: [
      {
        connectionId: 'b',
        identityId: peer.id,
        location: { page: 'board', status: 'active' },
        presence: []
      }
    ]
  })
  function Users() {
    return encodeURIComponent(
      JSON.stringify({
        me: useMe(),
        user: useMember('bob'),
        peers: usePeers(),
        profiles: useWorkspaceMembers()
      })
    )
  }
  const snapshot = JSON.parse(
    decodeURIComponent(
      renderToStaticMarkup(
        <CollabContext value={room}>
          <Users />
        </CollabContext>
      )
    )
  ) as { me: MemberProfile; user: MemberProfile; peers: MemberProfile[]; profiles: MemberProfile[] }
  expect(snapshot).toEqual({
    me: { ...self, ownerId: 'inviter', status: 'active' },
    user: { ...peer, status: 'active' },
    peers: [{ ...peer, status: 'active' }],
    profiles: [
      { ...self, ownerId: 'inviter', status: 'active' },
      { ...peer, status: 'active' },
      { ...offline, status: 'offline' }
    ]
  })
})

test('workspace profiles include self and offline members with workspace-wide status filters', () => {
  const carol = { type: 'user', id: 'carol', name: 'Carol', color: 'blue' } as const
  const david = { type: 'user', id: 'david', name: 'David', color: 'emerald' } as const
  const room = createFakeEngine({
    self: alice,
    page: 'board',
    profiles: [alice, bob, carol, david],
    otherConnections: [
      {
        connectionId: 'b1',
        identityId: 'bob',
        location: { page: 'other-page', status: 'active' },
        presence: []
      },
      { connectionId: 'b2', identityId: 'bob', location: null, presence: [] },
      { connectionId: 'c', identityId: 'carol', location: null, presence: [] }
    ]
  })
  function Directory() {
    // Encode the readout so React's HTML escaping does not alter the JSON.
    return encodeURIComponent(
      JSON.stringify({
        all: useWorkspaceMembers(),
        active: useWorkspaceMembers({ status: 'active' }),
        away: useWorkspaceMembers({ status: 'away' }),
        offline: useWorkspaceMembers({ status: 'offline' })
      })
    )
  }
  const render = () =>
    JSON.parse(
      decodeURIComponent(
        renderToStaticMarkup(
          <CollabContext value={room}>
            <Directory />
          </CollabContext>
        )
      )
    ) as Record<string, MemberProfile[]>

  const snapshot = render()
  expect(snapshot.all).toEqual([
    { ...alice, status: 'active' },
    { ...bob, status: 'active' },
    { ...carol, status: 'away' },
    { ...david, status: 'offline' }
  ])
  expect(snapshot.active).toEqual([
    { ...alice, status: 'active' },
    { ...bob, status: 'active' }
  ])
  expect(snapshot.away).toEqual([{ ...carol, status: 'away' }])
  expect(snapshot.offline).toEqual([{ ...david, status: 'offline' }])

  // A host directory replacement removes even connected members and updates profiles.
  room.setProfiles([alice, { ...david, name: 'David updated' }])
  const updated = render()
  expect(updated.all).toEqual([
    { ...alice, status: 'active' },
    { ...david, name: 'David updated', status: 'offline' }
  ])
  expect(updated.away).toEqual([])

  room.setProfiles([])
  expect(render().all).toEqual([])
})

test('missing and empty directories hide members while preserving self', () => {
  const engine = createFakeEngine({
    self: alice,
    profiles: [alice, bob],
    otherConnections: [{ connectionId: 'b', identityId: bob.id, location: null, presence: [] }]
  })
  engine.setProfiles(undefined)
  function Directory() {
    const me = useMe()
    return encodeURIComponent(
      JSON.stringify({ profiles: useWorkspaceMembers(), me, hasMe: me !== undefined })
    )
  }
  const render = () =>
    JSON.parse(
      decodeURIComponent(
        renderToStaticMarkup(
          <CollabContext value={engine}>
            <Directory />
          </CollabContext>
        )
      )
    )
  const populated = {
    profiles: [
      { ...alice, status: 'active' },
      { ...bob, status: 'away' }
    ],
    me: { ...alice, status: 'active' },
    hasMe: true
  }
  // Identity remains available even when workspace membership is unknown.
  expect(render()).toEqual({ profiles: [], me: { ...alice, status: 'active' }, hasMe: true })
  // An empty host directory is authoritative, even over the viewer.
  engine.setProfiles([])
  expect(render()).toEqual({ profiles: [], me: { ...alice, status: 'active' }, hasMe: true })
  engine.setProfiles([alice, bob])
  expect(render()).toEqual(populated)
  engine.setProfiles(undefined)
  expect(render()).toEqual({ profiles: [], me: { ...alice, status: 'active' }, hasMe: true })
})

test('away peers remain on the page while their focus presence is hidden', () => {
  const engine = createFakeEngine({
    self: alice,
    page: 'board',
    profiles: [alice, bob],
    otherConnections: [
      {
        connectionId: 'b',
        identityId: bob.id,
        location: { page: 'board', status: 'away' },
        presence: [
          {
            registrationId: 'focus',
            appletId: 'views/board',
            channel: 'custom:editing',
            value: 'title'
          }
        ]
      }
    ]
  })
  function Away() {
    return encodeURIComponent(
      JSON.stringify({ peers: usePeers({ status: 'away' }), presence: usePresence('editing') })
    )
  }
  const result = JSON.parse(
    decodeURIComponent(
      renderToStaticMarkup(
        <CollabContext value={engine}>
          <AppletPresenceProvider appletId="views/board">
            <Away />
          </AppletPresenceProvider>
        </CollabContext>
      )
    )
  )
  expect(result).toEqual({ peers: [{ ...bob, status: 'away' }], presence: [] })
})
