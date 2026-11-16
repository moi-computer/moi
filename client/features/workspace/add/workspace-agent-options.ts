import { harnessDescription } from '@/client/features/harness/harness-presentation'
import { HARNESS_INSTRUCTIONS } from '@/lib/harness-instructions'
import type { HarnessStatuses, HarnessType } from '@/lib/types'
import { HARNESS_ORDER } from '@/lib/harness-types'

type WorkspaceAgentConfig = {
  importOnly: boolean
}

const workspaceAgents: Record<HarnessType, WorkspaceAgentConfig> = {
  'claude-code': { importOnly: false },
  codex: { importOnly: false },
  openclaw: { importOnly: true },
  hermes: { importOnly: true }
}

export type { HarnessOption as WorkspaceAgentOption } from '@/client/features/harness/harness-selector'
import type { HarnessOption as WorkspaceAgentOption } from '@/client/features/harness/harness-selector'

export function getWorkspaceAgentOptions(
  statuses?: HarnessStatuses,
  detectedHarnesses: HarnessType[] = []
): WorkspaceAgentOption[] {
  if (!statuses) return []
  const installed = (harness: HarnessType) => {
    const availability = statuses[harness].availability
    return availability.status !== 'unavailable' || availability.code !== 'not-installed'
  }
  return HARNESS_ORDER.filter(
    harness => installed(harness) || !workspaceAgents[harness].importOnly
  ).map(harness => {
    const config = workspaceAgents[harness]
    const instruction = HARNESS_INSTRUCTIONS[harness]
    const disabled =
      !installed(harness) || (config.importOnly && !detectedHarnesses.includes(harness))
    return {
      harness,
      description: harnessDescription[harness],
      disabled,
      disabledReason: disabled ? instruction.reason : undefined,
      disabledCommand: disabled ? instruction.command : undefined
    }
  })
}

export function resolveWorkspaceAgentSelection(
  options: WorkspaceAgentOption[],
  selectedHarness: HarnessType
): HarnessType | undefined {
  const selected = options.find(option => option.harness === selectedHarness)
  if (selected && !selected.disabled) return selected.harness
  return options.find(option => !option.disabled)?.harness
}
