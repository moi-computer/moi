import type { ReactNode } from 'react'
import { IconChevronRight } from '@tabler/icons-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/client/components/ui/collapsible'

type WorkspaceListSectionProps = {
  defaultOpen?: boolean
  title: string
  footerNote?: ReactNode
  children: ReactNode
}

export function WorkspaceListSection({
  title,
  footerNote,
  children,
  defaultOpen = true
}: WorkspaceListSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} render={<section />} className="group">
      <h2>
        <CollapsibleTrigger className="group/trigger flex w-fit items-center gap-1 text-left text-sm font-medium text-muted-foreground outline-none group-data-open:text-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {title}
          <IconChevronRight
            size={16}
            stroke={2}
            className="shrink-0 opacity-0 transition-[opacity,transform] group-hover/trigger:opacity-100 group-focus-visible/trigger:opacity-100 group-data-open:rotate-90"
          />
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent className="pt-4">
        <ul className="border-t border-border">{children}</ul>
        {footerNote && <div className="mt-4 text-xs text-muted-foreground">{footerNote}</div>}
      </CollapsibleContent>
    </Collapsible>
  )
}

type WorkspaceListRowProps = { children: ReactNode }

export function WorkspaceListRow({ children }: WorkspaceListRowProps) {
  return <li className="flex items-center gap-2 border-b border-border px-1 py-3">{children}</li>
}
