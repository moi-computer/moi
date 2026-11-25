import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { PresenceRegistration, Profile } from '@/lib/collab/types'

import { AppletPresenceProvider, CollabContext } from '../presence/provider'
import { presenceChannels } from '../presence/hooks'
import { presenceTarget } from '../presence/presence-target'
import { createFakeEngine } from './fake-engine'
import type { FakeEngine } from './fake-engine'

export const me: Profile = { type: 'user', id: 'me', name: 'Me', color: 'blue' }
export const peer: Profile = { type: 'user', id: 'peer', name: 'Ada', color: 'cyan' }
export const namelessUsers = [
  [{ type: 'user', id: 'user-id', color: 'cyan' }, 'user-id'],
  [
    { type: 'user', id: 'user-id', name: '   ', email: 'user@example.test', color: 'cyan' },
    'user@example.test'
  ]
] satisfies Array<[Profile, string]>

export function createRoom(profile: Profile = peer, presence: PresenceRegistration[] = []) {
  return createFakeEngine({
    self: me,
    page: 'board',
    profiles: [me, profile],
    otherConnections: [
      {
        connectionId: 'remote',
        identityId: profile.id,
        location: { page: 'board', status: 'active' },
        presence
      }
    ]
  })
}

export function createFocusRoom(target = presenceTarget('task:42:title'), profile = peer) {
  return createRoom(profile, [
    {
      registrationId: 'focus',
      appletId: 'views/board',
      channel: presenceChannels.target(target),
      value: true
    }
  ])
}

export function renderCollab(backend: FakeEngine, children: ReactNode, active = true) {
  return renderToStaticMarkup(
    <CollabContext value={backend}>
      <AppletPresenceProvider appletId="views/board" active={active}>
        {children}
      </AppletPresenceProvider>
    </CollabContext>
  )
}
