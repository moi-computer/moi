import { Dialog } from '@base-ui/react/dialog'
import { IconDeviceDesktopOff } from '@tabler/icons-react'

import { Button } from '@/client/components/ui/button'
import { Spinner } from '@/client/components/ui/spinner'
import { cn } from '@/client/lib/cn'

import { useMachineResume } from './use-machine-resume'

export function MachineResumeOverlay() {
  const { visible, failed, retry } = useMachineResume()
  const title = failed ? 'Couldn’t wake your computer' : 'Resuming your computer'

  return (
    <Dialog.Root open={visible} disablePointerDismissal>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            'fixed inset-0 z-50 bg-black/5 data-ending-style:opacity-0 motion-safe:data-ending-style:duration-200',
            failed
              ? 'backdrop-blur-lg motion-safe:transition-opacity'
              : 'backdrop-blur-xs motion-safe:transition-[backdrop-filter,opacity] motion-safe:duration-3000 motion-safe:ease-linear starting:motion-safe:backdrop-blur-lg'
          )}
        />
        <Dialog.Popup
          aria-label={title}
          className="fixed inset-4 z-50 m-auto grid h-fit w-fit justify-items-center text-center outline-none data-ending-style:opacity-0 motion-safe:transition-opacity motion-safe:duration-100"
        >
          {failed ? (
            <>
              <IconDeviceDesktopOff aria-hidden="true" size={56} stroke={0.5} />
              <h2 className="mt-2 mb-4 font-medium">{title}</h2>
              <Button onClick={retry}>Retry</Button>
            </>
          ) : (
            <Spinner
              aria-label={title}
              className="size-6 text-muted-foreground transition-[visibility] delay-3000 duration-0 starting:invisible"
              stroke={1.5}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
