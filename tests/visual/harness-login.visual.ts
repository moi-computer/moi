import { expect } from '@uiverify/bun'
import type { ClientAppConfig, HarnessStatuses } from '@/lib/types'
import type { Identity } from '@/client/features/identity/types'
import { suite } from './fixtures'

const { test } = suite(import.meta.path)

for (const type of ['claude-code', 'codex'] as const) {
  const name = type === 'claude-code' ? 'Claude' : 'ChatGPT'
  test(
    `cloud ${name} login steps`,
    async page => {
      await page.goto('/#/onboarding')
      await page.getByRole('button', { name: new RegExp(name) }).click()
      if (type === 'claude-code') {
        await expect(page.getByRole('textbox', { name: 'Authorization code' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
      } else {
        await expect(page.getByRole('button', { name: 'Copy code' })).toBeVisible()
      }
      await expect(page.getByRole('listitem')).toHaveCount(type === 'claude-code' ? 2 : 3)
    },
    {
      viewports: { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } },
      api: {
        '/cloud/api/me': {
          id: 'login-test',
          type: 'user',
          name: 'Alex',
          email: 'alex@example.com',
          isAnonymous: false
        } satisfies Identity,
        '/api/config': {
          environment: 'cloud',
          demo: false,
          demoInstallUrl: ''
        } satisfies ClientAppConfig,
        '/api/settings': { showOnboarding: true, autoUpdateSkills: false },
        '/api/harnesses/status': {
          openclaw: { availability: { status: 'unavailable', reason: 'Not installed' } },
          hermes: { availability: { status: 'unavailable', reason: 'Not installed' } },
          'claude-code': {
            availability: { status: 'login-required', reason: 'Log in' },
            login: {
              state: 'pending',
              id: 'claude',
              url: 'https://example.invalid/claude',
              codeUrl: 'https://example.invalid/claude'
            }
          },
          codex: {
            availability: { status: 'login-required', reason: 'Log in' },
            login: {
              state: 'pending',
              id: 'codex',
              url: 'https://example.invalid/chatgpt',
              userCode: 'ABCD-1234'
            }
          }
        } satisfies HarnessStatuses
      }
    }
  )
}
