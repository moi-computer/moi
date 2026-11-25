import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'
import { ProfileAvatar, ProfileAvatarContainer } from './profile-avatar'
import { ProfileContainer } from './profile'
import { createRoom, me, namelessUsers, peer, renderCollab } from '../testing/component-fixtures'

test('avatar labels follow profile updates and authoritative removal', () => {
  const room = createRoom()
  const initial = renderCollab(room, <ProfileAvatarContainer id="peer" />)
  expect(initial).toContain('aria-label="Ada"')
  room.setProfiles([me, { ...peer, name: 'Grace' }])
  const updated = renderCollab(room, <ProfileAvatarContainer id="peer" />)
  expect(updated).toContain('aria-label="Grace"')
  room.setOtherConnections([])
  const offline = renderCollab(room, <ProfileAvatarContainer id="peer" />)
  expect(offline).toContain('aria-label="Grace"')
  room.setProfiles([me])
  const removed = renderCollab(room, <ProfileAvatarContainer id="peer" />)
  expect(removed).toContain('aria-label="Unknown member"')
  expect(removed).not.toContain('Grace')
})

test('nameless user labels and avatars identify profiles by email or stable id', () => {
  for (const [profile, label] of namelessUsers) {
    expect(renderCollab(createRoom(profile), <ProfileContainer id={profile.id} />)).toContain(label)
    expect(renderCollab(createRoom(profile), <ProfileAvatarContainer id={profile.id} />)).toContain(
      `aria-label="${label}"`
    )
  }
})

test('avatar renders supplied profile without a collaboration provider', () => {
  const html = renderToStaticMarkup(<ProfileAvatar profile={peer} active />)
  expect(html).toContain('aria-label="Ada"')
  expect(html).toContain('data-slot="avatar-badge"')
  expect(renderToStaticMarkup(<ProfileAvatar />)).toContain('aria-label="Unknown member"')
})
