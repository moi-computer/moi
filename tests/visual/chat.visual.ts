import { createDefaultPersonalLayout } from '@/lib/workspace-layout'
import type { WorkspaceState } from '@/lib/types'
import { expect, takeSnapshot } from '@uiverify/bun'

import { HARNESSES, suite, WORKSPACE } from './fixtures'

const { describe, test } = suite(import.meta.path)
const WORKSPACE_PAGE = `/#/workspace/${WORKSPACE}`

describe('Chat', () => {
  // The conversation from the chat playground (chat-states-fixtures.ts) holds
  // every message, tool and notice state; a tall window shows all of it.
  test(
    'every message and tool state',
    async page => {
      await page.goto(WORKSPACE_PAGE)
      await expect(page.getByText('On it — three in flight:')).toBeVisible()
    },
    { viewports: { '': { width: 1280, height: 4400 } } }
  )

  test(
    'new chat',
    async page => {
      await page.goto(WORKSPACE_PAGE)
      await expect(page.getByPlaceholder('Do anything')).toBeVisible()
    },
    {
      api: {
        [`/api/workspaces/${WORKSPACE}/state`]: {
          revision: 1,
          selected: {},
          sessions: {},
          pendingViews: {}
        },
        [`/api/workspaces/${WORKSPACE}/sessions`]: []
      }
    }
  )

  test('message typed', async page => {
    await page.goto(WORKSPACE_PAGE)
    await page.getByPlaceholder('Do anything').fill('Add a revenue widget for this week')
    await expect(page.getByRole('button', { name: 'Send message' })).not.toBeDisabled()
  })

  test('model picker', async page => {
    await page.goto(WORKSPACE_PAGE)
    await page.getByRole('button', { name: 'Model: Opus' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'Fable' })).toBeVisible()
  })

  test(
    'new chat model defaults persist without a layout write',
    async page => {
      const state: WorkspaceState = {
        revision: 1,
        selected: {},
        sessions: {},
        pendingViews: {},
        chatDefaults: { model: 'sonnet' }
      }
      let settingsWrites = 0
      let layoutWrites = 0
      await page.route(`**/api/workspaces/${WORKSPACE}/state`, route =>
        route.fulfill({ json: state })
      )
      await page.route(`**/api/workspaces/${WORKSPACE}/state/chat-defaults`, async route => {
        expect(route.request().method()).toBe('PATCH')
        settingsWrites++
        state.chatDefaults = { model: 'fable' }
        state.revision++
        return route.fulfill({ json: state })
      })
      await page.route(`**/api/workspaces/${WORKSPACE}`, route => {
        if (route.request().method() === 'PUT') layoutWrites++
        return route.fallback()
      })
      await page.goto(WORKSPACE_PAGE)
      await page.getByRole('button', { name: 'Model: Sonnet' }).click()
      await page.getByRole('menuitemradio', { name: 'Fable' }).click()
      await expect(page.getByRole('button', { name: 'Model: Fable' })).toBeVisible()
      expect(settingsWrites).toBe(1)
      expect(layoutWrites).toBe(0)
      await page.goto(WORKSPACE_PAGE)
      await expect(page.getByRole('button', { name: 'Model: Fable' })).toBeVisible()
    },
    { api: { [`/api/workspaces/${WORKSPACE}/sessions`]: [] } }
  )

  test('effort picker', async page => {
    await page.goto(WORKSPACE_PAGE)
    await page.getByRole('button', { name: 'Effort: High' }).click()
    await expect(page.getByRole('slider', { name: 'Reasoning effort' })).toBeVisible()
  })

  test(
    'agent signed out',
    async page => {
      await page.goto(WORKSPACE_PAGE)
      await expect(page.getByText('Set up Claude')).toBeVisible()
    },
    {
      api: {
        '/api/harnesses/status': {
          ...HARNESSES,
          'claude-code': {
            availability: { status: 'login-required', reason: 'Claude is signed out' }
          }
        },
        [`/api/workspaces/${WORKSPACE}/harness`]: {
          provider: 'claude-code',
          availability: { status: 'login-required', reason: 'Claude is signed out' },
          models: []
        }
      }
    }
  )
})

test(
  'personal chat placement survives reload',
  async page => {
    const state: WorkspaceState = {
      revision: 1,
      selected: {},
      sessions: {},
      pendingViews: {},
      layout: {
        ...createDefaultPersonalLayout(),
        layoutMode: 'fullscreen',
        chatOpen: true,
        popupChatWidth: 520
      }
    }
    await page.route(`**/api/workspaces/${WORKSPACE}/state`, route =>
      route.fulfill({ json: state })
    )
    await page.route(`**/api/workspaces/${WORKSPACE}/state/layout`, async route => {
      expect(route.request().method()).toBe('PATCH')
      state.layout = { ...state.layout!, layoutMode: 'split' }
      state.revision++
      return route.fulfill({ json: state })
    })
    await page.goto(WORKSPACE_PAGE)
    const resize = page.getByRole('separator', { name: 'Resize chat popup' })
    await expect(resize).toHaveAttribute('aria-valuenow', '520')
    await takeSnapshot('saved popup')
    await page.getByRole('button', { name: 'Dock chat', exact: true }).click()
    await page.waitUntil('chat placement saved', () => state.layout?.layoutMode === 'split')
    await expect(page.getByRole('button', { name: 'Dock chat', exact: true })).not.toBeVisible()
    await page.goto('/')
    await page.goto(`/?reopen=1#/workspace/${WORKSPACE}`)
    await expect(page.getByRole('button', { name: 'Dock chat', exact: true })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Undock chat', exact: true })).toBeVisible()
    await takeSnapshot('saved docked chat')
  },
  { viewports: { '': { width: 1280, height: 900 } } }
)
