import type * as CollabApi from 'moi/collab'
import { ProfileAvatarGroupContainer } from './components/profile-avatar-group'
import { ProfileContainer } from './components/profile'
import { ProfileAvatarContainer } from './components/profile-avatar'
import { CursorsContainer } from './components/cursors'
import { PresenceFrameContainer } from './components/presence-frame'
import { PresenceGroupContainer } from './components/presence-group'
import { PresenceAvatarsContainer } from './components/presence-avatars'
import {
  useMe,
  usePeers,
  usePresence,
  usePublishPresence,
  useMember,
  useWorkspaceMembers
} from './presence/hooks'

export type AppletCollabApi = typeof CollabApi

// SDK components resolve collaboration data; host UI can import the plain components.
export const appletCollabApi = {
  Cursors: CursorsContainer,
  Profile: ProfileContainer,
  ProfileAvatar: ProfileAvatarContainer,
  ProfileAvatarGroup: ProfileAvatarGroupContainer,
  PresenceFrame: PresenceFrameContainer,
  PresenceAvatars: PresenceAvatarsContainer,
  PresenceGroup: PresenceGroupContainer,
  useMe,
  usePeers,
  useMember,
  useWorkspaceMembers,
  usePresence,
  usePublishPresence
} satisfies AppletCollabApi
