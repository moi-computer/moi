import { HARNESS_INSTRUCTIONS } from '@/lib/harness-instructions'
import { getAppConfig } from '../app-config'
import type { HarnessType } from '@/lib/types'
import { detectInstalledHarnesses } from './executable'

const installations = new Map<HarnessType, Promise<void>>()

export function installHarness(harness: HarnessType): Promise<void> {
  const config = getAppConfig()
  if (config.environment !== 'local' || config.demo || config.agentLauncher) {
    throw new Error('Agents can only be installed in local Moi')
  }
  if (harness !== 'claude-code' && harness !== 'codex') {
    throw new Error('This agent requires manual installation')
  }
  const pending = installations.get(harness)
  if (pending) return pending
  const installation = (async () => {
    if ((await detectInstalledHarnesses())[harness]) return
    const url =
      harness === 'claude-code' ? 'https://claude.ai/install' : 'https://chatgpt.com/codex/install'
    const command =
      process.platform === 'win32'
        ? [
            'powershell.exe',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `$ErrorActionPreference = 'Stop'; irm ${url}.ps1 | iex`
          ]
        : ['bash', '-o', 'pipefail', '-c', HARNESS_INSTRUCTIONS[harness].command]
    const child = Bun.spawn(command, {
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      timeout: 5 * 60_000
    })
    if ((await child.exited) !== 0) {
      throw new Error('Installation failed or timed out. Try again.')
    }
    if (!(await detectInstalledHarnesses())[harness]) {
      throw new Error('The installer finished, but the agent could not be found. Restart Moi.')
    }
  })().finally(() => installations.delete(harness))
  installations.set(harness, installation)
  return installation
}
