import { expect, test } from 'bun:test'
import { harnessFor } from './registry'
import { runClaudeAction } from './claude-code/run-action'
import { runCodexAction } from './codex/run-action'
import { z } from 'zod'

test('only Claude and Codex expose ephemeral actions through the registry', () => {
  expect(harnessFor('claude-code').runAction).toBe(runClaudeAction)
  expect(harnessFor('codex').runAction).toBe(runCodexAction)
  expect(harnessFor('openclaw').runAction).toBeUndefined()
  expect(harnessFor('hermes').runAction).toBeUndefined()
})

for (const harness of ['claude-code', 'codex'] as const) {
  test(`${harness} rejects an already cancelled action before launching`, async () => {
    await expect(
      harnessFor(harness).runAction!({
        prompt: 'unused',
        resultSchema: z.object({}),
        signal: AbortSignal.abort()
      })
    ).rejects.toThrow('Action cancelled')
  })
}
