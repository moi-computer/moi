import type { HarnessType } from './types'

type HarnessInstruction = {
  reason: string
  command: string
}

export const HARNESS_INSTRUCTIONS: Record<HarnessType, HarnessInstruction> = {
  'claude-code': {
    reason: 'Run in terminal to install Claude:',
    command: 'curl -fsSL https://claude.ai/install.sh | bash'
  },
  codex: {
    reason: 'Run in terminal to install ChatGPT:',
    command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'
  },
  openclaw: {
    reason: 'Run in terminal to connect OpenClaw:',
    command: 'moi openclaw init'
  },
  hermes: {
    reason: 'Run in terminal to connect Hermes:',
    command: 'moi hermes init'
  }
}

export function harnessInstructionMessage(harness: HarnessType): string {
  const { reason, command } = HARNESS_INSTRUCTIONS[harness]
  return `${reason} ${command}`
}
