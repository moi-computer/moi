import { compile, match } from 'path-to-regexp'
import { parseRemoteWorkspaceTarget, type RemoteWorkspaceTarget } from '@/lib/workspace-config'

// Every Cloud request the CLI may make. Callers build their paths from this
// table and the allowlist is read from the same entries, so a request that is
// not listed here can be neither written nor sent. The CLI checks it before
// sending and the running server checks it again before lending its login to
// a caller (broker.ts).
//
// Paths use path-to-regexp syntax. `api/…` is relative to the Cloud URL;
// `/api/workspaces/…` is the owner's workspace API at its origin. Sign-in
// itself (login, token refresh, logout, agent join) uses fixed URLs in
// client.ts and never comes through here.

type InWorkspace = { workspace: RemoteWorkspaceTarget }
type NoParams = Record<never, never>
type Access = 'any login' | 'own login'

export type CloudRoute<P extends object = NoParams> = {
  methods: string[]
  /** 'own login' requests are never sent with a login lent by the server. */
  access: Access
  match: (path: string) => Record<string, string | string[] | undefined> | undefined
  /** The path to send, with each value encoded. */
  path: (...params: keyof P extends never ? [] : [P]) => string
}

// A name that is one path segment and cannot move the request elsewhere.
const safeName = (name: string) => !!name && name !== '.' && name !== '..' && !/[/\\]/.test(name)

function route<P extends object = NoParams>(
  methods: string,
  template: string,
  access: Access = 'any login'
): CloudRoute<P> {
  const matcher = match(template, { sensitive: true, trailing: false })
  const build = compile(template)
  return {
    methods: methods.split(' '),
    access,
    match(path) {
      try {
        const found = matcher(path)
        return found ? found.params : undefined
      } catch {
        return undefined // Not valid percent-encoding.
      }
    },
    path(...[params]) {
      const { workspace, file, ...rest } = (params ?? {}) as Partial<InWorkspace> & {
        file?: string
      } & Record<string, string>
      const names = file?.split('/')
      if (![...(names ?? []), ...Object.values(rest)].every(safeName))
        throw new Error('Use a file path relative to the remote workspace')
      const target = workspace && parseRemoteWorkspaceTarget(workspace)
      return build({
        ...rest,
        ...(names ? { file: names } : {}),
        ...(target ? { owner: target.user_id, workspace: target.workspace_id } : {})
      })
    }
  }
}

const cloud = 'api/workspaces/:owner\\::workspace'
const owner = '/api/workspaces/:owner\\::workspace'

export const cloudRoutes = {
  // Account
  me: route('GET', 'api/me'),
  sharedWorkspaces: route('GET', 'api/workspaces/shared'),
  invitations: route('GET', 'api/workspaces/invitations'),
  // Changes to the account itself stay with whoever holds the login.
  renameAgent: route('PATCH', 'api/me', 'own login'),
  acceptInvitation: route<{ id: string }>('POST', 'api/invitations/:id/accept', 'own login'),
  leave: route<InWorkspace>('POST', `${cloud}/leave`, 'own login'),
  // Operations on the owner's machine
  exec: route<InWorkspace>('POST', `${cloud}/ops/exec`),
  commands: route<InWorkspace>('POST', `${cloud}/ops/commands`),
  files: route<InWorkspace & { file: string }>('GET PUT PATCH', `${cloud}/ops/files/*file`),
  // Owner's workspace API
  views: route<InWorkspace>('GET', `${owner}/views\\?includePending=true`),
  config: route<InWorkspace>('GET PUT', `${owner}/config`),
  icon: route<InWorkspace>('PUT DELETE', `${owner}/icon`),
  scratchpad: route<InWorkspace>('GET', `${owner}/scratchpad`),
  scratchpadOps: route<InWorkspace>('POST', `${owner}/scratchpad/ops`),
  scratchpadAsset: route<InWorkspace & { name: string }>('GET', `${owner}/scratchpad/assets/:name`)
}

const refused = () => new Error('This Cloud request is not allowed')

export type AllowedCloudRequest = { workspace?: RemoteWorkspaceTarget; access: Access }

/** Throws unless the request is listed; names the workspace it addresses, if any. */
export function allowedCloudRequest(method: string, path: string): AllowedCloudRequest {
  const verb = method.toUpperCase()
  for (const { methods, access, match } of Object.values(cloudRoutes) as CloudRoute[]) {
    const params = methods.includes(verb) ? match(path) : undefined
    if (!params) continue
    // A dot segment would resolve to a different, unlisted path once sent.
    if (
      !Object.values(params)
        .flat()
        .every(name => name !== undefined && safeName(name))
    )
      throw refused()
    if (params.owner === undefined) return { access }
    try {
      return {
        access,
        workspace: parseRemoteWorkspaceTarget({
          user_id: params.owner,
          workspace_id: params.workspace
        })
      }
    } catch {
      throw refused()
    }
  }
  throw refused()
}
