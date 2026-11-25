import type { JsonValue } from 'moi'
import type { ConnectionStatus, Profile } from 'moi/collab'

export type { ConnectionStatus, Profile } from 'moi/collab'

// An authenticating proxy in front of the deployment that moi trusts.
export type AuthProvider = 'cloudflare-access'

// Complete snapshot from GET /api/proxy-user. No provider means no proxy;
// a provider without a profile means no verified user.
export type ProxyUserState = {
  provider?: AuthProvider
  profile?: Profile
}

export type ConnectionLocation = { page: string; status: ConnectionStatus }

export type PresenceRegistration = {
  registrationId: string
  appletId: string
  channel: string
  value: JsonValue
}

export type Connection = {
  connectionId: string
  identityId: string
  location: ConnectionLocation | null
  presence: PresenceRegistration[]
}

export type CollabClientMessage =
  | { type: 'join'; version: 1; profile: Profile; location?: ConnectionLocation | null }
  | { type: 'profile'; profile: Profile }
  | { type: 'location'; location: ConnectionLocation | null }
  | ({ type: 'presence:set' } & PresenceRegistration)
  | { type: 'presence:delete'; registrationId: string }
  | { type: 'ping' }

export type CollabServerMessage =
  | { type: 'agent-activity:changed'; agentIds: string[] }
  | {
      type: 'welcome'
      version: 1
      connectionId: string
      connections: Connection[]
      // Profiles for connected identities only. The host owns
      // the full workspace directory, including offline members.
      profiles: Profile[]
    }
  | { type: 'connections'; connections: Connection[]; profiles: Profile[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' }
