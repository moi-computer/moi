import { describe, expect, spyOn, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import type { WorkspaceEntry } from '@/lib/types'

import { openRemoteWorkspace, upsertWorkspaceEntry } from '@/client/features/workspace/add/api'

const existing: WorkspaceEntry = {
  id: 'one',
  path: '/tmp/one',
  addedAt: '2026-01-01T00:00:00.000Z',
  name: 'Old name'
}

describe('upsertWorkspaceEntry', () => {
  test('prepends a new workspace', () => {
    const added: WorkspaceEntry = {
      id: 'two',
      path: '/tmp/two',
      addedAt: '2026-01-02T00:00:00.000Z'
    }

    expect(upsertWorkspaceEntry([existing], added)).toEqual([added, existing])
  })

  test('updates an existing workspace in place without duplicating it', () => {
    const other: WorkspaceEntry = {
      id: 'two',
      path: '/tmp/two',
      addedAt: '2026-01-02T00:00:00.000Z'
    }
    const imported: WorkspaceEntry = {
      ...existing,
      name: 'Updated name'
    }

    expect(upsertWorkspaceEntry([other, existing], imported)).toEqual([other, imported])
  })

  test('deduplicates a registry match returned with a different id', () => {
    const imported: WorkspaceEntry = {
      ...existing,
      id: 'replacement',
      name: 'Updated name'
    }

    expect(upsertWorkspaceEntry([existing], imported)).toEqual([imported])
  })
})

test('registers a remote workspace with the visitor’s chosen agent', async () => {
  const remote = { user_id: 'owner', workspace_id: 'board' }
  const entry: WorkspaceEntry = { ...existing, remote, harness: 'codex' }
  const request = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ isRemote: false }))
    .mockResolvedValueOnce(Response.json(entry))
  try {
    expect(await openRemoteWorkspace(new QueryClient(), remote, 'codex')).toEqual(entry)
    expect(request.mock.calls[0][0]).toBe('/api/workspaces/owner:board')
    const [url, init] = request.mock.calls[1]
    expect(url).toBe('/api/workspaces')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ remote, harness: 'codex' })
  } finally {
    request.mockRestore()
  }
})
