import { initializeRemoteWorkspace } from '../remote/workspace'
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import * as remote from '../remote/client'
import * as config from '../app-config'
import { startRemoteWorkspaceSync, syncRemoteWorkspaces } from './remote'
import { remoteReferenceFolderName } from './remote-workspace-reference'
import {
  DEFAULT_REGISTRY_PATH,
  listWorkspaces,
  registerWorkspace,
  setRegistryPath
} from './registry'
import { initializeRemoteWorkspaceConfig } from './layout'
let root: string
const target = { user_id: 'alice', workspace_id: 'board' }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'moi-remote-'))
  setRegistryPath(join(root, 'registry.json'))
  spyOn(config, 'createdWorkspacesRoot').mockReturnValue(join(root, 'spaces'))
  spyOn(remote, 'fetchRemoteWorkspaces').mockResolvedValue(
    ['alice', 'bob'].map(id => ({
      id: 'board',
      owner: { id, name: id, email: `${id}@example.com` }
    }))
  )
})
afterEach(async () => {
  mock.restore()
  setRegistryPath(DEFAULT_REGISTRY_PATH)
  await rm(root, { recursive: true, force: true })
})
test('concurrent opens provision once and later opens leave the reference and skill untouched', async () => {
  const [first, second] = await Promise.all([
    syncRemoteWorkspaces(target),
    syncRemoteWorkspaces(target)
  ])
  expect(basename(first!.path)).toMatch(/^remote-board-[0-9a-f]{12}$/)
  expect(first!.id).toBe(second!.id)
  const file = Bun.file(join(first!.path, '.moi/.workspace.json'))
  expect(await file.json()).toEqual({ version: 2, remote: target })
  expect(await Bun.file(join(first!.path, '.moi/package.json')).exists()).toBe(false)
  const skill = join(first!.path, '.agents/skills/moi-workspace/SKILL.md')
  expect(await Bun.file(skill).exists()).toBe(true)
  await Bun.write(skill, 'Personal skill version')
  await Bun.write(file, JSON.stringify({ version: 2, remote: target, layoutMode: 'fullscreen' }))
  await syncRemoteWorkspaces(target)
  expect((await file.json()).layoutMode).toBe('fullscreen')
  expect(await Bun.file(skill).text()).toBe('Personal skill version')
  const other = await syncRemoteWorkspaces({ ...target, user_id: 'bob' })
  expect(other!.path).not.toBe(first!.path)
  expect(await listWorkspaces()).toHaveLength(2)
})
test('a chosen agent is saved in the registry and never in the remote workspace reference', async () => {
  const entry = await syncRemoteWorkspaces(target, 'codex')
  expect(entry?.harness).toBe('codex')
  expect(await Bun.file(join(entry!.path, '.moi/.workspace.json')).json()).toEqual({
    version: 2,
    remote: target
  })
})
test('manual references are reused and malformed addresses create nothing', async () => {
  const path = join(root, 'manual')
  await initializeRemoteWorkspaceConfig(path, target)
  const entry = await registerWorkspace(path)
  expect((await syncRemoteWorkspaces(target))!.id).toBe(entry.id)
  await expect(syncRemoteWorkspaces({ ...target, user_id: '../unknown' })).rejects.toThrow(
    'Invalid remote owner ID'
  )
  expect(await listWorkspaces()).toHaveLength(1)
})
test('a matching reference left before registration is reused on retry', async () => {
  const path = join(root, 'spaces', remoteReferenceFolderName(target))
  await mkdir(path, { recursive: true })
  await expect(syncRemoteWorkspaces(target)).rejects.toThrow('different content')
  await initializeRemoteWorkspaceConfig(path, target)
  expect((await syncRemoteWorkspaces(target))!.path).toBe(path)
})

test('first open with an unavailable membership list creates nothing', async () => {
  spyOn(remote, 'fetchRemoteWorkspaces').mockRejectedValue(new Error('offline'))
  await expect(syncRemoteWorkspaces(target)).rejects.toThrow('offline')
  expect(await listWorkspaces()).toHaveLength(0)
})

test.each(['a b', '-board', 'a:b', 'create'])(
  'UI and CLI reject the same invalid workspace ID: %s',
  async workspace_id => {
    const invalid = { user_id: 'alice', workspace_id }
    await expect(syncRemoteWorkspaces(invalid)).rejects.toThrow()
    await expect(initializeRemoteWorkspace(join(root, 'invalid'), invalid)).rejects.toThrow()
    expect(await listWorkspaces()).toEqual([])
    expect(await Bun.file(join(root, 'invalid/.moi/.workspace.json')).exists()).toBe(false)
  }
)

test('sync creates references before first open and skips inaccessible workspaces', async () => {
  await syncRemoteWorkspaces()
  expect(await listWorkspaces()).toHaveLength(2)
  expect(await syncRemoteWorkspaces({ ...target, user_id: 'other' })).toBeUndefined()
})

test('opening a remote workspace after accepting an invitation rechecks membership after an older sync', async () => {
  const started = Promise.withResolvers<void>()
  const oldList = Promise.withResolvers<Awaited<ReturnType<typeof remote.fetchRemoteWorkspaces>>>()
  const fetch = spyOn(remote, 'fetchRemoteWorkspaces').mockImplementationOnce(() => {
    started.resolve()
    return oldList.promise
  })
  const background = syncRemoteWorkspaces()
  await started.promise
  const opening = syncRemoteWorkspaces(target)
  oldList.resolve([])
  await background
  expect((await opening)?.remote).toEqual(target)
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('signed-out startup is quiet while opening a remote workspace still asks for login', async () => {
  spyOn(config, 'getAppConfig').mockReturnValue({ ...config.getAppConfig(), environment: 'cloud' })
  const signedOut = new remote.CloudSignInRequired('Sign in with moi remote login')
  spyOn(remote, 'fetchRemoteWorkspaces').mockRejectedValue(signedOut)
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  const interval = spyOn(globalThis, 'setInterval')
  startRemoteWorkspaceSync()
  const timer = interval.mock.results[0]
  if (timer.type === 'return') clearInterval(timer.value)
  // The explicit open runs after the startup sync under the same lock.
  await expect(syncRemoteWorkspaces(target)).rejects.toBe(signedOut)
  expect(warn).not.toHaveBeenCalled()
})
