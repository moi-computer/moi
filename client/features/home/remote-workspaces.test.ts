import { expect, test } from 'bun:test'
import { homeWorkspaces, visibleWorkspaces } from './remote-workspaces'

test('lists unregistered remote workspaces first, deduplicated by owner and workspace ID', () => {
  const result = homeWorkspaces(
    [
      { id: 'local', path: '/Zebra', addedAt: '', name: 'Zebra' },
      {
        id: 'alias',
        path: '/visitor',
        addedAt: '',
        name: 'Bravo',
        remote: { user_id: 'alice', workspace_id: 'board' }
      }
    ],
    [
      { id: 'board', owner: { id: 'alice', name: 'Alice' }, name: 'Bravo' },
      { id: 'board', owner: { id: 'bob', name: 'Bob' }, name: 'alpha' }
    ]
  )
  expect(result.map(item => item.name)).toEqual(['alpha', 'Zebra', 'Bravo'])
  expect(result.map(item => item.href)).toEqual([
    '/workspace/bob:board',
    '/workspace/local',
    '/workspace/alias'
  ])
})

test('hides a reference only when Cloud confirms the remote workspace is missing', () => {
  const local = { remote: undefined }
  const linked = { remote: { user_id: 'alice', workspace_id: 'board' } }
  const entries = [local, linked]
  const remote = { id: 'board', owner: { id: 'alice', name: 'Alice' } }
  expect(visibleWorkspaces(entries, undefined)).toEqual(entries)
  expect(visibleWorkspaces(entries, [])).toEqual([local])
  expect(visibleWorkspaces(entries, [remote])).toEqual(entries)
})

test('preserves registry order when all workspaces are registered', () => {
  const entries = [
    { id: 'z', path: '/Zebra', addedAt: '' },
    { id: 'a', path: '/Alpha', addedAt: '' }
  ]
  expect(homeWorkspaces(entries, []).map(item => item.id)).toEqual(['z', 'a'])
  expect(homeWorkspaces([...entries].reverse(), []).map(item => item.id)).toEqual(['a', 'z'])
})
