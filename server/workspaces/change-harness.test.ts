import { api } from '../api/index'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as executable from '../harness/executable'
import { claudeCodeHarness } from '../harness/claude-code'
import { changeWorkspaceHarness } from './change-harness'
import { reserveWorkspaceOperation, withHarnessTransition } from './harness-transition'
import {
  DEFAULT_REGISTRY_PATH,
  getWorkspace,
  listWorkspaces,
  registerWorkspace,
  setRegistryPath
} from './registry'
import {
  DEFAULT_WORKSPACE_STATE_ROOT,
  readWorkspaceState,
  setWorkspaceStateRoot,
  updateWorkspaceState
} from '../workspace-state'
let root: string
let restore: (() => void)[] = []
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'moi-switch-'))
  setRegistryPath(join(root, 'registry.json'))
  setWorkspaceStateRoot(join(root, 'state'))
  const stop = spyOn(claudeCodeHarness, 'stopWorkspace').mockImplementation(() => {})
  restore = [() => stop.mockRestore()]
})
afterEach(async () => {
  restore.forEach(fn => fn())
  setRegistryPath(DEFAULT_REGISTRY_PATH)
  setWorkspaceStateRoot(DEFAULT_WORKSPACE_STATE_ROOT)
  await rm(root, { recursive: true, force: true })
})
test('switches in place and preserves metadata while resetting selections and pending builds', async () => {
  const ws = await registerWorkspace(root, { harness: 'claude-code', name: 'My workspace' })
  await updateWorkspaceState(ws, state => {
    state.chatDefaults = { model: 'old-default', effort: 'high', speedMode: 'fast' }
    state.selected.overview = 'old'
    state.pinnedSessionId = 'old'
    state.sessions.old = { config: { model: 'old-model' } }
    state.pendingViews.view = {
      requirements: 'A dashboard',
      status: 'failed',
      buildSessionId: 'old'
    }
  })
  const next = await changeWorkspaceHarness(ws, 'codex')
  expect(next).toMatchObject({ id: ws.id, path: root, name: ws.name, harness: 'codex' })
  const state = await readWorkspaceState(ws)
  expect(state.chatDefaults).toEqual({})
  expect(state.selected).toEqual({})
  expect(state.pinnedSessionId).toBeUndefined()
  expect(state.sessions.old?.config?.model).toBe('old-model')
  expect(state.pendingViews.view).toEqual({ requirements: 'A dashboard', status: 'draft' })
  // A later choice wins even when its caller still holds the original registration.
  await changeWorkspaceHarness(ws, 'claude-code')
  expect((await getWorkspace(ws.id))?.harness).toBe('claude-code')
  expect((await listWorkspaces()).map(entry => entry.id)).toEqual([ws.id])
})
test('rejects reserved startup without changing registration', async () => {
  const ws = await registerWorkspace(root, { harness: 'claude-code' })
  const release = reserveWorkspaceOperation(ws.id)
  try {
    await expect(changeWorkspaceHarness(ws, 'codex')).rejects.toThrow('busy')
  } finally {
    release()
  }
  expect((await getWorkspace(ws.id))?.harness).toBe('claude-code')
})
test('rejects provider-owned workspaces', async () => {
  const ws = await registerWorkspace(root, { harness: 'hermes' })
  await expect(changeWorkspaceHarness(ws, 'codex')).rejects.toThrow('cannot be changed')
})
test('rejects active sessions', async () => {
  const ws = await registerWorkspace(root, { harness: 'claude-code' })
  const active = spyOn(claudeCodeHarness, 'activeSessions').mockReturnValue([
    { workspaceId: ws.id, sessionId: 'running', activity: 'running' }
  ])
  try {
    await expect(changeWorkspaceHarness(ws, 'codex')).rejects.toThrow('finish')
  } finally {
    active.mockRestore()
  }
})

test('switches to an uninstalled agent so workspace setup can offer installation', async () => {
  const ws = await registerWorkspace(root, { harness: 'claude-code' })
  const unavailable = spyOn(executable, 'findHarnessExecutable').mockReturnValue(null)
  try {
    const updated = await changeWorkspaceHarness(ws, 'codex')
    expect(updated.harness).toBe('codex')
    expect((await getWorkspace(ws.id))?.harness).toBe('codex')
  } finally {
    unavailable.mockRestore()
  }
})

