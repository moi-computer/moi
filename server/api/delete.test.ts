import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { api } from './index'
import * as appConfig from '../app-config'
import { initializeRemoteWorkspaceConfig } from '../workspaces/layout'
import { installWorkspaceSkills } from '../skills/workspace'
import {
  resetWorkspaceEnvForTest,
  setSecretStoreBackend,
  setWorkspaceEnvStorePath,
  updateWorkspaceEnv
} from '../workspaces/env'
import {
  DEFAULT_WORKSPACE_STATE_ROOT,
  setWorkspaceStateRoot,
  updateWorkspaceState
} from '../workspace-state'
import * as remote from '../remote/client'
import { codexHarness } from '../harness/codex'
import {
  DEFAULT_REGISTRY_PATH,
  getWorkspace,
  registerWorkspace,
  setRegistryPath
} from '../workspaces/registry'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'moi-api-delete-'))
  setRegistryPath(join(tempDir, 'workspaces.json'))
  setWorkspaceStateRoot(join(tempDir, 'state'))
  setWorkspaceEnvStorePath(join(tempDir, 'env.json'), join(tempDir, 'secrets.json'))
  setSecretStoreBackend('file')
})

afterEach(async () => {
  mock.restore()
  resetWorkspaceEnvForTest()
  setWorkspaceStateRoot(DEFAULT_WORKSPACE_STATE_ROOT)
  setRegistryPath(DEFAULT_REGISTRY_PATH)
  await rm(tempDir, { recursive: true, force: true })
})

test('deleting a local workspace unregisters it and stops its harness', async () => {
  const workspacePath = join(tempDir, 'workspace')
  const workspace = await registerWorkspace(workspacePath, { harness: 'codex' })
  const stop = spyOn(codexHarness, 'stopWorkspace').mockImplementation(() => {})

  const response = await api.request(`/api/workspaces/${workspace.id}`, { method: 'DELETE' })

  expect(response.status).toBe(204)
  expect(stop).toHaveBeenCalledWith(workspacePath)
  expect(await getWorkspace(workspace.id)).toBeNull()
})

function cloudMode() {
  spyOn(appConfig, 'getAppConfig').mockReturnValue({
    ...appConfig.getAppConfig(),
    environment: 'cloud'
  })
  return spyOn(remote, 'clearWorkspaceAccess').mockResolvedValue({ success: true })
}

test('in Cloud, deleting moves the workspace to trash and restore brings it back', async () => {
  const revoke = cloudMode()
  const workspacePath = join(tempDir, 'workspace')
  const workspace = await registerWorkspace(workspacePath, { harness: 'codex', name: 'Board' })
  const stop = spyOn(codexHarness, 'stopWorkspace').mockImplementation(() => {})

  const deleted = await api.request(`/api/workspaces/${workspace.id}`, { method: 'DELETE' })
  expect(deleted.status).toBe(204)
  expect(stop).toHaveBeenCalledWith(workspacePath)

  expect((await api.request(`/api/workspaces/${workspace.id}`)).status).toBe(404)
  expect((await api.request(`/api/workspaces/${workspace.id}/views`)).status).toBe(404)
  expect(await (await api.request('/api/workspaces')).json()).toEqual([])
  const trash = (await (await api.request('/api/workspaces/trash')).json()) as { id: string }[]
  expect(trash).toMatchObject([{ id: workspace.id, name: 'Board' }])

  const restored = await api.request(`/api/workspaces/trash/${workspace.id}/restore`, {
    method: 'POST'
  })
  expect(restored.status).toBe(200)
  expect((await getWorkspace(workspace.id))?.path).toBe(workspacePath)
  expect(await (await api.request('/api/workspaces/trash')).json()).toEqual([])
  expect(revoke).toHaveBeenCalledTimes(1)
  expect(revoke).toHaveBeenCalledWith(workspace.id)
})

test('restoring an unknown workspace answers 404', async () => {
  cloudMode()
  const response = await api.request('/api/workspaces/trash/nope/restore', { method: 'POST' })
  expect(response.status).toBe(404)
})

test.each([false, true])(
  'leaving cleans up the reference after Cloud confirms (has personal files: %s)',
  async hasFiles => {
    cloudMode()
    const target = { user_id: 'alice', workspace_id: 'board' }
    const path = join(tempDir, 'board')
    await initializeRemoteWorkspaceConfig(path, target)
    await installWorkspaceSkills(path, 'codex')
    const notes = Bun.file(join(path, 'notes.txt'))
    const otherSkill = Bun.file(join(path, '.agents/skills/personal/SKILL.md'))
    if (hasFiles) {
      await Bun.write(notes, 'keep my linked files')
      await Bun.write(otherSkill, 'keep my skill')
    }
    const reference = await registerWorkspace(path, { harness: 'codex' })
    await updateWorkspaceState(reference, state => {
      state.openTabs = ['views/board']
    })
    await updateWorkspaceEnv(path, { set: { KEY: 'value' } })
    const stop = spyOn(codexHarness, 'stopWorkspace').mockImplementation(() => {})
    const leave = spyOn(remote, 'leave')
      .mockRejectedValueOnce(new Error('Cloud unavailable'))
      .mockResolvedValue({ success: true })
    const request = () => api.request(`/api/workspaces/${reference.id}`, { method: 'DELETE' })

    expect((await request()).status).toBe(503)
    expect((await getWorkspace(reference.id))?.remote).toEqual(target)
    expect(stop).not.toHaveBeenCalled()
    expect(existsSync(join(path, '.moi'))).toBe(true)
    expect(existsSync(join(path, '.claude/skills/moi-workspace/SKILL.md'))).toBe(true)

    expect((await request()).status).toBe(204)
    expect(leave).toHaveBeenCalledWith('alice', 'board')
    expect(remote.clearWorkspaceAccess).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledWith(path)
    expect(await getWorkspace(reference.id)).toBeNull()
    expect(existsSync(join(path, '.moi'))).toBe(false)
    expect(existsSync(path)).toBe(hasFiles)
    if (hasFiles) {
      expect(await notes.text()).toBe('keep my linked files')
      expect(await otherSkill.text()).toBe('keep my skill')
      expect(existsSync(join(path, '.agents/skills/moi-workspace'))).toBe(false)
      expect(existsSync(join(path, '.claude'))).toBe(false)
    }
    expect(existsSync(join(tempDir, 'state', reference.id))).toBe(false)
    expect(await Bun.file(join(tempDir, 'secrets.json')).json()).toEqual({})
  }
)
