import { IconX } from '@tabler/icons-react'
import { Button } from '@/client/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/client/components/ui/tooltip'
import { toast } from '@/client/components/ui/toast'
import { getAccountGeneration } from '../../identity/store'
import { useMembershipAction, type MembershipAction } from '../members/hooks'

type RemoveButtonProps = {
  workspaceId: string
  action: Exclude<MembershipAction, { type: 'invite' }>
  label?: string
  disabled?: boolean
}

export function RemoveButton({ workspaceId, action, disabled, label }: RemoveButtonProps) {
  const mutation = useMembershipAction(workspaceId)
  const title = label ?? (action.type === 'remove' ? 'Remove' : 'Revoke invitation')
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
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={title}
            disabled={disabled || mutation.isPending}
            onClick={() => void submit()}
          />
        }
      >
        <IconX stroke={1.75} />
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}
