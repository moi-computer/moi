import { parse } from 'regexparam'
import {
  parseRemoteWorkspaceAddress,
  parseRemoteWorkspaceTarget,
  workspaceAddress,
  type RemoteWorkspaceTarget
} from '@/lib/workspace-config'

// Every Cloud request the CLI may make: its methods, the pattern that allows
// it, and the function callers use to write its path. The CLI checks a request
// against this table before sending, and the running server checks it again
// before lending its login to a caller (broker.ts).
//
// `api/…` is sent relative to the Cloud URL; `/api/workspaces/…` goes to the
// owner's workspace API at its origin. Sign-in itself (login, token refresh,
// logout, agent join) uses fixed URLs in client.ts and never comes through here.

type Access = 'any login' | 'own login'
type Workspace = RemoteWorkspaceTarget

const refused = () => new Error('This Cloud request is not allowed')

function route<Args extends unknown[]>(
  methods: string,
  pattern: string,
  path: (...args: Args) => string,
  /** 'own login' requests are never sent with a login lent by the server. */
  access: Access = 'any login'
) {
  const [pathname = '', query = ''] = pattern.split('?')
  return { methods: methods.split(' '), ...parse(pathname), pathname, query, path, access }
}

const address = (workspace: Workspace) => {
  const { workspace_id, user_id } = parseRemoteWorkspaceTarget(workspace)
  return workspaceAddress(workspace_id, user_id)
}
const cloud = (workspace: Workspace) => `api/workspaces/${address(workspace)}`
const owner = (workspace: Workspace) => `/api/workspaces/${address(workspace)}`
// A file path relative to the workspace root, one encoded segment per name.
function encodePath(file: string) {
  const names = file.split('/')
  if (names.some(name => !name || name === '.' || name === '..' || name.includes('\\')))
    throw new Error('Use a file path relative to the remote workspace')
  return names.map(encodeURIComponent).join('/')
}

const CLOUD = 'api/workspaces/:workspace'
const OWNER = '/api/workspaces/:workspace'

export const cloudRoutes = {
  // Account
  me: route('GET', 'api/me', () => 'api/me'),
  sharedWorkspaces: route('GET', 'api/workspaces/shared', () => 'api/workspaces/shared'),
  invitations: route('GET', 'api/workspaces/invitations', () => 'api/workspaces/invitations'),
  // Changes to the account itself stay with whoever holds the login.
  renameAgent: route('PATCH', 'api/me', () => 'api/me', 'own login'),
  acceptInvitation: route(
    'POST',
    'api/invitations/:id/accept',
    (id: string) => `api/invitations/${encodePath(id)}/accept`,
    'own login'
  ),
  leave: route('POST', `${CLOUD}/leave`, (w: Workspace) => `${cloud(w)}/leave`, 'own login'),
  // Operations on the owner's machine
  exec: route('POST', `${CLOUD}/ops/exec`, (w: Workspace) => `${cloud(w)}/ops/exec`),
  commands: route('POST', `${CLOUD}/ops/commands`, (w: Workspace) => `${cloud(w)}/ops/commands`),
  files: route(
    'GET PUT PATCH',
    `${CLOUD}/ops/files/*`,
    (w: Workspace, file: string) => `${cloud(w)}/ops/files/${encodePath(file)}`
  ),
  // Owner's workspace API
  views: route(
    'GET',
    `${OWNER}/views?includePending=true`,
    (w: Workspace) => `${owner(w)}/views?includePending=true`
  ),
  compiledViews: route('GET', `${OWNER}/views`, (w: Workspace) => `${owner(w)}/views`),
  config: route('GET PUT', `${OWNER}/config`, (w: Workspace) => `${owner(w)}/config`),
  icon: route('PUT DELETE', `${OWNER}/icon`, (w: Workspace) => `${owner(w)}/icon`),
  scratchpad: route('GET', `${OWNER}/scratchpad`, (w: Workspace) => `${owner(w)}/scratchpad`),
  scratchpadOps: route(
    'POST',
    `${OWNER}/scratchpad/ops`,
    (w: Workspace) => `${owner(w)}/scratchpad/ops`
  ),
  scratchpadAsset: route(
    'GET',
    `${OWNER}/scratchpad/assets/:name`,
    (w: Workspace, name: string) => `${owner(w)}/scratchpad/assets/${encodePath(name)}`
  )
}

// Spellings that make a path resolve somewhere other than where it reads:
// dot segments, empty segments, backslashes, and their encoded forms. None
// appears in a path built above.
const UNSAFE = /(^|\/)\.\.?(\/|\?|$)|\/\/|\\|%2e|%2f|%5c/i

export type AllowedCloudRequest = { workspace?: Workspace; access: Access }

/** Throws unless the request is listed; names the workspace it addresses, if any. */
export function allowedCloudRequest(method: string, path: string): AllowedCloudRequest {
  if (UNSAFE.test(path)) throw refused()
  const [pathname = '', query = ''] = path.split('?')
  for (const route of Object.values(cloudRoutes)) {
    if (!route.methods.includes(method.toUpperCase()) || route.query !== query) continue
    // regexparam ignores a leading slash, and here it says where the request goes.
    if (route.pathname.startsWith('/') !== pathname.startsWith('/')) continue
    const found = route.pattern.exec(pathname.replace(/^\/?/, '/'))
    if (!found) continue
    const workspace = found[route.keys.indexOf('workspace') + 1]
    if (!route.keys.includes('workspace')) return { access: route.access }
    try {
      return { access: route.access, workspace: parseRemoteWorkspaceAddress(workspace ?? '') }
    } catch {
      throw refused()
    }
  }
  throw refused()
}
