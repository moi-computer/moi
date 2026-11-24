import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { api } from '../api'
import { installWorkspaceSkills } from '../skills/workspace'
import * as remoteClient from '../remote/client'
import { createRemoteWorkspaceReference } from './remote-workspace-reference'
import { syncRemoteWorkspaces } from './remote'
import * as appConfig from '../app-config'
import {
  DEFAULT_WORKSPACE_STATE_ROOT,
  setWorkspaceStateRoot,
  updateWorkspaceState
} from '../workspace-state'
import {
  resetWorkspaceEnvForTest,
  setSecretStoreBackend,
  setWorkspaceEnvStorePath,
  updateWorkspaceEnv
} from './env'
import { getLayoutPath, initializeRemoteWorkspaceConfig } from './layout'
import {
  DEFAULT_REGISTRY_PATH,
  TRASH_RETENTION_MS,
  claimRevokedReferences,
  listWorkspaceSuggestions,
  getWorkspace,
  listTrashedWorkspaces,
  listWorkspaces,
  registerWorkspace,
  reorderWorkspaces,
  setRegistryPath,
  setWorkspaceTrashed
} from './registry'
import { changeWorkspaceTrash, startTrashSweeper, sweepTrash } from './trash'

let dir: string
let root: string
const day = 24 * 60 * 60 * 1000

const trashWorkspace = (id: string, now?: Date) =>
  setWorkspaceTrashed(id, true, async () => {}, now)
const restoreWorkspace = (id: string, now?: Date) =>
  setWorkspaceTrashed(id, false, async () => {}, now)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moi-trash-'))
  root = join(dir, 'created')
  await mkdir(root)
  setRegistryPath(join(dir, 'workspaces.json'))
  setWorkspaceStateRoot(join(dir, 'state'))
  setWorkspaceEnvStorePath(join(dir, 'env.json'), join(dir, 'secrets.json'))
  setSecretStoreBackend('file')
  spyOn(appConfig, 'getAppConfig').mockReturnValue({
    ...appConfig.getAppConfig(),
    environment: 'cloud'
  })
  spyOn(appConfig, 'createdWorkspacesRoot').mockReturnValue(root)
  spyOn(remoteClient, 'fetchRemoteWorkspaces').mockResolvedValue([])
  spyOn(remoteClient, 'clearWorkspaceAccess').mockResolvedValue({ success: true })
})

afterEach(async () => {
  resetWorkspaceEnvForTest()
  mock.restore()
  setRegistryPath(DEFAULT_REGISTRY_PATH)
  setWorkspaceStateRoot(DEFAULT_WORKSPACE_STATE_ROOT)
  await rm(dir, { recursive: true, force: true })
})

// Suggestions include real agent history. Only check folders created by this test.
async function suggestedPaths() {
  return (await listWorkspaceSuggestions())
    .map(found => found.path)
    .filter(path => path.startsWith(dir))
}

async function workspace(path: string) {
  await mkdir(join(path, '.moi'), { recursive: true })
  await writeFile(join(path, 'notes.txt'), 'mine')
  return registerWorkspace(path)
}

test('a trashed workspace is gone from lookups and listings but keeps its place in the registry', async () => {
  const kept = await workspace(join(root, 'kept'))
  const trashed = await workspace(join(root, 'trashed'))

  await trashWorkspace(trashed.id)

  expect(await getWorkspace(trashed.id)).toBeNull()
  expect((await listWorkspaces()).map(ws => ws.id)).toEqual([kept.id])
  expect((await listTrashedWorkspaces()).map(ws => ws.id)).toEqual([trashed.id])
  await reorderWorkspaces([kept.id])
  expect((await listTrashedWorkspaces()).map(ws => ws.id)).toEqual([trashed.id])
  expect(await suggestedPaths()).toEqual([])
  await expect(registerWorkspace(join(root, 'trashed'))).rejects.toThrow('in trash')
})

test('restore is refused once 30 days have passed, before cleanup has run', async () => {
  const ws = await workspace(join(root, 'board'))
  const trashedAt = new Date('2026-01-01T00:00:00Z')
  await trashWorkspace(ws.id, trashedAt)

  const early = new Date(trashedAt.getTime() + TRASH_RETENTION_MS - day)
  const late = new Date(trashedAt.getTime() + TRASH_RETENTION_MS)
  expect((await listTrashedWorkspaces(early)).map(entry => entry.id)).toEqual([ws.id])
  expect(await listTrashedWorkspaces(late)).toEqual([])
  expect((await restoreWorkspace(ws.id, late)).status).toBe('expired')
  expect((await restoreWorkspace(ws.id, early)).status).toBe('updated')
})

