import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWorkspaceEvent } from '@/client/runtime/use-client-events'
import { IconArrowUpRight, IconX } from '@tabler/icons-react'
import { Button, buttonVariants } from '@/client/components/ui/button'
import { cn } from '@/client/lib/cn'
import { useWorkspaceId } from '@/client/features/workspace/workspace-context'
import { DemoDialog } from './demo-dialog'

type BannerState = 'waiting' | 'expanded' | 'dismissed'

export function DemoBanner() {
  const workspaceId = useWorkspaceId()
  const [state, setState] = useState<BannerState>('waiting')

  useWorkspaceEvent(workspaceId, event => {
    if (event.type === 'chat:message-sent' && state === 'waiting') setState('expanded')
  })

  useEffect(() => {
    if (state !== 'waiting') return
    const timer = setTimeout(() => setState('expanded'), 3 * 60_000)
    return () => clearTimeout(timer)
  }, [state])

  const expanded = state === 'expanded'
  const triggerRef = useRef<HTMLButtonElement>(null)
  const setupLabelRef = useRef<HTMLSpanElement>(null)
  const headerSlotRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const setupLabel = setupLabelRef.current
    const headerSlot = headerSlotRef.current
    if (expanded || !setupLabel || !headerSlot) return

    // Reserve the compact width while the banner expands over the header.
    const measure = () => {
      const { width } = setupLabel.getBoundingClientRect()
      headerSlot.style.setProperty('--compact-width', `${width}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(setupLabel, { box: 'border-box' })
    return () => observer.disconnect()
  }, [expanded])

  return (
    <div ref={headerSlotRef} className="h-7 w-(--compact-width) shrink-0">
      <div
        data-vivid
        className={cn(
          'absolute inset-y-0 my-auto flex items-center rounded-md bg-background text-foreground inset-shadow-[0_0_16px_0_color-mix(in_srgb,var(--color-white)_80%,transparent)] transition-[right,width,height] duration-200 ease-in-out motion-reduce:transition-none',
          expanded
            ? 'right-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)]'
            : 'right-3 h-7 w-[var(--compact-width,max-content)]'
        )}
      >
        <DemoDialog
          onOpenChange={open => {
            if (open) setState('dismissed')
          }}
          trigger={
            <button
              type="button"
              ref={triggerRef}
              aria-label="Set up Moi"
              className={cn(
                'flex size-full cursor-pointer items-center justify-end rounded-[inherit] text-left transition-[padding] duration-200 ease-in-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
                expanded && 'pr-9 pl-4'
              )}
            >
              {expanded && (
                <span className="line-clamp-2 min-w-0 flex-1 animate-in text-sm font-medium wrap-break-word delay-100 duration-100 fill-mode-backwards fade-in motion-reduce:animate-none">
                  You're playing with a demo workspace, sign in to create your own
                </span>
              )}
              <span
                ref={setupLabelRef}
                className={cn(
                  buttonVariants({
                    variant: 'ghost',
                    size: expanded ? 'lg' : 'sm'
                  }),
                  'rounded-none'
                )}
              >
                Set up Moi
                <IconArrowUpRight aria-hidden="true" data-icon="inline-end" stroke={1.75} />
              </span>
            </button>
          }
        />
        {expanded && (
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Collapse demo banner"
            onClick={() => {
              setState('dismissed')
              triggerRef.current?.focus()
            }}
            className="absolute right-0 rounded-none text-muted-foreground"
          >
            <IconX stroke={1.75} />
          </Button>
        )}
      </div>
    </div>
  )
}
