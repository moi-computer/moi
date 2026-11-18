import type { ServerEvent } from '@/lib/events'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { publishEvent, setEventServer } from './events'

const sent: { topic: string; event: unknown }[] = []
beforeEach(() =>
  setEventServer({ publish: (topic, data) => sent.push({ topic, event: JSON.parse(data) }) })
)
afterEach(() => {
  sent.length = 0
  setEventServer({ publish: () => {} })
})

test('shared updates are scoped to their owner workspace without repeating its ID', () => {
  publishEvent({ type: 'view:changed', workspaceId: 'owner-board', name: 'plan' })
  publishEvent({ type: 'scratchpad:changed', workspaceId: 'another-board', origin: 'tab' })
  expect(sent).toEqual([
    { topic: 'workspace-events:owner-board', event: { type: 'view:changed', name: 'plan' } },
    {
      topic: 'workspace-events:another-board',
      event: { type: 'scratchpad:changed', origin: 'tab' }
    }
  ])
})

test('personal state, environment and settings stay on the machine event channel', () => {
  const events: ServerEvent[] = [
    {
      type: 'personal-state:changed',
      workspaceId: 'visitor-board',
      state: { revision: 1, selected: { overview: 'private-chat' }, sessions: {}, pendingViews: {} }
    },
    { type: 'env:changed', workspaceId: 'visitor-board' },
    { type: 'app-settings:changed', settings: { showOnboarding: false, autoUpdateSkills: true } },
    { type: 'workspaces-list:changed' }
  ]
  for (const event of events) publishEvent(event)
  expect(sent).toEqual(events.map(event => ({ topic: 'events', event })))
})

test('harness changes reach the app-wide harness connection', () => {
  const events: ServerEvent[] = [
    { type: 'harness:changed' },
    { type: 'workspace-harness:switched', workspaceId: 'visitor-board', harness: 'codex' }
  ]
  for (const event of events) publishEvent(event)
  expect(sent).toEqual(events.map(event => ({ topic: 'harness-events', event })))
})

test('refreshes stay workspace-scoped and configuration changes refresh the local list', () => {
  publishEvent({ type: 'applets:refresh', workspaceId: 'owner-board', only: 'views' })
  publishEvent({ type: 'workspace-config:changed', workspaceId: 'owner-board', origin: 'tab' })
  expect(sent).toEqual([
    {
      topic: 'events',
      event: { type: 'applets:refresh', workspaceId: 'owner-board', only: 'views' }
    },
    {
      topic: 'workspace-events:owner-board',
      event: { type: 'workspace-config:changed', origin: 'tab' }
    },
    { topic: 'events', event: { type: 'workspaces-list:changed' } }
  ])
})
