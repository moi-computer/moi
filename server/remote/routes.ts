import { inject, parse } from 'regexparam'
import {
  parseRemoteWorkspaceAddress,
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
// Patterns use regexparam syntax. A 'cloud' path is sent relative to the Cloud
// URL (`api/me`); an 'owner' path goes to the owner's workspace API at its
// origin (`/api/workspaces/…`). Sign-in itself (login, token refresh, logout,
// agent join) uses fixed URLs in client.ts and never comes through here.

type InWorkspace = { workspace: RemoteWorkspaceTarget }
type NoParams = Record<never, never>
type Root = 'cloud' | 'owner'
type Access = 'any login' | 'own login'

export type CloudRoute<P extends object = NoParams> = {
  methods: string[]
  /** 'own login' requests are never sent with a login lent by the server. */
  access: Access
  match: (path: string) => Record<string, string> | undefined
  /** The path to send, with each value encoded. */
  path: (...params: keyof P extends never ? [] : [P]) => string
}

// A name that is one path segment and cannot move the request elsewhere.
const safeName = (name: string) => !!name && name !== '.' && name !== '..' && !/[/\\]/.test(name)
const badPath = () => new Error('Use a file path relative to the remote workspace')

function route<P extends object = NoParams>(
  methods: string,
  root: Root,
  template: string,
  access: Access = 'any login'
): CloudRoute<P> {
  const [pathname = '', query] = template.split('?')
  const { keys, pattern } = parse(pathname)
  const suffix = query === undefined ? '' : '?' + query
  return {
    methods: methods.split(' '),
    access,
    match(path) {
      if (path.startsWith('/') !== (root === 'owner') || !path.endsWith(suffix)) return undefined
      const rest = path.slice(root === 'owner' ? 1 : 0, path.length - suffix.length)
      const found = rest.startsWith('/') ? null : pattern.exec('/' + rest)
      if (!found) return undefined
      const params: Record<string, string> = {}
      for (const [index, key] of keys.entries()) {
        let names: string[]
        try {
          names = (found[index + 1] ?? '').split('/').map(decodeURIComponent)
        } catch {
          return undefined // Not valid percent-encoding.
        }
        // A dot segment would resolve to a different, unlisted path once sent.
        if (!names.every(safeName)) return undefined
        params[key] = names.join('/')
      }
      return params
    },
    path(...[params]) {
      const { workspace, file, ...names } = (params ?? {}) as Partial<InWorkspace> & {
        file?: string
      } & Record<string, string>
      const segments = file?.split('/') ?? []
      if (![...segments, ...Object.values(names)].every(safeName)) throw badPath()
      const target = workspace && parseRemoteWorkspaceTarget(workspace)
      const built = inject(pathname, {
        ...Object.fromEntries(
          Object.entries(names).map(([key, value]) => [key, encodeURIComponent(value)])
        ),
        ...(file === undefined ? {} : { '*': segments.map(encodeURIComponent).join('/') }),
        ...(target ? { workspace: workspaceAddress(target.workspace_id, target.user_id) } : {})
      })
      return (root === 'owner' ? built : built.slice(1)) + suffix
    }
  }
}

const workspace = '/api/workspaces/:workspace'

export const cloudRoutes = {
  // Account
  me: route('GET', 'cloud', '/api/me'),
  sharedWorkspaces: route('GET', 'cloud', '/api/workspaces/shared'),
  invitations: route('GET', 'cloud', '/api/workspaces/invitations'),
  // Changes to the account itself stay with whoever holds the login.
  renameAgent: route('PATCH', 'cloud', '/api/me', 'own login'),
  acceptInvitation: route<{ id: string }>(
    'POST',
    'cloud',
    '/api/invitations/:id/accept',
    'own login'
  ),
  leave: route<InWorkspace>('POST', 'cloud', `${workspace}/leave`, 'own login'),
  // Operations on the owner's machine
  exec: route<InWorkspace>('POST', 'cloud', `${workspace}/ops/exec`),
  commands: route<InWorkspace>('POST', 'cloud', `${workspace}/ops/commands`),
  files: route<InWorkspace & { file: string }>(
    'GET PUT PATCH',
    'cloud',
    `${workspace}/ops/files/*`
  ),
  // Owner's workspace API
  views: route<InWorkspace>('GET', 'owner', `${workspace}/views?includePending=true`),
  config: route<InWorkspace>('GET PUT', 'owner', `${workspace}/config`),
  icon: route<InWorkspace>('PUT DELETE', 'owner', `${workspace}/icon`),
  scratchpad: route<InWorkspace>('GET', 'owner', `${workspace}/scratchpad`),
  scratchpadOps: route<InWorkspace>('POST', 'owner', `${workspace}/scratchpad/ops`),
  scratchpadAsset: route<InWorkspace & { name: string }>(
    'GET',
    'owner',
    `${workspace}/scratchpad/assets/:name`
  )
}

const refused = () => new Error('This Cloud request is not allowed')

export type AllowedCloudRequest = { workspace?: RemoteWorkspaceTarget; access: Access }

/** Throws unless the request is listed; names the workspace it addresses, if any. */
export function allowedCloudRequest(method: string, path: string): AllowedCloudRequest {
  const verb = method.toUpperCase()
  for (const { methods, access, match } of Object.values(cloudRoutes) as CloudRoute[]) {
    const params = methods.includes(verb) ? match(path) : undefined
    if (!params) continue
    const address = params.workspace
    if (address === undefined) return { access }
    try {
      return { access, workspace: parseRemoteWorkspaceAddress(address) }
    } catch {
      throw refused()
    }
  }
  throw refused()
}
