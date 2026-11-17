import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test } from 'bun:test'

import { workspaceKeys } from '@/client/api/workspace-keys'
import {
  renameSelectedSessionInCache,
  selectedSessionForTab
} from '@/client/features/chat/sessions/use-selected-session'
import type { WorkspaceState } from '@/lib/types'

const WORKSPACE_ID = 'workspace-1'

function workspaceState(patch: Partial<WorkspaceState> = {}): WorkspaceState {
  return { revision: 1, selected: {}, sessions: {}, pendingViews: {}, ...patch }
}

function cachedState(queryClient: QueryClient): WorkspaceState | undefined {
  return queryClient.getQueryData<WorkspaceState>(workspaceKeys.state(WORKSPACE_ID))
}

describe('selected session', () => {
  test('a CLI-created view chat is selected from personal state', () => {
    const tabId = 'views/new-view' as const
    const state = workspaceState({ selected: { [tabId]: 'cli-child' } })
    expect(selectedSessionForTab(state, tabId)).toBe('cli-child')
    expect(selectedSessionForTab({ ...state, pinnedSessionId: 'pinned-chat' }, tabId)).toBe(
      'pinned-chat'
    )
  })

  test('is unknown until the workspace state loads', () => {
    expect(selectedSessionForTab(undefined, 'overview')).toBeUndefined()
    expect(selectedSessionForTab(workspaceState(), 'overview')).toBeNull()
  })

  test('a renamed chat keeps its tabs, pin, settings, fork children, and build', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(
      workspaceKeys.state(WORKSPACE_ID),
      workspaceState({
        pinnedSessionId: 'temp',
        selected: { overview: 'temp', 'views/board': 'temp' },
        sessions: {
          temp: { tabId: 'views/board', config: { model: 'sonnet' } },
          child: { fork: { fromSessionId: 'temp' } }
        },
        pendingViews: { board: { status: 'starting', requirements: '', buildSessionId: 'temp' } }
      })
    )

    renameSelectedSessionInCache(queryClient, WORKSPACE_ID, 'temp', 'real')

    expect(cachedState(queryClient)).toEqual(
      workspaceState({
        pinnedSessionId: 'real',
        selected: { overview: 'real', 'views/board': 'real' },
        sessions: {
          real: { tabId: 'views/board', config: { model: 'sonnet' } },
          child: { fork: { fromSessionId: 'real' } }
        },
        pendingViews: { board: { status: 'starting', requirements: '', buildSessionId: 'real' } }
      })
    )
  })
})
