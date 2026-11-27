import { useDeleteApplet } from '@/client/features/applets/api'
import { useUiStore } from '@/client/store/ui'
import { draftSessionId, composerDraftKey } from '@/lib/session-drafts'
import { useQueryClient } from '@tanstack/react-query'

import {
  prepareOptimisticSend,
  moveChatDraft,
  finishComposerSend,
  attachmentsForSend,
  resolveChatRunOptions,
  startOptimisticSession
} from '@/client/features/chat/chat-send'
import {
  renameSelectedSessionInCache,
  usePinnedSession
} from '@/client/features/chat/sessions/use-selected-session'
import { getCachedWorkspaceState } from '@/client/features/workspace/workspace-state'
import { useWorkspaceHarness } from '@/client/features/workspace/api'
import { useWorkspaceLayoutCtx } from '@/client/features/workspace/workspace-layout-context'
import { useCreateView, useSaveViewDraft, useSubmitView } from '@/client/features/views/api'
import { recoverViewSubmission } from './view-submission'
import type { PendingView } from '@/lib/types'
import { viewTabId } from '@/lib/workspace-tabs'

export function useViewActions() {
  const queryClient = useQueryClient()
  const { workspaceId } = useWorkspaceLayoutCtx()
  const { pinnedSessionId } = usePinnedSession()
  const modelData = useWorkspaceHarness(workspaceId).data
  const createMutation = useCreateView(workspaceId)
  const saveMutation = useSaveViewDraft(workspaceId)
  const submitMutation = useSubmitView(workspaceId)
  const discardMutation = useDeleteApplet('view')

  const create = () => createMutation.mutateAsync()

  const save = (viewId: string, requirements: string) =>
    saveMutation.mutateAsync({ viewId, requirements })

  const submit = async (pendingView: PendingView, requirements: string) => {
    const text = requirements.trim()
    const draftId = pinnedSessionId ?? draftSessionId(viewTabId(pendingView.id))
    const sessionId = pinnedSessionId ?? crypto.randomUUID()
    const attachments = attachmentsForSend(workspaceId, draftId)
    if (!text && attachments.length === 0) return

    if (!pinnedSessionId)
      startOptimisticSession({
        queryClient,
        workspaceId,
        sessionId,
        text,
        filenames: attachments.map(attachment => attachment.label)
      })
    if (!pinnedSessionId) moveChatDraft(workspaceId, draftId, sessionId)
    const prepared = prepareOptimisticSend(
      { queryClient, workspaceId, sessionId, text },
      attachments
    )

    const state = getCachedWorkspaceState(queryClient, workspaceId)
    const config = state?.sessions[sessionId]?.config
    const defaults = state?.chatDefaults
    const { model, effort, speedMode, stream } = resolveChatRunOptions(
      modelData,
      config?.model ?? defaults?.model,
      config?.effort ?? defaults?.effort,
      config?.speedMode ?? defaults?.speedMode
    )

    try {
      const result = await submitMutation.mutateAsync({
        viewId: pendingView.id,
        sessionId,
        requirements: text,
        optimisticId: prepared.optimisticId,
        ...(attachments.length > 0
          ? {
              attachments: prepared.attachments
            }
          : {}),
        model,
        effort,
        speedMode,
        stream
      })
      moveChatDraft(workspaceId, sessionId, result.sessionId)
      renameSelectedSessionInCache(queryClient, workspaceId, sessionId, result.sessionId)
      finishComposerSend(workspaceId, attachments)
      const draftKey = composerDraftKey(workspaceId, result.sessionId)
      const ui = useUiStore.getState()
      if (ui.composerDrafts[draftKey]?.trim() === text) ui.setComposerDraft(draftKey, null)
    } catch (error) {
      await recoverViewSubmission(
        queryClient,
        workspaceId,
        pendingView.id,
        sessionId,
        text,
        !!pinnedSessionId
      )
      throw error
    }
  }

  const discard = (viewId: string) => discardMutation.mutateAsync(viewId)

  return {
    create,
    save,
    submit,
    discard
  }
}
