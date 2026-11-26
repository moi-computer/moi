import { useEffect, useRef, useState } from 'react'
import { useWorkspaceEvent } from '@/client/runtime/use-client-events'
import { IconX, IconArrowUpRight } from '@tabler/icons-react'
import { Button } from '@/client/components/ui/button'
import { cn } from '@/client/lib/cn'
import { useWorkspaceId } from '@/client/features/workspace/workspace-context'
import { DemoDialog } from './demo-dialog'

type BannerState = 'waiting' | 'expanded' | 'dismissed'

export function DemoBanner() {
  const workspaceId = useWorkspaceId()
  const [state, setState] = useState<BannerState>('expanded')

  useWorkspaceEvent(workspaceId, event => {
    if (event.type === 'chat:message-sent' && state === 'waiting') setState('expanded')
  })

  useEffect(() => {
    if (state !== 'waiting') return
    const timer = setTimeout(() => setState('expanded'), 5 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [state])

  const expanded = state === 'expanded'
  const trigger = useRef<HTMLButtonElement>(null)

  return (
    <div className="relative h-7 w-28 shrink-0">
      <div
        data-vivid
        className={cn(
          'absolute top-0 right-0 z-10 flex h-full w-full max-w-[calc(100cqw-1.5rem)] flex-col items-start justify-end rounded-md bg-background text-foreground inset-shadow-[0_0_16px_0_color-mix(in_srgb,var(--color-white)_80%,transparent)] transition-[width,height,border-radius,padding] duration-200 ease-out motion-reduce:transition-none',
          expanded && 'h-[174px] w-[371px] rounded-lg pb-3 pl-3'
        )}
      >
        {expanded && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse demo banner"
              className="absolute top-2 right-2"
              onClick={() => {
                setState('dismissed')
                trigger.current?.focus()
              }}
            >
              <IconX stroke={1.5} />
            </Button>
            <p className="pointer-events-none absolute inset-0 animate-in overflow-hidden p-4 pr-12 text-sm duration-200 fade-in motion-reduce:animate-none">
              You’re exploring a demo workspace. Set up Moi to create your own.
            </p>
          </>
        )}
        <DemoDialog
          trigger={
            <Button ref={trigger} variant="ghost" size="sm">
              Set up Moi
              <IconArrowUpRight aria-hidden="true" data-icon="inline-end" stroke={1.75} />
            </Button>
          }
        />
      </div>
    </div>
  )
}