test.each(['codex', 'openclaw'] as const)(
  'expiry removes a Moi-only %s workspace',
  async harness => {
    const path = join(root, 'board')
    await mkdir(join(path, '.moi'), { recursive: true })
    await installWorkspaceSkills(path, harness)
    const ws = await registerWorkspace(path, { harness })
    await updateWorkspaceState(ws, state => void (state.openTabs = ['views/board']))
    const trashedAt = new Date('2026-01-01T00:00:00Z')
    await trashWorkspace(ws.id, trashedAt)

    await sweepTrash(new Date(trashedAt.getTime() + TRASH_RETENTION_MS - day))
    expect(existsSync(ws.path)).toBe(true)

    await sweepTrash(new Date(trashedAt.getTime() + TRASH_RETENTION_MS))
    expect(remoteClient.clearWorkspaceAccess).not.toHaveBeenCalled()
    expect(existsSync(ws.path)).toBe(false)
    expect(existsSync(join(dir, 'state', ws.id))).toBe(false)
    expect(await listTrashedWorkspaces()).toEqual([])
    expect((await restoreWorkspace(ws.id)).status).toBe('missing')
  }
)

test.each(['inside', 'outside'])(
  'expiry preserves an imported project %s the workspace root',
  async where => {
    const path = join(where === 'inside' ? root : dir, 'imported')
    const ws = await workspace(path)
    await trashWorkspace(ws.id, new Date(0))

    await sweepTrash()

    expect(existsSync(join(path, '.moi'))).toBe(false)
    expect(existsSync(join(path, 'notes.txt'))).toBe(true)
  }
)

async function reference(path: string, workspaceId: string) {
  await mkdir(path, { recursive: true })
  await initializeRemoteWorkspaceConfig(path, { user_id: 'alice', workspace_id: workspaceId })
  return registerWorkspace(path)
}

test('workspace cleanup unlinks the skill and preserves its target and linked parent directories', async () => {
  const ws = await reference(join(root, 'board'), 'board')
  const workspace = ws.path
  const claude = join(workspace, '.claude/skills/moi-workspace')
  const external = join(root, 'external')
  const skill = Bun.file(join(external, 'skills/moi-workspace/SKILL.md'))
  await Bun.write(skill, 'external')
  await mkdir(join(workspace, '.claude/skills'), { recursive: true })
  await symlink(external, join(workspace, '.agents'), 'dir')
  await symlink(external, claude, 'dir')

  await syncRemoteWorkspaces()
  expect(await getWorkspace(ws.id)).toBeNull()
  await expect(readlink(claude)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readlink(join(workspace, '.agents'))).toBe(external)
  expect(await skill.text()).toBe('external')
})

test('sync removes references missing from the remote workspace list', async () => {
  const gone = await createRemoteWorkspaceReference({ user_id: 'alice', workspace_id: 'board' })
  const retained = await reference(join(root, 'remote-notes-def'), 'notes')
  const linked = await reference(join(root, 'remote-personal-notes'), 'docs')
  await writeFile(join(linked.path, 'mine.txt'), 'keep')
  await updateWorkspaceEnv(gone.path, { set: { KEY: 'removed' } })
  await updateWorkspaceEnv(retained.path, { set: { KEY: 'kept' } })
  spyOn(remoteClient, 'fetchRemoteWorkspaces').mockResolvedValue([
    { id: 'trash', owner: { id: 'alice', name: 'Alice', email: 'alice@example.com' } },
    { id: 'notes', owner: { id: 'alice', name: 'Alice', email: 'alice@example.com' } },
    { id: 'board', owner: { id: 'bob', name: 'Bob', email: 'bob@example.com' } }
  ])

  expect((await api.request('/api/workspaces/sync', { method: 'POST' })).status).toBe(204)

  const entries = await listWorkspaces()
  expect(entries).toHaveLength(2)
  expect(entries.some(ws => ws.id === retained.id)).toBe(true)
  expect(
    entries.some(ws => ws.remote?.user_id === 'bob' && ws.remote.workspace_id === 'board')
  ).toBe(true)
  expect(await Bun.file(join(dir, 'secrets.json')).json()).toEqual({
    [retained.path]: { KEY: 'kept' }
  })
  expect(existsSync(gone.path)).toBe(false)
  expect(existsSync(retained.path)).toBe(true)
  expect(existsSync(join(linked.path, '.moi'))).toBe(false)
  expect(existsSync(join(linked.path, 'mine.txt'))).toBe(true)
})

