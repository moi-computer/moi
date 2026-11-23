import { useEffect, useState } from 'react'

import { IconChevronRight, IconCopy, IconCheck } from '@tabler/icons-react'

import { buttonVariants } from '@/client/components/ui/button'
import { LoginSteps, LoginStep } from './login-steps'
import { cn } from '@/client/lib/cn'

type DeviceLoginStepsProps = {
  code: string
  url: string
  className?: string
}

export function DeviceLoginSteps({ code, url, className }: DeviceLoginStepsProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 3000)
    return () => clearTimeout(timer)
  }, [copied])

  const copyCode = () => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => setCopied(true))
      .catch(() => {})
  }

  return (
    <LoginSteps count={3} className={className}>
      <LoginStep number={1}>
        <p>Enable device code sign-in for Codex in ChatGPT settings</p>
        <a
          href="https://chatgpt.com/settings/security"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 flex-wrap items-center gap-1 font-semibold focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Settings
          <IconChevronRight size={16} stroke={2} aria-hidden="true" />
          Security and login
        </a>
      </LoginStep>
      <LoginStep number={2}>
        <p>Copy the one-time device code provided below</p>
        <div className="flex h-8 items-center gap-2 rounded-lg border border-input bg-accent pr-2 pl-3">
          <code className="cursor-text text-sm font-medium select-text">{code}</code>
          <button
            type="button"
            className="relative size-4 cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
            aria-label={copied ? 'Code copied' : 'Copy code'}
            onClick={copyCode}
          >
            <IconCopy
              className={cn(
                'absolute inset-0 transition-[opacity,filter] duration-200 motion-reduce:transition-none',
                copied && 'opacity-0 blur-[2px]'
              )}
              stroke={1.75}
              size={16}
            />
            <IconCheck
              className={cn(
                'absolute inset-0 transition-[opacity,filter] duration-200 motion-reduce:transition-none',
                !copied && 'opacity-0 blur-[2px]'
              )}
              stroke={1.75}
              size={16}
            />
          </button>
        </div>
      </LoginStep>
      <LoginStep number={3}>
        <p>Log in to ChatGPT, paste the code, then come back to Moi</p>
        <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
          Open ChatGPT
        </a>
      </LoginStep>
    </LoginSteps>
  )
}
