import { customAlphabet } from 'nanoid'

export const agentClientPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const agentProfilePrefix = 'agent:'
export const agentProfileId = (id: string) => agentProfilePrefix + id
export const isAgentProfileId = (id: string) => id.startsWith(agentProfilePrefix)

// Short, shell- and URL-safe ids: base36 (0-9a-z), no dashes — so an id never
// looks like a CLI flag or reads oddly in a URL.
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

// Workspace ids live in `/workspace/<id>` URLs and persist for the workspace's
// whole life. 10 chars (~52 bits) stays collision-free at any realistic count.
export const newWorkspaceId = customAlphabet(ALPHABET, 10)

// Literal collection routes take precedence over workspace IDs.
export const RESERVED_WORKSPACE_IDS = ['create', 'order', 'previews', 'suggestions', 'trash']

// Ids may also be chosen by hand (`moi init --id <id>`), so they are validated
// rather than assumed. Slightly wider than the generated alphabet — dashes and
// underscores read well in a URL — but never leading with a dash, so an id
// cannot be mistaken for a CLI flag.
export function validateWorkspaceId(id: string): string | null {
  if (!id) return 'Workspace id is required'
  if (id.length > 64) return 'Workspace id is too long (max 64 characters)'
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    return 'Use letters, numbers, dashes and underscores, starting with a letter or number'
  }
  // Case-insensitive: only the exact-case spelling collides with a route, but
  // accepting `Create` while refusing `create` reads as a bug, not a rule.
  if (RESERVED_WORKSPACE_IDS.includes(id.toLowerCase())) {
    return `Workspace id ${id} is reserved (${RESERVED_WORKSPACE_IDS.join(', ')})`
  }
  return null
}

// A view keeps this ID from its pending tab through its compiled file.
export const newViewId = customAlphabet(ALPHABET, 6)
