import { seedWorkspaceInfo } from '@/client/features/workspace/workspace-test-utils'
import { memberKeys } from './keys'
import { afterEach, expect, test } from 'bun:test'
import { queryClient } from '@/client/api/query-client'
import { setIdentity, getIdentity } from '../../identity/store'
import { getCurrentUser } from '../host-state'
import {
  setWorkspaceMembers,
  setAllWorkspaceMembers,
  getWorkspaceMembersRevision,
  getWorkspaceDirectory,
  updateWorkspaceMembers,
  refreshMemberProfile
} from './store'
import type { WorkspaceMembers } from './types'
import { parseWorkspaceMembers } from './types'
import { applyPendingMembership } from './hooks'
const alex = {
  id: 'alex',
  type: 'user',
  name: 'Alex',
  email: 'alex@example.com',
  isAnonymous: false
} as const
const bot = { id: 'alex', type: 'agent', name: 'Bot' } as const
afterEach(() => {
  setIdentity(null)
  queryClient.clear()
})
test('host-published members survive ordinary query garbage collection without mounted observers', async () => {
  const defaults = queryClient.getDefaultOptions()
  queryClient.setDefaultOptions({ queries: { gcTime: 5 } })
  try {
    setIdentity(alex)
    setAllWorkspaceMembers([{ id: 'one', members: [alex, bot], invitations: [] }])
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(getWorkspaceDirectory('one')?.map(user => user.id)).toEqual(['alex', 'agent:alex'])
  } finally {
    queryClient.setDefaultOptions(defaults)
  }
})
test('pre-mount snapshots populate the actual query cache and separate user and agent ids', () => {
  setIdentity(alex)
  setWorkspaceMembers('one', { members: [alex, bot], invitations: [] })
  expect(
    queryClient.getQueryData<WorkspaceMembers>(memberKeys.workspace('user:alex', 'one'))
  ).toEqual({
    members: [alex, bot],
    invitations: []
  })
  expect(getWorkspaceDirectory('one')?.map(user => user.id)).toEqual(['alex', 'agent:alex'])
  expect(getCurrentUser()?.id).toBe('alex')
})
test('per-workspace directory does not leak members or replace viewer', () => {
  setIdentity(alex)
  setWorkspaceMembers('one', { members: [alex, bot], invitations: [] })
  setWorkspaceMembers('two', { members: [alex], invitations: [] })
  expect(getWorkspaceDirectory('one')).toHaveLength(2)
  expect(getWorkspaceDirectory('two')).toHaveLength(1)
  expect(getIdentity()).toEqual(alex)
})
test('account switch removes previous membership snapshots', () => {
  setIdentity(alex)
  setWorkspaceMembers('one', { members: [alex, bot], invitations: [] })
  setIdentity({ ...alex, id: 'next' })
  expect(getWorkspaceDirectory('one')).toBeUndefined()
  expect(queryClient.getQueriesData({ queryKey: ['workspace-members'] })).toEqual([])
})
test('invalid snapshot publishes nothing', () => {
  setIdentity(alex)
  expect(() => parseWorkspaceMembers({ members: [alex, alex], invitations: [] })).toThrow()
  expect(getWorkspaceDirectory('one')).toBeUndefined()
})
test('sharing snapshots replace members and omitted workspaces become owner-only', () => {
  setIdentity(alex)
  setAllWorkspaceMembers([
    { id: 'one', members: [alex, bot], invitations: [] },
    { id: 'two', members: [alex], invitations: [] }
  ])
  expect(getWorkspaceDirectory('one')).toHaveLength(2)
  expect(getWorkspaceDirectory('two')).toHaveLength(1)
  const before = getWorkspaceMembersRevision()
  setAllWorkspaceMembers([{ id: 'two', members: [alex, bot], invitations: [] }])
  expect(getWorkspaceDirectory('one')?.map(user => user.id)).toEqual(['alex'])
  expect(
    queryClient.getQueryData<WorkspaceMembers>(memberKeys.workspace('user:alex', 'one'))
  ).toEqual({
    members: [alex],
    invitations: []
  })
  expect(getWorkspaceDirectory('two')).toHaveLength(2)
  expect(getWorkspaceMembersRevision()).toBeGreaterThan(before)
  expect(() =>
    setAllWorkspaceMembers([
      { id: 'two', members: [alex], invitations: [] },
      { id: 'bad/id', members: [], invitations: [] }
    ])
  ).toThrow()
  expect(getWorkspaceDirectory('two')).toHaveLength(2)
  setAllWorkspaceMembers([])
  expect(getWorkspaceDirectory('two')?.map(user => user.id)).toEqual(['alex'])
})
test('an empty sharing snapshot still lets the owner use local workspaces', () => {
  setIdentity(alex)
  expect(getWorkspaceDirectory('local')).toBeUndefined()
  const before = getWorkspaceMembersRevision()
  setAllWorkspaceMembers([])
  expect(getWorkspaceMembersRevision()).toBeGreaterThan(before)
  expect(getWorkspaceDirectory('local')?.map(user => user.id)).toEqual(['alex'])
  setAllWorkspaceMembers([{ id: 'local', members: [], invitations: [] }])
  expect(getWorkspaceDirectory('local')).toEqual([])
})
test('optimistic pending actions are derived over the newest snapshot without mutating it', () => {
  const current = { members: [alex, { ...bot, membershipId: 'bot' }], invitations: [] }
  const pending = [{ id: 1, action: { type: 'invite', email: 'tony@example.com' } as const }]
  expect(applyPendingMembership(current, pending)?.invitations).toMatchObject([
    { email: 'tony@example.com', pending: true }
  ])
  expect(current.invitations).toEqual([])
  const pushed = { ...current, members: [alex] }
  expect(applyPendingMembership(pushed, pending)?.members).toEqual([alex])
  expect(applyPendingMembership(pushed, [])).toEqual(pushed)
})

