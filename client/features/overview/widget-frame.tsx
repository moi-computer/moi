import type { ReactNode } from 'react'

import { motion } from 'motion/react'

import { IconMinus, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'

import { cn } from '@/client/lib/cn'

import { Button } from '@/client/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/client/components/ui/tooltip'
import { isDefaultWidget } from '@/lib/default-widgets'

import { AlertDialogTrigger } from '@/client/components/ui/alert-dialog'
import { DeleteAppletDialog } from '@/client/features/applets/delete-applet-dialog'
import { labelFromSlug } from '@/lib/slug'

type DeleteWidgetButtonProps = { id: string }

function DeleteWidgetButton({ id }: DeleteWidgetButtonProps) {
  const label = labelFromSlug(id)
  return (
    <DeleteAppletDialog kind="widget" id={id} label={label}>
      <Tooltip>
        <TooltipTrigger
          render={
            <AlertDialogTrigger
              render={<Button size="icon-sm" variant="outline" className="rounded-full" />}
            />
          }
          aria-label={`Delete ${label}`}
        >
          <IconTrash stroke={1.75} />
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
    </DeleteAppletDialog>
  )
}

type WidgetFrameProps = {
  customizing?: boolean
  hidden?: boolean
  widgetId?: string
  onEdit?: (id: string) => void
  onRemove?: () => void
  children?: ReactNode
}

export function WidgetFrame({
  customizing,
  hidden,
  widgetId,
  onEdit,
  onRemove,
  children
}: WidgetFrameProps) {
  const builtIn = widgetId && isDefaultWidget(widgetId)

  return (
    <motion.div
      variants={{
        idle: { rotate: 0 },
        wiggle: {
          rotate: [0.5, -0.5],
          transition: {
            rotate: { repeat: Infinity, repeatType: 'reverse', duration: 0.15, ease: 'easeInOut' }
          }
        }
      }}
      animate={customizing ? 'wiggle' : 'idle'}
      transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
      className="group/widget relative size-full"
    >
      <div
        // Stable hook for widget thumbnails: the capture clone overrides this
        // element's chrome (radius/shadow/stroke) so thumbnails come out square.
        data-widget-chrome
        data-vivid={builtIn ? undefined : true}
        className={cn(
          'absolute inset-0 overflow-hidden rounded-2xl text-foreground squircle',
          customizing && 'pointer-events-none'
        )}
      >
        {children}
      </div>

      {customizing && onRemove && (
        <div
          className="absolute -top-2 -right-2 flex gap-1 opacity-0 transition-opacity group-hover/widget:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
          onPointerDown={event => event.stopPropagation()}
        >
          {onEdit && widgetId && !builtIn && (
            <Tooltip>
              <TooltipTrigger
                render={<Button size="icon-sm" variant="outline" className="rounded-full" />}
                aria-label={`Edit ${labelFromSlug(widgetId)} in chat`}
                onClick={() => onEdit(widgetId)}
              >
                <IconPencil stroke={1.75} />
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={<Button size="icon-sm" variant="outline" className="rounded-full" />}
              aria-label={hidden ? 'Add to overview' : 'Hide widget'}
              onClick={onRemove}
            >
              {hidden ? <IconPlus stroke={1.75} /> : <IconMinus stroke={1.75} />}
            </TooltipTrigger>
            <TooltipContent>{hidden ? 'Add to overview' : 'Hide'}</TooltipContent>
          </Tooltip>
          {hidden && widgetId && !builtIn && <DeleteWidgetButton id={widgetId} />}
        </div>
      )}
    </motion.div>
  )
}
