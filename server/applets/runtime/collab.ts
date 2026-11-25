// Browser-only runtime. State and React contexts belong to the host feature.
import { createElement } from 'react'
import type { JsonValue } from 'moi'
import type {
  CursorsProps,
  ProfileAvatarGroupProps,
  PresenceFrameProps,
  PresenceGroupProps,
  PresenceAvatarsProps,
  PresenceValue,
  ProfileProps,
  ProfileAvatarProps,
  UsePeersOptions,
  UseWorkspaceMembersOptions
} from 'moi/collab'
import type { AppletCollabApi } from '../../../client/features/collab/applet-api'

import { __getBridge } from './moi'

type Bridge = { readonly collab?: AppletCollabApi }

function empty(): never[] {
  return []
}
const nothing = () => null
const fallback = {
  useMe: () => undefined,
  useMember: () => undefined,
  usePeers: empty,
  useWorkspaceMembers: empty,
  usePresence<T extends JsonValue>(_channel: string): PresenceValue<T>[] {
    return []
  },
  usePublishPresence() {},
  Cursors: nothing,
  Profile: nothing,
  ProfileAvatar: nothing,
  ProfileAvatarGroup: nothing,
  PresenceFrame: nothing,
  PresenceGroup: nothing,
  PresenceAvatars: nothing
}
let warned = false
function api() {
  const collab = (__getBridge() as Bridge | null)?.collab
  if (collab) return collab
  if (!warned) {
    warned = true
    console.warn(
      '[moi/collab] Collaboration API is unavailable. Hooks return empty values and components render nothing.'
    )
  }
  return fallback
}

export function useMe() {
  return api().useMe()
}
export function usePeers(options?: UsePeersOptions) {
  return api().usePeers(options)
}
export function useMember(id: string) {
  return api().useMember(id)
}
export function useWorkspaceMembers(options?: UseWorkspaceMembersOptions) {
  return api().useWorkspaceMembers(options)
}
export function usePresence<T extends JsonValue>(channel: string) {
  return api().usePresence<T>(channel)
}
export function usePublishPresence<T extends JsonValue>(channel: string, value: T) {
  return api().usePublishPresence(channel, value)
}
export function Cursors(props: CursorsProps) {
  return createElement(api().Cursors, props)
}
export function Profile(props: ProfileProps) {
  return createElement(api().Profile, props)
}
export function ProfileAvatar(props: ProfileAvatarProps) {
  return createElement(api().ProfileAvatar, props)
}
export function ProfileAvatarGroup(props: ProfileAvatarGroupProps) {
  return createElement(api().ProfileAvatarGroup, props)
}
export function PresenceFrame(props: PresenceFrameProps) {
  return createElement(api().PresenceFrame, props)
}
export function PresenceGroup(props: PresenceGroupProps) {
  return createElement(api().PresenceGroup, props)
}
export function PresenceAvatars(props: PresenceAvatarsProps) {
  return createElement(api().PresenceAvatars, props)
}
