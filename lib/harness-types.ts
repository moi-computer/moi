import type { HarnessType } from './types'

export const HARNESS_ORDER = [
  'claude-code',
  'codex',
  'openclaw',
  'hermes'
] as const satisfies readonly HarnessType[]

export function orderHarnesses(harnesses: Iterable<HarnessType>): HarnessType[] {
  const unique = new Set(harnesses)
  return HARNESS_ORDER.filter(harness => unique.has(harness))
}