test('shared workspaces are listed under the owner address and lose access when omitted', () => {
  setIdentity(alex)
  const id = 'visitor-board'
  seedWorkspaceInfo(id, { user_id: 'host', workspace_id: 'board' })
  expect(getWorkspaceDirectory(id)).toBeUndefined()
  setAllWorkspaceMembers([
    { id: 'board', members: [alex], invitations: [] },
    { id: 'host:board', members: [alex, bot], invitations: [] }
  ])
  expect(getWorkspaceDirectory(id)).toHaveLength(2)
  expect(getWorkspaceDirectory('board')).toHaveLength(1)
  setAllWorkspaceMembers([])
  expect(getWorkspaceDirectory(id)).toEqual([])
  expect(getWorkspaceDirectory('board')?.map(user => user.id)).toEqual(['alex'])
  expect(getWorkspaceDirectory('never-opened')?.map(user => user.id)).toEqual(['alex'])
})

test('confirmed changes and saved profiles update published lists in place', () => {
  setIdentity(alex)
  setAllWorkspaceMembers([
    { id: 'one', members: [alex, { ...bot, membershipId: 'bot' }], invitations: [] }
  ])
  const key = (id: string) => memberKeys.workspace('user:alex', id)
  updateWorkspaceMembers('one', current => ({ ...current, members: [alex] }))
  expect(queryClient.getQueryData<WorkspaceMembers>(key('one'))?.members).toEqual([alex])
  // An owner-only workspace has no stored list until its first change.
  const invitation = { id: 'invite', email: 'tony@example.com', expiresAt: '2099-01-01' }
  updateWorkspaceMembers('two', current => ({ ...current, invitations: [invitation] }))
  expect(queryClient.getQueryData<WorkspaceMembers>(key('two'))).toEqual({
    members: [alex],
    invitations: [invitation]
  })
  refreshMemberProfile({ ...alex, name: 'Renamed' })
  expect(queryClient.getQueryData<WorkspaceMembers>(key('one'))?.members).toEqual([
    { ...alex, name: 'Renamed' }
  ])
})
