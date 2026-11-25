// Public collab contract, reused internally and installed as `.moi/collab.d.ts`.
declare module 'moi/collab' {
  import type { ReactElement, ReactNode } from 'react'
  import type { JsonValue } from 'moi'

  export type ProfileColor =
    | 'pink'
    | 'orange'
    | 'amber'
    | 'lime'
    | 'emerald'
    | 'cyan'
    | 'blue'
    | 'violet'
  export type Profile = {
    id: string
    type: 'user' | 'agent'
    // Person who owns this agent, when supplied by the cloud.
    ownerId?: string
    color: ProfileColor
    name?: string
    email?: string
    avatar?: string
  }
  export type ConnectionStatus = 'active' | 'away'
  export type MemberStatus = ConnectionStatus | 'offline'
  export type MemberProfile = Profile & { status: MemberStatus }
  export type UsePeersOptions = { scope?: 'page' | 'workspace'; status?: ConnectionStatus }
  export type UseWorkspaceMembersOptions = { status?: MemberStatus }

  // Peers are other connected members, counted once across tabs.
  export function useMe(): MemberProfile | undefined
  export function useMember(id: string): MemberProfile | undefined
  export function usePeers(options?: UsePeersOptions): MemberProfile[]
  // Full workspace directory, including yourself and offline members.
  export function useWorkspaceMembers(options?: UseWorkspaceMembersOptions): MemberProfile[]

  export type PresenceValue<T> = { connectionId: string; identityId: string; value: T }
  // Reading never registers or publishes presence. Values belong to connections.
  export function usePresence<T extends JsonValue>(channel: string): PresenceValue<T>[]
  // Publishes the current value reactively, releasing it on hide or unmount.
  export function usePublishPresence<T extends JsonValue>(channel: string, value: T): void

  // Identifies a cursor area within the applet; defaults to 'default'.
  export type CursorsProps = { id?: string; children: ReactNode; className?: string }
  export function Cursors(props: CursorsProps): ReactElement

  // Stable local IDs compose with enclosing PresenceGroup IDs across browsers.
  // Without present, each wrapper tracks focus anywhere inside its children.
  // With present, publication is controlled; false clears your presence, not peers.
  export type PresenceFrameProps = {
    id: string
    present?: boolean
    // Name badge alignment above the frame. Defaults to 'end'.
    align?: 'start' | 'end'
    children: ReactNode
    className?: string
  }
  export function PresenceFrame(props: PresenceFrameProps): ReactElement
  export type PresenceAvatarsProps = Omit<PresenceFrameProps, 'align'> & {
    // Vertical alignment in the left gutter. Defaults to 'center'.
    align?: 'start' | 'center' | 'end'
  }
  export function PresenceAvatars(props: PresenceAvatarsProps): ReactElement
  // Adds a namespace and a local gutter animation group; no DOM or publication.
  export type PresenceGroupProps = { id: string; children: ReactNode }
  export function PresenceGroup(props: PresenceGroupProps): ReactElement
  export type ProfileAvatarProps = {
    id: string
    size?: 'xs' | 'sm' | 'default' | 'lg'
    // Show a status dot when active. Defaults to false.
    showStatusBadge?: boolean
    className?: string
  }
  export function ProfileAvatar(props: ProfileAvatarProps): ReactElement
  export type ProfileProps = Pick<ProfileAvatarProps, 'id' | 'showStatusBadge' | 'className'> & {
    size?: 'xs' | 'sm' | 'default'
    // Show a "(You)" label beside the current member’s name. Defaults to false.
    showYouLabel?: boolean
    // Secondary text alongside or below the name.
    description?: ReactNode
  }
  export function Profile(props: ProfileProps): ReactElement
  export type ProfileAvatarGroupProps = {
    ids: readonly string[]
    max?: number
    size?: ProfileAvatarProps['size']
    className?: string
  }
  export function ProfileAvatarGroup(props: ProfileAvatarGroupProps): ReactElement
}
