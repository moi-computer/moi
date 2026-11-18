import { useEffect, useId, useState } from 'react'
import { IconTextScan2 } from '@tabler/icons-react'
import { Button } from '@/client/components/ui/button'
import { Spinner } from '@/client/components/ui/spinner'
import { toast } from '@/client/components/ui/toast'

import { useIdentity } from '../../identity/use-identity'
import { createAgentInviteLink } from '../members/api'

function composeAgentInvitePrompt(inviteUrl: string, workspaceName?: string) {
  const name = workspaceName ? ` “${workspaceName}”` : ''
  return `Follow the instructions at this one-time link to join my Moi workspace${name}: ${inviteUrl}`
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

export function AgentInvite({
  workspaceId,
  workspaceName
}: {
  workspaceId: string
  workspaceName?: string
}) {
  const headingId = useId()
  const identity = useIdentity()
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied'>('idle')

  useEffect(() => {
    if (status !== 'copied') return
    const timer = setTimeout(() => setStatus('idle'), 1500)
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
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-2xl bg-popover p-5 shadow-md"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 id={headingId} className="text-sm font-medium">
          Invite your agent
        </h3>
        <p className="text-sm text-muted-foreground">
          Give your agent a prompt to work in this workspace on your behalf
        </p>
      </div>
      <Button
        variant="secondary"
        className="self-start"
        disabled={status === 'copying' || identity?.type !== 'user' || identity.isAnonymous}
        onClick={copyPrompt}
      >
        {status === 'copying' ? (
          <>
            <Spinner data-icon="inline-start" aria-hidden="true" />
            Loading invite…
          </>
        ) : (
          <>
            <IconTextScan2 data-icon="inline-start" stroke={1.5} aria-hidden="true" />
            {status === 'copied' ? 'Copied' : 'Copy prompt'}
          </>
        )}
      </Button>
    </section>
  )
}
