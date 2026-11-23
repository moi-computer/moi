import type { HarnessStatuses, HarnessType } from '@/lib/types'
import { describe, expect, test } from 'bun:test'

import {
  getWorkspaceAgentOptions as optionsFromStatuses,
  resolveWorkspaceHarnessSelection
} from './workspace-agent-options'
import type { HarnessInstallations } from '@/lib/types'

describe('create workspace agent options', () => {
  for (let mask = 0; mask < 16; mask++) {
    const installed: HarnessInstallations = {
      'claude-code': Boolean(mask & 1),
      codex: Boolean(mask & 2),
      openclaw: Boolean(mask & 4),
      hermes: Boolean(mask & 8)
    }
    test(`handles installation combination ${mask}`, () => {
      const options = getWorkspaceAgentOptions(installed)
      expect(options.map(option => option.harness)).toEqual([
        'claude-code',
        'codex',
        ...(installed.openclaw ? ['openclaw' as const] : []),
        ...(installed.hermes ? ['hermes' as const] : [])
      ])
      expect(options.find(option => option.harness === 'claude-code')?.disabled).toBe(
        !installed['claude-code']
      )
      expect(options.find(option => option.harness === 'codex')?.disabled).toBe(!installed.codex)
      for (const harness of ['openclaw', 'hermes'] as const) {
        if (installed[harness])
          expect(options.find(option => option.harness === harness)).toMatchObject({
            disabled: true,
            disabledCommand: `moi ${harness} init`
          })
      }
      expect(resolveWorkspaceHarnessSelection(options, 'claude-code')).toBe(
        installed['claude-code'] ? 'claude-code' : installed.codex ? 'codex' : undefined
      )
    })
  }

  test('provides install instructions for missing primary agents', () => {
    const options = getWorkspaceAgentOptions({
      'claude-code': false,
      codex: false,
      openclaw: false,
      hermes: false
    })
    expect(options.map(option => option.disabledReason)).toEqual([
      'Run in terminal to install Claude:',
      'Run in terminal to install ChatGPT:'
    ])
    expect(options.map(option => option.disabledCommand)).toEqual([
      'curl -fsSL https://claude.ai/install.sh | bash',
      'curl -fsSL https://chatgpt.com/codex/install.sh | sh'
    ])
  })

  test('uses only installation flags to enable primary agents', () => {
    const options = getWorkspaceAgentOptions({
      'claude-code': true,
      codex: true,
      openclaw: true,
      hermes: true
    })
    expect(options.map(option => option.disabled)).toEqual([false, false, true, true])
  })

  test('waits for installation data before showing cards', () => {
    expect(getWorkspaceAgentOptions()).toEqual([])
  })
})

describe('import workspace agent options', () => {
  for (let mask = 0; mask < 16; mask++) {
    const installed: HarnessInstallations = {
      'claude-code': Boolean(mask & 1),
      codex: Boolean(mask & 2),
      openclaw: Boolean(mask & 4),
      hermes: Boolean(mask & 8)
    }
    test(`shares create visibility and installation rules for combination ${mask}`, () => {
      const createOptions = getWorkspaceAgentOptions(installed)
      // A detected folder never makes a missing installation selectable.
      const importOptions = getWorkspaceAgentOptions(installed, [
        'claude-code',
        'codex',
        'openclaw',
        'hermes'
      ])
      expect(importOptions.map(option => option.harness)).toEqual(
        createOptions.map(option => option.harness)
      )
      expect(
        importOptions.filter(
          option => option.harness === 'claude-code' || option.harness === 'codex'
        )
      ).toEqual(
        createOptions.filter(
          option => option.harness === 'claude-code' || option.harness === 'codex'
        )
      )
      for (const option of importOptions) {
        expect(option.disabled).toBe(!installed[option.harness])
      }
    })
  }

  test.each(['openclaw', 'hermes'] as const)('only enables %s for folders it owns', harness => {
    const installed: HarnessInstallations = {
      'claude-code': true,
      codex: true,
      openclaw: true,
      hermes: true
    }
    expect(
      getWorkspaceAgentOptions(installed).find(option => option.harness === harness)
    ).toMatchObject({
      disabled: true,
      disabledCommand: `moi ${harness} init`
    })
    const options = getWorkspaceAgentOptions(installed, [harness])
    expect(options.find(option => option.harness === harness)).toMatchObject({
      disabled: false,
      disabledReason: undefined,
      disabledCommand: undefined
    })
    expect(resolveWorkspaceHarnessSelection(options, harness)).toBe(harness)
  })

  test('waits for installation data even when a folder has a detected agent', () => {
    expect(getWorkspaceAgentOptions(undefined, ['codex', 'openclaw'])).toEqual([])
  })

  test('preserves a detected selection or falls back when it is no longer installed', () => {
    const installed: HarnessInstallations = {
      'claude-code': true,
      codex: true,
      openclaw: false,
      hermes: false
    }
    expect(
      resolveWorkspaceHarnessSelection(
        getWorkspaceAgentOptions(installed, ['codex']),
        undefined,
        undefined,
        ['codex']
      )
    ).toBe('codex')
    expect(
      resolveWorkspaceHarnessSelection(
        getWorkspaceAgentOptions({ ...installed, codex: false }, ['codex']),
        undefined,
        undefined,
        ['codex']
      )
    ).toBe('claude-code')
  })
})

describe('workspace agent preselection', () => {
  const statuses: HarnessStatuses = {
    'claude-code': { availability: { status: 'available' } },
    codex: { availability: { status: 'available' } },
    openclaw: { availability: { status: 'available' } },
    hermes: { availability: { status: 'available' } }
  }
  const options = optionsFromStatuses(statuses, ['openclaw', 'hermes'])

  test('defaults to Claude when both primary agents are connected', () => {
    expect(resolveWorkspaceHarnessSelection(options, undefined, statuses)).toBe('claude-code')
  })

  test('prefers the only connected primary agent even if the folder was used with the other', () => {
    const onlyCodex: HarnessStatuses = {
      ...statuses,
      'claude-code': { availability: { status: 'login-required', reason: 'Sign in' } }
    }
    const primaryOptions = optionsFromStatuses(onlyCodex, ['claude-code'])
    expect(
      resolveWorkspaceHarnessSelection(primaryOptions, undefined, onlyCodex, ['claude-code'])
    ).toBe('codex')
    expect(resolveWorkspaceHarnessSelection(primaryOptions, 'claude-code', onlyCodex)).toBe(
      'claude-code'
    )
  })

  test('prefers the first selectable detected agent among connected agents', () => {
    expect(
      resolveWorkspaceHarnessSelection(options, undefined, statuses, ['codex', 'openclaw'])
    ).toBe('codex')
    expect(resolveWorkspaceHarnessSelection(options, undefined, statuses, ['hermes'])).toBe(
      'hermes'
    )
  })
})

function getWorkspaceAgentOptions(
  installed?: HarnessInstallations,
  detectedHarnesses: HarnessType[] = []
) {
  const statuses =
    installed &&
    (Object.fromEntries(
      Object.entries(installed).map(([type, present]) => [
        type,
        {
          availability: present
            ? { status: 'available' }
            : { status: 'unavailable', code: 'not-installed', reason: 'Not installed' }
        }
      ])
    ) as HarnessStatuses | undefined)
  return optionsFromStatuses(statuses, detectedHarnesses)
}
