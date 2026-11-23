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

export function resolveWorkspaceHarnessSelection(
  options: WorkspaceAgentOption[],
  selectedHarness?: HarnessType,
  statuses?: HarnessStatuses,
  detectedHarnesses: readonly HarnessType[] = []
): HarnessType | undefined {
  const selectable = options.filter(option => !option.disabled).map(option => option.harness)
  if (selectedHarness && selectable.includes(selectedHarness)) return selectedHarness

  const connected = selectable.filter(
    harness => statuses?.[harness].availability.status === 'available'
  )
  const candidates = connected.length ? connected : selectable
  return (
    detectedHarnesses.find(harness => candidates.includes(harness)) ??
    HARNESS_ORDER.find(harness => candidates.includes(harness))
  )
}
