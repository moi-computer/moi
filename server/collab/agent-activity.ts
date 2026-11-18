import type { CollabServerMessage } from '@/lib/collab/types'
import { agentProfileId } from '@/lib/ids'
import { publishWorkspacePresence } from '../events'

type AgentTimers = Map<string, ReturnType<typeof setTimeout>>
const workspaces = new Map<string, AgentTimers>()

export function agentActivitySnapshot(workspaceId: string) {
  const agentIds = Array.from(workspaces.get(workspaceId)?.keys() ?? [], agentProfileId)
  return { type: 'agent-activity:changed', agentIds } satisfies CollabServerMessage
}

export function recordAgentActivity(workspaceId: string, agentId: string) {
  const agents = workspaces.get(workspaceId) ?? new Map<string, ReturnType<typeof setTimeout>>()
  const previous = agents.get(agentId)
  clearTimeout(previous)
  const timer = setTimeout(() => {
    agents.delete(agentId)
    if (!agents.size) workspaces.delete(workspaceId)
    publishWorkspacePresence(workspaceId, agentActivitySnapshot(workspaceId))
  }, 60_000).unref()
  agents.set(agentId, timer)
  workspaces.set(workspaceId, agents)
  if (!previous) publishWorkspacePresence(workspaceId, agentActivitySnapshot(workspaceId))
}

// Batiok overwrites this header on the managed gateway. Agent IDs are a_ + a JWK thumbprint.
export function recordGatewayActivity(workspaceId: string, request: Request) {
  const actor = request.headers.get('x-moi-user-id')
  if (actor && /^a_[A-Za-z0-9_-]{43}$/.test(actor)) recordAgentActivity(workspaceId, actor)
}