test('restores selection when registration persistence fails', async () => {
  const registry = await import('./registry')
  const ws = await registerWorkspace(root, { harness: 'claude-code' })
  await updateWorkspaceState(ws, state => {
    state.chatDefaults = { model: 'kept-model' }
    state.selected.overview = 'kept'
    state.pinnedSessionId = 'kept'
  })
  const save = spyOn(registry, 'updateWorkspaceHarness').mockRejectedValue(
    new Error('Disk failure')
  )
  try {
    await expect(changeWorkspaceHarness(ws, 'codex')).rejects.toThrow('Disk failure')
    expect((await getWorkspace(ws.id))?.harness).toBe('claude-code')
    const state = await readWorkspaceState(ws)
    expect(state.chatDefaults).toEqual({ model: 'kept-model' })
    expect(state.selected.overview).toBe('kept')
    expect(state.pinnedSessionId).toBe('kept')
  } finally {
    save.mockRestore()
  }
})

test('prepares missing skills once, shares concurrent preparation, and retries failures', async () => {
  const { prepareWorkspaceHarness } = await import('./change-harness')
  const skills = await import('../skills/update')
  const template = await import('../skills/workspace')
  const ws = await registerWorkspace(root, { harness: 'codex' })
  const status = spyOn(skills, 'getWorkspaceSkillsStatus').mockResolvedValue({
    skills: [
      {
        name: 'moi-workspace',
        path: join(root, '.agents', 'skills', 'moi-workspace'),
        installed: null,
        bundled: '1.0.0'
      }
    ],
    updateAvailable: true
  })
  const install = spyOn(template, 'installWorkspaceSkills')
    .mockRejectedValueOnce(new Error('Install failed'))
    .mockResolvedValue(['moi-workspace'])
  try {
    await expect(prepareWorkspaceHarness(ws)).rejects.toThrow('Install failed')
    await Promise.all([prepareWorkspaceHarness(ws), prepareWorkspaceHarness(ws)])
    await prepareWorkspaceHarness(ws)
    expect(install).toHaveBeenCalledTimes(2)
    expect(status).toHaveBeenCalledTimes(2)
    expect(install).toHaveBeenLastCalledWith(root, 'codex')
  } finally {
    status.mockRestore()
    install.mockRestore()
  }
})

for (const harness of ['claude-code', 'codex'] as const) {
  test(`preparing ${harness} installs the shared skill and Claude link`, async () => {
    const { prepareWorkspaceHarness } = await import('./change-harness')
    const ws = await registerWorkspace(root, { harness: harness })
    await prepareWorkspaceHarness(ws)
    expect(
      await Bun.file(join(root, '.agents', 'skills', 'moi-workspace', 'SKILL.md')).exists()
    ).toBe(true)
    expect(await readlink(join(root, '.claude', 'skills', 'moi-workspace'))).toBe(
      '../../.agents/skills/moi-workspace'
    )
  })
}

test('the harness route uses its own lock and still refuses an active operation', async () => {
  const ws = await registerWorkspace(root, { harness: 'claude-code' })
  const change = () =>
    api.request(`/api/workspaces/${ws.id}/harness`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ harness: 'codex' })
    })
  const release = reserveWorkspaceOperation(ws.id)
  try {
    expect((await change()).status).toBe(409)
  } finally {
    release()
  }
  expect((await change()).status).toBe(200)
  expect((await getWorkspace(ws.id))?.harness).toBe('codex')
})

test('a view named harness cannot bypass the operation lock', async () => {
  const ws = await registerWorkspace(root, { harness: 'claude-code' })
  await updateWorkspaceState(ws, state => {
    state.pendingViews.harness = { status: 'draft', requirements: '' }
  })
  await withHarnessTransition(ws, async () => {
    const response = await api.request(`/api/workspaces/${ws.id}/views/harness`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Changed' })
    })
    expect(response.status).toBe(409)
  })
  expect((await readWorkspaceState(ws)).pendingViews.harness?.title).toBeUndefined()
})
