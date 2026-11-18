import type { CollabServerMessage } from '@/lib/collab/types'
import { agentProfileId } from '@/lib/ids'
import { publishWorkspacePresence } from '../events'

const minute = 60_000
type Activity = { minutesAgo: number; timer: ReturnType<typeof setInterval> }
const workspaces = new Map<string, Map<string, Activity>>()

export function agentActivitySnapshot(workspaceId: string) {
  const minutesAgo: Record<string, number> = {}
  for (const [id, activity] of workspaces.get(workspaceId) ?? []) {
    minutesAgo[agentProfileId(id)] = activity.minutesAgo
  }
  return { type: 'agent-activity:changed', minutesAgo } satisfies CollabServerMessage
}

export function recordAgentActivity(workspaceId: string, agentId: string) {
  const agents = workspaces.get(workspaceId) ?? new Map<string, Activity>()
  const previous = agents.get(agentId)
  clearInterval(previous?.timer)
  const lastActive = Date.now()
  const timer = setInterval(() => {
    const minutesAgo = Math.floor((Date.now() - lastActive) / minute)
    if (minutesAgo >= 5) {
      clearInterval(timer)
      agents.delete(agentId)
      if (!agents.size) workspaces.delete(workspaceId)
    } else {
      agents.set(agentId, { minutesAgo, timer })
    }
    publishWorkspacePresence(workspaceId, agentActivitySnapshot(workspaceId))
  }, minute).unref()
  agents.set(agentId, { minutesAgo: 0, timer })
  workspaces.set(workspaceId, agents)
  if (previous?.minutesAgo !== 0)
    publishWorkspacePresence(workspaceId, agentActivitySnapshot(workspaceId))
}

// Batiok overwrites this header on the managed gateway. Agent IDs are a_ + a JWK thumbprint.
export function recordGatewayActivity(workspaceId: string, request: Request) {
  const actor = request.headers.get('x-moi-user-id')
  if (actor && /^a_[A-Za-z0-9_-]{43}$/.test(actor)) recordAgentActivity(workspaceId, actor)
}
