import { parseRemoteWorkspaceTarget, type RemoteWorkspaceTarget } from '@/lib/workspace-config'

// Every Cloud request the CLI may make, as an exact method and path shape.
// The CLI checks it before sending and the running server checks it again
// before lending its login to a caller (broker.ts), so a path that is not
// listed here never reaches Cloud with Moi's credentials.
//
// Paths are spelled the way the client sends them: `api/…` is relative to the
// Cloud URL, `/api/workspaces/…` is the owner's workspace API at its origin.
// Sign-in itself (login, token refresh, logout, agent join) uses fixed URLs in
// client.ts and never comes through here.

const ID = '[A-Za-z0-9_-]{1,240}'
const ADDRESS = '([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64})'
// One encodeURIComponent-encoded path segment.
const SEGMENT = "(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-Fa-f]{2})+"
const CLOUD_WORKSPACE = `api/workspaces/${ADDRESS}`
const WORKSPACE_API = `/api/workspaces/${ADDRESS}`

type Rule = { methods: string[]; path: RegExp; files?: true }
const rule = (methods: string, path: string, files?: true): Rule => ({
  methods: methods.split(' '),
  path: new RegExp(`^${path}$`),
  ...(files ? { files } : {})
})

const RULES: Rule[] = [
  // Account
  rule('GET PATCH', 'api/me'),
  rule('GET', 'api/workspaces/shared'),
  rule('GET', 'api/workspaces/invitations'),
  rule('POST', `api/invitations/${ID}/accept`),
  rule('POST', `${CLOUD_WORKSPACE}/leave`),
  // Operations on the owner's machine
  rule('POST', `${CLOUD_WORKSPACE}/ops/(?:exec|commands)`),
  rule('GET PUT PATCH', `${CLOUD_WORKSPACE}/ops/files/(${SEGMENT}(?:/${SEGMENT})*)`, true),
  // Owner's workspace API
  rule('GET', `${WORKSPACE_API}/views\\?includePending=true`),
  rule('GET PUT', `${WORKSPACE_API}/config`),
  rule('PUT DELETE', `${WORKSPACE_API}/icon`),
  rule('GET', `${WORKSPACE_API}/scratchpad`),
  rule('POST', `${WORKSPACE_API}/scratchpad/ops`),
  rule('GET', `${WORKSPACE_API}/scratchpad/assets/(${SEGMENT})`, true)
]

const refused = () => new Error('This Cloud request is not allowed')

function safeSegment(segment: string): boolean {
  try {
    const name = decodeURIComponent(segment)
    return name !== '.' && name !== '..' && !/[/\\]/.test(name)
  } catch {
    return false
  }
}

export type AllowedCloudRequest = { workspace?: RemoteWorkspaceTarget }

/** Throws unless the request is listed; names the workspace it addresses, if any. */
export function allowedCloudRequest(method: string, path: string): AllowedCloudRequest {
  const verb = method.toUpperCase()
  for (const { methods, path: pattern, files } of RULES) {
    const match = pattern.exec(path)
    if (!match || !methods.includes(verb)) continue
    if (files && !match[match.length - 1]!.split('/').every(safeSegment)) throw refused()
    if (match.length < 3) return {}
    try {
      return {
        workspace: parseRemoteWorkspaceTarget({
          user_id: match[1],
          workspace_id: match[2]
        })
      }
    } catch {
      throw refused()
    }
  }
  throw refused()
}
