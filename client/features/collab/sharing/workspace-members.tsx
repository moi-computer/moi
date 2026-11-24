import { useState } from 'react'
import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { Spinner } from '@/client/components/ui/spinner'
import { PopoverTitle } from '@/client/components/ui/popover'
import { toast } from '@/client/components/ui/toast'
import { cn } from '@/client/lib/cn'
import { colorForId } from '@/lib/collab/colors'
import { CloudApiError } from '../../account/api'
import { useIdentity } from '../../identity/use-identity'
import { identityKey } from '../../identity/types'
import { getAccountGeneration } from '../../identity/store'
import { MembershipMenu } from './membership-menu'
import { User } from '../components/user'
import { type useWorkspaceMembers, useMembershipAction } from '../members/hooks'
import type { WorkspaceMember, WorkspaceInvitation } from '../members/types'
import type { WorkspaceUserInfo } from '../presence/users'

export type WorkspaceMembersProps = {
  workspaceId: string
  users: WorkspaceUserInfo[]
  membership: ReturnType<typeof useWorkspaceMembers>
}

export function WorkspaceMembers({ workspaceId, users, membership }: WorkspaceMembersProps) {
  const identity = useIdentity()
  const membersById =
    membership.members && new Map(membership.members.map(member => [member.id, member]))
  return (
    <div className="flex flex-col rounded-2xl bg-popover p-5 shadow-md">
      <PopoverTitle>Share this workspace</PopoverTitle>
      <InviteForm
        className="mt-3"
        key={`${workspaceId}:${identity ? identityKey(identity) : ''}`}
        workspaceId={workspaceId}
        members={membership.members ?? []}
        invitations={membership.invitations ?? []}
      />
      <MembersList
        className="-mx-2 -my-1 mt-3"
        workspaceId={workspaceId}
        users={users}
        membersById={membersById}
        ownerId={membership.members?.[0]?.id}
        invitations={membership.invitations ?? []}
      />
      {membership.isPending && (
        <div className="flex items-center justify-center py-6">
          <Spinner className="text-muted-foreground" aria-label="Loading workspace members" />
        </div>
      )}
    </div>
  )
}

type InviteFormProps = {
  className?: string
  workspaceId: string
  members: WorkspaceMember[]
  invitations: WorkspaceInvitation[]
}

function InviteForm({ className, workspaceId, members, invitations }: InviteFormProps) {
  const [email, setEmail] = useState('')
  const invite = useMembershipAction(workspaceId)
  async function submit() {
    const address = email.trim().toLowerCase()
    if (!address || invite.isPending) return
    const generation = getAccountGeneration()
    setEmail('')
    const existingMember = members.some(
      member => member.type === 'user' && member.email.trim().toLowerCase() === address
    )
    const existingInvitation = invitations.some(
      invitation => invitation.email.trim().toLowerCase() === address
    )
    if (existingMember || existingInvitation) {
      toast.add({
        title: existingMember
          ? 'The user is already in this workspace'
          : 'The user is already invited',
        type: 'info'
      })
      return
    }
    try {
      await invite.mutateAsync({ type: 'invite', email: address })
      if (generation !== getAccountGeneration()) return
      toast.add({ title: 'Invitation sent', description: `Sent to ${address}`, type: 'success' })
    } catch (error) {
      if (generation !== getAccountGeneration()) return
      if (
        error instanceof CloudApiError &&
        (error.code === 'ALREADY_MEMBER' ||
          error.code === 'ALREADY_OWNER' ||
          error.code === 'ALREADY_INVITED')
      ) {
        toast.add({
          title:
            error.code === 'ALREADY_INVITED'
              ? 'The user is already invited'
              : 'The user is already in this workspace',
          type: 'info'
        })
        return
      }
      setEmail(email)
      toast.add({
        title: 'Couldn’t send invitation',
        description: error instanceof Error ? error.message : 'Try again',
        type: 'error'
      })
    }
  }
  return (
    <form
      className={cn('flex', className)}
      onSubmit={event => {
        event.preventDefault()
        void submit()
      }}
    >
      <Input
        id="invite-email"
        type="email"
        aria-label="Email"
        placeholder="Email"
        autoComplete="off"
        className="min-w-0 flex-1"
        value={email}
        onChange={event => setEmail(event.target.value)}
        disabled={invite.isPending}
      />
      <Button className="ms-2" type="submit" disabled={invite.isPending || !email.trim()}>
        Invite
      </Button>
    </form>
  )
}

type MembersListProps = {
  className?: string
  workspaceId: string
  ownerId?: string
  membersById?: Map<string, WorkspaceMember>
  invitations: WorkspaceInvitation[]
  users: WorkspaceUserInfo[]
}

function MembersList({
  className,
  workspaceId,
  membersById,
  ownerId,
  invitations,
  users
}: MembersListProps) {
  return (
    <ul
      aria-label="Who has access"
      className={cn('flex max-h-80 scroll-fade flex-col gap-0.5 overflow-y-auto', className)}
    >
      {users.map(user => (
        <MemberRow
          key={user.profile.id}
          user={user}
          isOwner={user.profile.id === ownerId}
          workspaceId={workspaceId}
          membershipId={membersById?.get(user.profile.id)?.membershipId}
        />
      ))}
      {invitations.map(invitation => (
        <InvitationRow key={invitation.id} workspaceId={workspaceId} invitation={invitation} />
      ))}
    </ul>
  )
}

type MemberRowProps = {
  user: WorkspaceUserInfo
  isOwner: boolean
  workspaceId: string
  membershipId?: string
}

function MemberRow({ user, isOwner, workspaceId, membershipId }: MemberRowProps) {
  return (
    <li className="flex min-w-0 items-center gap-2 px-2 py-1">
      <User
        profile={user.profile}
        className="flex-1"
        size="sm"
        showYouLabel={user.self}
        description={user.profile.email}
      />
      {isOwner && <span className="mr-1.5 shrink-0 text-xs text-muted-foreground">Owner</span>}
      {membershipId && (
        <MembershipMenu workspaceId={workspaceId} action={{ type: 'remove', membershipId }} />
      )}
    </li>
  )
}

type InvitationRowProps = { workspaceId: string; invitation: WorkspaceInvitation }
function InvitationRow({ workspaceId, invitation }: InvitationRowProps) {
  return (
    <li className="flex min-w-0 items-center gap-2 px-2 py-1">
      <User
        className="flex-1 text-muted-foreground **:data-[slot=avatar]:opacity-30"
        size="sm"
        profile={{
          type: 'human',
          id: invitation.id,
          email: invitation.email,
          color: colorForId(invitation.email)
        }}
        description={invitation.email}
      />
      <MembershipMenu
        workspaceId={workspaceId}
        disabled={invitation.pending}
        action={{ type: 'revoke', invitationId: invitation.id }}
      />
    </li>
  )
}
