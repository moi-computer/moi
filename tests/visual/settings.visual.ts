import { expect } from '@uiverify/bun'

import { suite, WORKSPACE } from './fixtures'

const { describe, test } = suite(import.meta.path)

describe('Settings', () => {
  test('app', async page => {
    await page.goto('/#/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test(
    'cloud profile',
    async page => {
      await page.goto('/#/settings')
      await expect(page.getByRole('button', { name: 'Change your avatar' })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
        'alex@example.com'
      )
    },
    {
      api: {
        '/api/config': { environment: 'cloud', demo: false, demoInstallUrl: '/' },
        '/cloud/api/me': {
          id: 'alex',
          type: 'user',
          name: 'Alex',
          email: 'alex@example.com',
          isAnonymous: false
        }
      }
    }
  )

  for (const environment of ['local', 'cloud'] as const) {
    test(
      `workspace, ${environment} delete`,
      async page => {
        await page.goto(`/#/workspace/${WORKSPACE}`)
        await page.getByRole('button', { name: 'Settings' }).click()
        await page.getByRole('button', { name: 'General' }).click()
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        if (environment === 'local') {
          await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()
        } else {
          const dialog = page.getByRole('alertdialog', { name: `Delete ${WORKSPACE}`, exact: true })
          await expect(dialog.getByText('You have 30 days to restore it.')).toBeVisible()
        }
      },
      { api: { '/api/config': { environment, demo: false, demoInstallUrl: '/' } } }
    )
  }

  for (const section of ['General', 'Connectors', 'Environment']) {
    test(`workspace, ${section.toLowerCase()}`, async page => {
      await page.goto(`/#/workspace/${WORKSPACE}`)
      await page.getByRole('button', { name: 'Settings' }).click()
      await page.getByRole('button', { name: section }).click()
      await expect(page.getByRole('heading', { name: section })).toBeVisible()
    })
  }
})
