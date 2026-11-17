import { HarnessTransitionError, reserveWorkspaceOperation } from '../workspaces/harness-transition'
import { IDENTITY_ICON_IDS } from '@/lib/identity-icons'
import { viewBuildDirectives } from '@/lib/view-build-directives'
import { viewIdFromTab } from '@/lib/workspace-tabs'
import type { WorkspaceEntry } from '@/lib/types'
import { getCollabReferencePath } from '../collab/config'
import { harnessFor } from '../harness/registry'
import type { SendMessageInput } from '../harness/types'
import { getPinnedSession, saveSelectedSession, resolveRenamedSession } from './selected'
import { getSessionEntry, updateSessionEntry } from './store'
import {
  getPendingView,
  listPendingViews,
  patchPendingView,
  PendingViewError
} from './pending-views'

// Both ordinary chat and initial build requests use this boundary.
export async function sendWorkspaceMessage(
  ws: WorkspaceEntry,
  input: SendMessageInput & { viewBuildId?: string }
) {
  const release = reserveWorkspaceOperation(ws.id)
  try {
    const { getWorkspace } = await import('../workspaces/registry')
    const current = await getWorkspace(ws.id)
    if (current && (current.harness ?? 'claude-code') !== (ws.harness ?? 'claude-code'))
      throw new HarnessTransitionError('Agent changed. Start a new chat')
    const { prepareWorkspaceHarness } = await import('../workspaces/change-harness')
    await prepareWorkspaceHarness(ws)
    const { viewBuildId, ...message } = input
    const sessionId = resolveRenamedSession(ws.id, input.sessionId)
    const record = await getSessionEntry(ws, sessionId)
    const tabId = input.context?.activeTab?.id ?? record.tabId ?? 'overview'
    const targetViewId = viewBuildId ?? (input.isNew ? viewIdFromTab(tabId) : undefined)
    const ownedViews = targetViewId
      ? []
      : (await listPendingViews(ws)).filter(view => view.buildSessionId === sessionId)
    const pending = targetViewId
      ? await getPendingView(ws, targetViewId)
      : (ownedViews.find(view => view.id === viewIdFromTab(tabId)) ?? ownedViews[0])
    const isBuildRequest = pending && (viewBuildId === pending.id || input.isNew)
    if (
      isBuildRequest &&
      pending.buildSessionId &&
      pending.buildSessionId !== sessionId &&
      (pending.status === 'starting' ||
        harnessFor(ws)
          .activeSessions()
          .some(
            session => session.workspaceId === ws.id && session.sessionId === pending.buildSessionId
          ))
    )
      throw new PendingViewError('This view is already being built in another chat', 409)
    if (input.isNew && record.tabId !== tabId) {
      record.tabId = tabId === 'overview' ? undefined : tabId
      await updateSessionEntry(ws, sessionId, { tabId: record.tabId })
      await saveSelectedSession(ws, sessionId, tabId, null)
    }
    if (isBuildRequest)
      await patchPendingView(ws, pending.id, {
        buildSessionId: sessionId
      })
    const collabReference = await getCollabReferencePath(ws.path, ws.harness)
    const pinnedSessionId = await getPinnedSession(ws)
    await harnessFor(ws).sendMessage({
      ...message,
      sessionId,
      context: {
        ...input.context,
        // Resolve here for both browser messages and programmatic view builds;
        // the agent must not infer file location from its local working directory.
        workspaceMode: ws.remote ? 'remote' : 'local',
        session: {
          id: sessionId,
          tabId: record.tabId,
          pinned: pinnedSessionId === sessionId
        },
        ...(collabReference ? { collabReference } : {}),
        directives: [
          ...(input.context?.directives ?? []),
          ...(isBuildRequest ? viewBuildDirectives(pending.id, IDENTITY_ICON_IDS) : []),
          ...(isBuildRequest && record.fork
            ? [
                'Inherited conversation is background. Work on the current request; do not resume unrelated earlier tasks.'
              ]
            : []),
          ...(pending && input.isNew && pending.requirements !== input.content
            ? [`Original view requirements:\n${pending.requirements}`]
            : []),
          ...(pending && input.attachments?.length
            ? ['Use the attachments as reference material for the intended view.']
            : [])
        ]
      }
    })
    if (pending && pending.status !== 'starting')
      await patchPendingView(ws, pending.id, { status: 'submitted', error: undefined })
  } finally {
    release()
  }
}
