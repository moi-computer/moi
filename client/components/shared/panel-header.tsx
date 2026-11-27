import { cn } from '@/client/lib/cn'
import type { ReactNode } from 'react'

export function PanelHeader({ children }: { children?: ReactNode }) {
  return (
    <header
      className={cn(
        '@container relative flex shrink-0 items-center gap-1 py-2 pr-3 pl-4',
        // Header bottom border that overflows the tab content and contrasts with it
        'before:absolute before:top-full before:left-0 before:h-px before:w-full before:bg-border'
      )}
    >
      {children}
    </header>
  )
}
