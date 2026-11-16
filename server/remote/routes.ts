import {
  parseRemoteWorkspaceTarget,
  workspaceAddress,
  type RemoteWorkspaceTarget
} from '@/lib/workspace-config'

// Every Cloud request the CLI may make. Callers build their paths from this
// table and the allowlist is read from the same entries, so a request that is
// not listed here can be neither written nor sent. The CLI checks it before
// sending and the running server checks it again before lending its login to
// a caller (broker.ts).
//
// `api/…` is relative to the Cloud URL; `/api/workspaces/…` is the owner's
// workspace API at its origin. Sign-in itself (login, token refresh, logout,
// agent join) uses fixed URLs in client.ts and never comes through here.

// One encodeURIComponent-encoded path segment.
const SEGMENT = "(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-Fa-f]{2})+"
const PLACEHOLDERS = {
  id: '[A-Za-z0-9_-]{1,240}',
  workspace: '(?<owner>[A-Za-z0-9_-]{1,64}):(?<workspace>[A-Za-z0-9_-]{1,64})',
  // A file path relative to the workspace root.
  file: `(?<file>${SEGMENT}(?:/${SEGMENT})*)`,
  name: `(?<file>${SEGMENT})`
}
type Placeholder = keyof typeof PLACEHOLDERS

type Names<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Names<Rest>
  : never
type Params<T extends string> = {
  [Name in Names<T>]: Name extends 'workspace' ? RemoteWorkspaceTarget : string
}
export type CloudRoute<T extends string = string> = {
  methods: string[]
  pattern: RegExp
  /** The path to send, with each value checked and encoded. */
  path: (...params: Names<T> extends never ? [] : [Params<T>]) => string
}

const safeName = (name: string) => !!name && name !== '.' && name !== '..' && !/[/\\]/.test(name)

function encode(kind: Placeholder, value: unknown): string {
  if (kind === 'workspace') {
    const target = parseRemoteWorkspaceTarget(value)
    return workspaceAddress(target.workspace_id, target.user_id)
  }
  if (typeof value !== 'string') throw new Error('Invalid Cloud request')
  if (kind === 'id') {
    if (!new RegExp(`^${PLACEHOLDERS.id}$`).test(value)) throw new Error('Invalid invitation ID')
    return value
  }
  const names = kind === 'file' ? value.split('/') : [value]
  if (!names.every(safeName)) throw new Error('Use a file path relative to the remote workspace')
  return names.map(encodeURIComponent).join('/')
}

function route<const T extends string>(methods: string, template: T): CloudRoute<T> {
  const parts = template.split(/\{(\w+)\}/)
  return {
    methods: methods.split(' '),
    pattern: new RegExp(
      '^' +
        parts
          .map((part, index) =>
            index % 2
              ? PLACEHOLDERS[part as Placeholder]
              : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          )
          .join('') +
        '$'
    ),
    path: (...params) =>
      parts
        .map((part, index) =>
          index % 2
            ? encode(part as Placeholder, (params[0] as Record<string, unknown>)[part])
            : part
        )
        .join('')
  }
}

export const cloudRoutes = {
  // Account
  me: route('GET PATCH', 'api/me'),
  sharedWorkspaces: route('GET', 'api/workspaces/shared'),
  invitations: route('GET', 'api/workspaces/invitations'),
  acceptInvitation: route('POST', 'api/invitations/{id}/accept'),
  leave: route('POST', 'api/workspaces/{workspace}/leave'),
  // Operations on the owner's machine
  exec: route('POST', 'api/workspaces/{workspace}/ops/exec'),
  commands: route('POST', 'api/workspaces/{workspace}/ops/commands'),
  files: route('GET PUT PATCH', 'api/workspaces/{workspace}/ops/files/{file}'),
  // Owner's workspace API
  views: route('GET', '/api/workspaces/{workspace}/views?includePending=true'),
  config: route('GET PUT', '/api/workspaces/{workspace}/config'),
  icon: route('PUT DELETE', '/api/workspaces/{workspace}/icon'),
  scratchpad: route('GET', '/api/workspaces/{workspace}/scratchpad'),
  scratchpadOps: route('POST', '/api/workspaces/{workspace}/scratchpad/ops'),
  scratchpadAsset: route('GET', '/api/workspaces/{workspace}/scratchpad/assets/{name}')
}

const refused = () => new Error('This Cloud request is not allowed')

function safeSegment(segment: string): boolean {
  try {
    return safeName(decodeURIComponent(segment))
  } catch {
    return false
  }
}

export type AllowedCloudRequest = { workspace?: RemoteWorkspaceTarget }

/** Throws unless the request is listed; names the workspace it addresses, if any. */
export function allowedCloudRequest(method: string, path: string): AllowedCloudRequest {
  const verb = method.toUpperCase()
  for (const { methods, pattern } of Object.values(cloudRoutes) as CloudRoute[]) {
    const match = methods.includes(verb) ? pattern.exec(path) : null
    if (!match) continue
    const groups = match.groups ?? {}
    if (groups.file !== undefined && !groups.file.split('/').every(safeSegment)) throw refused()
    if (groups.owner === undefined) return {}
    try {
      return {
        workspace: parseRemoteWorkspaceTarget({
          user_id: groups.owner,
          workspace_id: groups.workspace
        })
      }
    } catch {
      throw refused()
    }
  }
  throw refused()
}
