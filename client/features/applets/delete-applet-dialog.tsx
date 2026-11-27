import { useState, type ReactNode } from 'react'
import { IconLoader2 } from '@tabler/icons-react'
import { useDeleteApplet } from './api'
import type { AppletKind } from '@/lib/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/client/components/ui/alert-dialog'

type DeleteAppletDialogProps = {
  kind: AppletKind
  id: string
  label: string
  children: ReactNode
}

export function DeleteAppletDialog({ kind, id, label, children }: DeleteAppletDialogProps) {
  const mutation = useDeleteApplet(kind)
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (mutation.isPending) return
        if (next) mutation.reset()
        setOpen(next)
      }}
    >
      {children}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{label}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This will delete the {kind} forever. Related data and shared files will stay in the
            workspace.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.isError && <p className="text-xs text-destructive">{mutation.error.message}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(id, { onSuccess: () => setOpen(false) })}
          >
            {mutation.isPending && (
              <IconLoader2 data-icon="inline-start" stroke={1.75} className="animate-spin" />
            )}
            Delete {kind}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
