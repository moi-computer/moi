import type { ClientEvent } from '@/lib/events'
import { receiveWorkspaceHarness } from '@/client/features/workspace/harness-transition'
import type { QueryClient } from '@tanstack/react-query'

import { workspaceKeys } from '@/client/api/workspace-keys'
import { liveStore } from '@/client/features/chat/chat-store'
import { bufferSessionEvent } from '@/client/features/chat/sessions/session-view'
import { renameSelectedSessionInCache } from '@/client/features/chat/sessions/use-selected-session'
import { applyArchivedSession } from '@/client/features/chat/sessions/api'
import { applyEvent } from '@/lib/format'
import type {
  PreviewFrame,
  SessionActivity,
  SessionSummary,
  StreamEvent,
  ViewState
} from '@/lib/types'

type ChatFrameContext = {
  queryClient: QueryClient | null
}

export function reduceChatFrame(data: Record<string, unknown>, context: ChatFrameContext) {
  const { queryClient } = context
  const store = liveStore.getState()

  if (data.type === 'harness:changed') {
    void queryClient?.invalidateQueries({ queryKey: ['harness-status'] })
    void queryClient?.invalidateQueries({ queryKey: ['workspaces', 'harness'] })
    return
  }
  if (data.type === 'workspace-harness:switched') {
    const event = data as Extract<ClientEvent, { type: 'workspace-harness:switched' }>
    if (queryClient) void receiveWorkspaceHarness(queryClient, event.workspaceId, event.harness)
    return
  }

  if (data.type === 'sessions:status-snapshot') {
    store.reconcileActivity(
      (data.sessions as
        | { workspaceId: string; sessionId: string; activity: SessionActivity }[]
        | undefined) ?? []
    )
    return
  }
  if (data.type === 'session:status') {
    const workspaceId = data.workspaceId as string
    const sessionId = data.sessionId as string
    const activity = data.activity as SessionActivity
    store.setActivity(workspaceId, sessionId, activity)
    if (activity !== 'running') store.clearPreviewsForSession(workspaceId, sessionId)
    return
  }
  if (data.type === 'session:preview') {
    const frame = data as unknown as PreviewFrame
    const key = workspaceKeys.events(frame.workspaceId, frame.sessionId)
    if (queryClient?.getQueryData(key) === undefined) return
    store.setPreview({
      workspaceId: frame.workspaceId,
      sessionId: frame.sessionId,
      messageId: frame.messageId,
      parentToolUseId: frame.parentToolUseId,
      blocks: frame.blocks
    })
    return
  }
  if (data.type === 'session:renamed') {
    const workspaceId = data.workspaceId as string
    const from = data.from as string
    const to = data.to as string
    const sessionsKey = workspaceKeys.sessions(workspaceId)
    const cachedSessions = queryClient?.getQueryData<SessionSummary[]>(sessionsKey)
    const cachedSession = cachedSessions?.find(
      session => session.sessionId === from || session.sessionId === to
    )
    if (cachedSession) {
      void queryClient?.cancelQueries({ queryKey: sessionsKey })
    }
    store.renameSession(workspaceId, from, to)
    if (queryClient) renameSelectedSessionInCache(queryClient, workspaceId, from, to)
    if (cachedSession) {
      queryClient?.setQueryData<SessionSummary[]>(sessionsKey, current => [
        {
          ...cachedSession,
          sessionId: to
        },
        ...(current ?? []).filter(session => session.sessionId !== from && session.sessionId !== to)
      ])
    }

    const previousView = queryClient?.getQueryData<ViewState>(
      workspaceKeys.events(workspaceId, from)
    )
    if (previousView !== undefined) {
      queryClient?.setQueryData(workspaceKeys.events(workspaceId, to), previousView)
      queryClient?.removeQueries({ queryKey: workspaceKeys.events(workspaceId, from) })
    }

    if (!cachedSession) {
      queryClient?.invalidateQueries({ queryKey: sessionsKey })
    }
    queryClient?.invalidateQueries({ queryKey: workspaceKeys.previews })
    return
  }
  if (data.type === 'sessions:changed' || data.type === 'session:archived') {
    const workspaceId = data.workspaceId as string
    if (queryClient && data.type === 'session:archived' && typeof data.sessionId === 'string')
      applyArchivedSession(queryClient, workspaceId, data.sessionId)
    const sessionsKey = workspaceKeys.sessions(workspaceId)
    queryClient?.invalidateQueries({ queryKey: sessionsKey })
    queryClient?.invalidateQueries({ queryKey: workspaceKeys.previews })
    return
  }
  const workspaceId = data.workspaceId as string | undefined
  const sessionId = data.sessionId as string | undefined
  if (!workspaceId || !sessionId) return
  const kind = data.kind

  if (kind === 'snapshot' || kind === 'turn' || kind === 'notice' || kind === 'result') {
    patchView(queryClient, workspaceId, sessionId, data as unknown as StreamEvent)
    if (kind === 'turn') {
      const messageId = (data as unknown as { turn?: { meta?: { apiMessageId?: string } } }).turn
        ?.meta?.apiMessageId
      if (messageId) store.clearPreview(messageId)
    }
    if (kind === 'result') store.clearPreviewsForSession(workspaceId, sessionId)
  }
  if (kind === 'error' && typeof data.content === 'string') {
    store.setError(workspaceId, sessionId, data.content)
    if (data.terminal !== false) {
      store.setActivity(workspaceId, sessionId, 'idle')
      store.clearPreviewsForSession(workspaceId, sessionId)
    }
  }
  if (kind === 'stopped') {
    store.setActivity(workspaceId, sessionId, 'idle')
    store.clearPreviewsForSession(workspaceId, sessionId)
  }
}

function patchView(
  queryClient: QueryClient | null,
  workspaceId: string,
  sessionId: string,
  event: StreamEvent
) {
  if (!queryClient) return
  bufferSessionEvent(queryClient, workspaceId, sessionId, event)
  const queryKey = workspaceKeys.events(workspaceId, sessionId)
  const existing = queryClient.getQueryData<ViewState>(queryKey)
  if (existing === undefined) return
  queryClient.setQueryData<ViewState>(queryKey, applyEvent(existing, event))
}