test('sync keeps references when the remote workspace list is unavailable', async () => {
  const ref = await reference(join(root, 'remote-board-abc'), 'board')
  spyOn(remoteClient, 'fetchRemoteWorkspaces').mockRejectedValue(new Error('offline'))
  expect((await api.request('/api/workspaces/sync', { method: 'POST' })).status).toBe(503)

  expect((await listWorkspaces()).map(ws => ws.id)).toEqual([ref.id])
  expect(existsSync(ref.path)).toBe(true)
})

test('workspace suggestions exclude remote references', async () => {
  await mkdir(join(root, 'plain', '.moi'), { recursive: true })
  await mkdir(join(root, 'remote-board-abc'), { recursive: true })
  await initializeRemoteWorkspaceConfig(join(root, 'remote-board-abc'), {
    user_id: 'alice',
    workspace_id: 'board'
  })

  expect(await suggestedPaths()).toEqual([join(root, 'plain')])
})

test('a failed delete keeps the workspace available until revocation succeeds', async () => {
  const ws = await workspace(join(root, 'board'))
  spyOn(remoteClient, 'clearWorkspaceAccess').mockRejectedValueOnce(new Error('offline'))
  await expect(changeWorkspaceTrash(ws.id, true)).rejects.toThrow('offline')
  expect((await getWorkspace(ws.id))?.id).toBe(ws.id)
  expect((await changeWorkspaceTrash(ws.id, true)).status).toBe('updated')
  expect(await getWorkspace(ws.id)).toBeNull()
})

test('rejoining uses a fresh reference and preserves files in the old folder', async () => {
  const target = { user_id: 'alice', workspace_id: 'board' }
  const first = await createRemoteWorkspaceReference(target)
  const note = Bun.file(join(first.path, 'notes.txt'))
  await Bun.write(note, 'Keep this file')
  await syncRemoteWorkspaces()
  spyOn(remoteClient, 'fetchRemoteWorkspaces').mockResolvedValue([
    { id: 'board', owner: { id: 'alice', name: 'Alice', email: 'alice@example.com' } }
  ])
  const reopened = (await syncRemoteWorkspaces(target))!
  expect(reopened.path).not.toBe(first.path)
  expect(await note.text()).toBe('Keep this file')
  expect(await Bun.file(join(first.path, '.moi/.workspace.json')).exists()).toBe(false)
})

test('interrupted reference cleanup finishes after the folder is gone', async () => {
  const ws = await reference(join(root, 'remote-gone'), 'gone')
  await updateWorkspaceState(ws, state => void (state.openTabs = ['views/board']))
  await updateWorkspaceEnv(ws.path, { set: { KEY: 'removed' } })
  await claimRevokedReferences([ws])
  await rm(ws.path, { recursive: true })
  expect(await getWorkspace(ws.id)).toBeNull()
  expect(await listTrashedWorkspaces()).toEqual([])

  await syncRemoteWorkspaces()
  expect(existsSync(join(dir, 'state', ws.id))).toBe(false)
  expect(await Bun.file(join(dir, 'secrets.json')).json()).toEqual({})
  expect(JSON.parse(await Bun.file(join(dir, 'workspaces.json')).text())).toEqual([])
  expect(remoteClient.clearWorkspaceAccess).not.toHaveBeenCalled()
})

test('reference cleanup preserves a folder that now points to another workspace', async () => {
  const ws = await reference(join(root, 'remote-board'), 'board')
  await claimRevokedReferences([ws])
  await rm(getLayoutPath(ws.path))
  await initializeRemoteWorkspaceConfig(ws.path, { user_id: 'bob', workspace_id: 'other' })
  await updateWorkspaceEnv(ws.path, { set: { KEY: 'replacement' } })
  await syncRemoteWorkspaces()
  expect(await Bun.file(join(dir, 'secrets.json')).json()).toEqual({
    [ws.path]: { KEY: 'replacement' }
  })
  expect(existsSync(join(ws.path, '.moi', '.workspace.json'))).toBe(true)
  expect(remoteClient.clearWorkspaceAccess).not.toHaveBeenCalled()
})

test('standalone startup skips trash cleanup even with an expired registry entry', async () => {
  const ws = await workspace(join(root, 'board'))
  await trashWorkspace(ws.id, new Date(0))
  spyOn(appConfig, 'getAppConfig').mockReturnValue({
    ...appConfig.getAppConfig(),
    environment: 'local'
  })
  const interval = spyOn(globalThis, 'setInterval')
  startTrashSweeper()
  expect(interval).not.toHaveBeenCalled()
  expect(existsSync(ws.path)).toBe(true)
  expect(remoteClient.clearWorkspaceAccess).not.toHaveBeenCalled()
})
