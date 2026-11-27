import { useEffect, useState } from 'react'
import { IconCheck, IconTextScan2 } from '@tabler/icons-react'
import { Button } from '@/client/components/ui/button'
import { toast } from '@/client/components/ui/toast'

import { cn } from '@/client/lib/cn'
import { useIdentity } from '../../identity/use-identity'
import { createAgentInviteLink } from '../members/api'

function composeAgentInvitePrompt(inviteUrl: string, workspaceName?: string) {
  return `Follow the instructions at this one-time link to join my Moi workspace${workspaceName ? ` “${workspaceName}”` : ''}: ${inviteUrl}`
}

async function copyAsyncText(getText: () => Promise<string>) {
  const clipboard = navigator.clipboard
  if (!clipboard) throw new Error('Clipboard access is unavailable')
  if (typeof ClipboardItem !== 'undefined' && clipboard.write) {
    // Start the clipboard write during the click, while Safari still grants access.
    const blob = getText().then(text => new Blob([text], { type: 'text/plain' }))
    await Promise.all([blob, clipboard.write([new ClipboardItem({ 'text/plain': blob })])])
  } else {
    await clipboard.writeText(await getText())
  }
}

type CopyAgentPromptButtonProps = {
  workspaceId: string
  workspaceName?: string
}

export function CopyAgentPromptButton({ workspaceId, workspaceName }: CopyAgentPromptButtonProps) {
  const identity = useIdentity()
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied'>('idle')

  useEffect(() => {
    if (status !== 'copied') return
    const timer = setTimeout(() => setStatus('idle'), 3000)
    return () => clearTimeout(timer)
  }, [status])

  async function copyPrompt() {
    setStatus('copying')
    try {
      await copyAsyncText(async () => {
        const link = await createAgentInviteLink(workspaceId, workspaceName)
        return composeAgentInvitePrompt(link, workspaceName)
      })
      setStatus('copied')
    } catch (error) {
      setStatus('idle')
      toast.add({
        title: 'Couldn’t copy invite prompt',
        description: error instanceof Error ? error.message : 'Try again',
        type: 'error'
      })
    }
  }

  const Icon = status === 'copied' ? IconCheck : IconTextScan2

  return (
    <Button
      variant="secondary"
      aria-busy={status === 'copying'}
      className={cn(status === 'copied' && 'disabled:text-accent-foreground')}
      disabled={status === 'copied' || identity?.type !== 'user' || identity.isAnonymous}
      onClick={status === 'idle' ? copyPrompt : undefined}
    >
      <Icon data-icon="inline-start" stroke={1.5} aria-hidden="true" />
      {status === 'copied' ? 'Copied' : 'Copy prompt'}
    </Button>
  )
}
