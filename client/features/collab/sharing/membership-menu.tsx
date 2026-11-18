import { IconDots } from '@tabler/icons-react'
import { Button } from '@/client/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/client/components/ui/dropdown-menu'
import { toast } from '@/client/components/ui/toast'
import { getAccountGeneration } from '../../identity/store'
import { useMembershipAction, type MembershipAction } from '../members/hooks'

type MembershipMenuProps = {
  workspaceId: string
  action: Exclude<MembershipAction, { type: 'invite' }>
  removeLabel?: string
  disabled?: boolean
}

export function MembershipMenu({
  workspaceId,
  action,
  disabled,
  removeLabel = 'Remove'
}: MembershipMenuProps) {
  const mutation = useMembershipAction(workspaceId)
  async function submit() {
    if (mutation.isPending || disabled) return
    const generation = getAccountGeneration()
    try {
      await mutation.mutateAsync(action)
    } catch (error) {
      if (generation !== getAccountGeneration()) return
      toast.add({
        title: action.type === 'remove' ? 'Couldn’t remove member' : 'Couldn’t revoke invitation',
        description: error instanceof Error ? error.message : 'Try again',
        type: 'error'
      })
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || mutation.isPending}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label="More options"
          />
        }
      >
        <IconDots stroke={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max">
        <DropdownMenuItem onClick={() => void submit()}>
          {action.type === 'remove' ? removeLabel : 'Revoke invitation'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
