import { sendWorkspaceMessage } from './send-message'
import { IDENTITY_ICON_IDS } from '@/lib/identity-icons'
import { viewBuildDirectives } from '@/lib/view-build-directives'
import { viewTabId } from '@/lib/workspace-tabs'
import type { PendingView, WorkspaceEntry, WorkspaceTabId } from '@/lib/types'
import { harnessFor } from '../harness/registry'
import type { SendMessageInput } from '../harness/types'
import { ForkUnsupportedError, inheritedHistoryBoundary } from '../harness/fork'
import { updateWorkspaceState } from '../workspace-state'
import { saveSelectedSession, resolveRenamedSession, selectSessionForTab } from './selected'
import { setSessionTab, updateSessionEntry } from './store'
import { getSessionConfig, saveSessionConfig } from './config'
import {
  createPendingView,
  listPendingViews,
  patchPendingView,
  startViewBuild
} from './pending-views'

export class ViewStartupError extends Error {
  constructor(
    error: unknown,
    public sessionId?: string,
    public viewId?: string
  ) {
    super(error instanceof Error ? error.message : 'Couldn’t start view chat')
  }
}
type BuildSendOptions = Pick<
  SendMessageInput,
  'attachments' | 'optimisticId' | 'model' | 'effort' | 'speedMode' | 'stream'
>
export type SubmitViewInput = BuildSendOptions & { requirements: string; sessionId?: string }

async function attachSession(
  ws: WorkspaceEntry,
  tabId: WorkspaceTabId,
  sessionId: string,
  ifMatch?: string | null
) {
  await updateSessionEntry(ws, sessionId, { tabId: tabId === 'overview' ? undefined : tabId })
  await saveSelectedSession(ws, sessionId, tabId, ifMatch)
}
async function sendBuild(
  ws: WorkspaceEntry,
  view: PendingView,
  sessionId: string,
  isNew: boolean,
  options: BuildSendOptions
) {
  await sendWorkspaceMessage(ws, {
    ...options,
    workspaceId: ws.id,
    workspacePath: ws.path,
    agentId: ws.agentId,
    sessionId,
    isNew,
    viewBuildId: view.id,
    content: view.requirements
  })
  await patchPendingView(ws, view.id, { status: 'submitted' }, 'starting')
}
async function failStartup(
  ws: WorkspaceEntry,
  error: unknown,
  sessionId?: string,
  view?: PendingView
): Promise<never> {
  if (view)
    await patchPendingView(
      ws,
      view.id,
      {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Couldn’t start view chat'
      },
      'starting'
    )
  throw new ViewStartupError(
    error,
    sessionId ? resolveRenamedSession(ws.id, sessionId) : undefined,
    view?.id
  )
}

export async function submitView(ws: WorkspaceEntry, viewId: string, input: SubmitViewInput) {
  const tabId = viewTabId(viewId)
  // The build, the chat's tab and the tab's selection start in one write. A
  // pinned chat takes the build and keeps its own tab.
  const { view, sessionId, pinned } = await updateWorkspaceState(ws, state => {
    const pinned = state.pinnedSessionId
    const sessionId = pinned ?? input.sessionId ?? crypto.randomUUID()
    const view = startViewBuild(
      state,
      viewId,
      input.requirements,
      sessionId,
      !!input.attachments?.length
    )
    if (!pinned) {
      setSessionTab(state, sessionId, tabId)
      selectSessionForTab(state, ws.id, sessionId, tabId)
    }
    return { view, sessionId, pinned }
  })
  try {
    await sendBuild(ws, view, sessionId, !pinned, input)
  } catch (error) {
    return failStartup(ws, error, sessionId, view)
  }
  return { viewId, sessionId: resolveRenamedSession(ws.id, sessionId) }
}
export async function createViewFromSession(
  ws: WorkspaceEntry,
  fromSessionId: string | undefined,
  requirements: string
) {
  if (!requirements.trim()) throw new Error('View requirements are required')
  if (fromSessionId === undefined) {
    const view = await createPendingView(ws, {
      requirements: requirements.trim(),
      status: 'submitted'
    })
    return {
      viewId: view.id,
      mode: 'in-place' as const,
      buildInstructions: viewBuildDirectives(view.id, IDENTITY_ICON_IDS)
    }
  }
  if (!fromSessionId) throw new Error('Session id cannot be empty')
  fromSessionId = resolveRenamedSession(ws.id, fromSessionId)
  const harness = harnessFor(ws)
  if (
    !(await harness.listSessions(ws)).some(session => session.sessionId === fromSessionId) &&
    !harness
      .activeSessions()
      .some(session => session.workspaceId === ws.id && session.sessionId === fromSessionId)
  )
    throw new Error('Source chat not found')
  let sessionId: string | undefined
  let view: PendingView | undefined
  try {
    const sourceConfig = await getSessionConfig(ws, fromSessionId)
    try {
      sessionId = await harness.forkSession?.(ws, fromSessionId, sourceConfig)
    } catch (error) {
      if (!(error instanceof ForkUnsupportedError)) throw error
    }
    const isNew = !sessionId
    sessionId ??= crypto.randomUUID()
    if (!isNew) {
      await updateSessionEntry(ws, sessionId, { fork: { fromSessionId } })
      // The fork API returns only a child ID. A failed history read leaves the
      // child usable and its full transcript visible.
      const history = await harness.sessionEvents(ws, sessionId).catch(() => undefined)
      if (history)
        await updateSessionEntry(ws, sessionId, {
          fork: { fromSessionId, ...inheritedHistoryBoundary(history) }
        })
    }
    const config = await saveSessionConfig(ws, sessionId, sourceConfig)
    view = await createPendingView(ws, {
      status: 'starting',
      requirements: requirements.trim(),
      buildSessionId: sessionId
    })
    await attachSession(ws, viewTabId(view.id), sessionId)
    await sendBuild(ws, view, sessionId, isNew, config)
    return {
      viewId: view.id,
      mode: 'handoff' as const,
      sessionId: resolveRenamedSession(ws.id, sessionId)
    }
  } catch (error) {
    return failStartup(ws, error, sessionId, view)
  }
}
export async function failInterruptedViewStarts(ws: WorkspaceEntry) {
  for (const view of await listPendingViews(ws)) {
    if (view.status === 'starting')
      await patchPendingView(
        ws,
        view.id,
        {
          status: 'failed',
          error:
            'View chat startup was interrupted. Check the chat before continuing; it has not been retried.'
        },
        'starting'
      )
  }
}
