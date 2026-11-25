import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'
import { ProfileAvatarGroup, ProfileAvatarGroupContainer } from './profile-avatar-group'
import { createRoom, renderCollab } from '../testing/component-fixtures'

test('avatar groups deduplicate user IDs and count the remaining profiles in overflow', () => {
  const html = renderCollab(
    createRoom(),
    <ProfileAvatarGroupContainer ids={['peer', 'peer', 'me', 'missing']} max={1} />
  )
  expect(html).toContain('aria-label="3 profiles"')
  expect(html.match(/aria-label="Ada"/g)).toHaveLength(1)
  expect(html).toContain('+2')
  expect(html).not.toContain('Unknown member')
})

test('avatar groups render supplied profiles and overflow without a collaboration provider', () => {
  const html = renderToStaticMarkup(
    <ProfileAvatarGroup
      profiles={[{ type: 'user', id: 'ada', name: 'Ada', color: 'cyan' }, undefined]}
      max={1}
    />
  )
  expect(html).toContain('aria-label="Ada"')
  expect(html).toContain('aria-label="2 profiles"')
  expect(html).toContain('+1')
})
