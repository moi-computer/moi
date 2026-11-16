import type { HarnessType } from '@/lib/types'
export { harnessIcon } from '@/client/components/shared/workspace-icon'
export const harnessLabel: Record<HarnessType, string> = {
  'claude-code': 'Claude',
  openclaw: 'OpenClaw',
  codex: 'ChatGPT',
  hermes: 'Hermes'
}

export const harnessDescription: Record<HarnessType, string> = {
  'claude-code': 'Anthropic',
  codex: 'OpenAI',
  openclaw: 'Open-source',
  hermes: 'Nous Research'
}
