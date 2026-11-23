import type { ReactNode } from 'react'
import { IconCircleNumber1, IconCircleNumber2, IconCircleNumber3 } from '@tabler/icons-react'
import { cn } from '@/client/lib/cn'

type LoginStepsProps = {
  count: 2 | 3
  children: ReactNode
  className?: string
}

export function LoginSteps({ count, children, className }: LoginStepsProps) {
  return (
    <ol
      className={cn(
        'mx-auto grid w-full gap-6 text-center text-sm',
        count === 2 ? 'max-w-xs' : 'max-w-64 lg:max-w-3xl lg:grid-cols-3',
        className
      )}
    >
      {children}
    </ol>
  )
}

type LoginStepProps = {
  number: 1 | 2 | 3
  children: ReactNode
}

export function LoginStep({ number, children }: LoginStepProps) {
  const Icon = [IconCircleNumber1, IconCircleNumber2, IconCircleNumber3][number - 1]!
  return (
    <li className="flex min-w-0 flex-col items-center gap-3">
      <Icon size={24} stroke={1.5} className="shrink-0" aria-hidden="true" />
      <div className="flex w-full min-w-0 flex-col items-center gap-3">{children}</div>
    </li>
  )
}
