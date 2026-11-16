import { isSpeedMode } from '@/lib/speed-mode'
import type { SessionConfig } from '@/lib/types'
import { updateWorkspaceState, type WorkspaceRef } from '../workspace-state'
import { getSessionEntry } from './store'

// null clears a setting; undefined leaves it unchanged.
export type SessionConfigPatch = {
  model?: string | null
  effort?: string | null
  speedMode?: SessionConfig['speedMode'] | null
}

export async function getSessionConfig(
  ws: WorkspaceRef,
  sessionId: string
): Promise<SessionConfig> {
  return (await getSessionEntry(ws, sessionId)).config ?? {}
}

export async function hasSessionConfig(ws: WorkspaceRef, sessionId: string): Promise<boolean> {
  return Object.keys(await getSessionConfig(ws, sessionId)).length > 0
}

// Without a session id, update the personal defaults used by new chats.
export async function saveSessionConfig(
  ws: WorkspaceRef,
  sessionId: string | undefined,
  patch: SessionConfigPatch
): Promise<SessionConfig> {
  return updateWorkspaceState(ws, state => {
    const session = sessionId ? (state.sessions[sessionId] ??= {}) : undefined
    const config: SessionConfig = { ...(session ? session.config : state.chatDefaults) }
    for (const key of ['model', 'effort', 'speedMode'] as const) {
      if (patch[key] === null) delete config[key]
    }
    if (typeof patch.model === 'string') config.model = patch.model
    if (typeof patch.effort === 'string') config.effort = patch.effort
    if (isSpeedMode(patch.speedMode)) config.speedMode = patch.speedMode
    if (session) {
      if (Object.keys(config).length) session.config = config
      else delete session.config
    } else state.chatDefaults = config
    return config
  })
}
