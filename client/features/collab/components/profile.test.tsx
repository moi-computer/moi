import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'

import { Profile, ProfileContainer } from './profile'
import { createRoom, me, peer, renderCollab } from '../testing/component-fixtures'
import { createFakeEngine } from '../testing/fake-engine'

test('user rendering follows authoritative profile updates and removal', () => {
  const backend = createRoom()
  expect(renderCollab(backend, <ProfileContainer id="peer" />)).toContain('Ada')
  backend.setProfiles([me, { ...peer, name: 'Grace' }])
  expect(renderCollab(backend, <ProfileContainer id="peer" />)).toContain('Grace')
  backend.setProfiles([me])
  const removed = renderCollab(backend, <ProfileContainer id="peer" />)
  expect(removed).toContain('Unknown member')
  expect(removed).not.toContain('Grace')
})

test('you label is opt-in and identifies the current user by id', () => {
  const room = createRoom({ ...peer, name: me.name })
  expect(renderCollab(room, <ProfileContainer id={me.id} />)).not.toContain('(You)')
  expect(renderCollab(room, <ProfileContainer id={me.id} showYouLabel />)).toContain('(You)')
  expect(renderCollab(room, <ProfileContainer id={peer.id} showYouLabel />)).not.toContain('(You)')
  room.setProfiles([peer])
  expect(renderCollab(room, <ProfileContainer id={me.id} showYouLabel />)).not.toContain('(You)')
})

test('you label follows display-name fallbacks and stays hidden without a current user', () => {
  const profile = {
    type: 'user',
    id: 'nameless',
    email: 'user@example.test',
    color: 'cyan'
  } as const
  const room = createFakeEngine({ self: profile, profiles: [profile] })
  const rendered = renderCollab(room, <ProfileContainer id={profile.id} showYouLabel />)
  expect(rendered).toContain('user@example.test')
  expect(rendered).toContain('(You)')
  const signedOut = createFakeEngine({ self: undefined, profiles: [profile] })
  expect(renderCollab(signedOut, <ProfileContainer id={profile.id} showYouLabel />)).not.toContain(
    '(You)'
  )
})

test('user renders supplied profile without a collaboration provider', () => {
  const html = renderToStaticMarkup(<Profile profile={peer} description="Account" showYouLabel />)
  expect(html).toContain('Ada')
  expect(html).toContain('Account')
  expect(html).toContain('(You)')
  expect(renderToStaticMarkup(<Profile />)).toContain('Unknown member')
})
