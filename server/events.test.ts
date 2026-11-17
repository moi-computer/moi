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
  publishEvent({ type: 'view:updated', workspaceId: 'owner-board', name: 'plan' })
  publishEvent({ type: 'scratchpad:updated', workspaceId: 'another-board', origin: 'tab' })
  expect(sent).toEqual([
    { topic: 'workspace-events:owner-board', event: { type: 'view:updated', name: 'plan' } },
    {
      topic: 'workspace-events:another-board',
      event: { type: 'scratchpad:updated', origin: 'tab' }
    }
  ])
})

test('personal state, environment and settings stay on the machine event channel', () => {
  const events = [
    {
      type: 'state:changed',
      workspaceId: 'visitor-board',
      state: { selected: { overview: 'private-chat' } }
    },
    { type: 'env:updated', workspaceId: 'visitor-board' },
    { type: 'settings:updated', settings: { showOnboarding: false } },
    { type: 'workspaces-list:updated' }
  ]
  for (const event of events) publishEvent(event)
  expect(sent).toEqual(events.map(event => ({ topic: 'events', event })))
})

test('harness changes reach the app-wide harness connection', () => {
  const events = [
    { type: 'harness-status:changed', harness: 'codex', status: {} },
    { type: 'harness:updated', workspaceId: 'visitor-board', availability: {} },
    { type: 'workspace-harness:switched', workspaceId: 'visitor-board', harness: 'codex' }
  ]
  for (const event of events) publishEvent(event)
  expect(sent).toEqual(events.map(event => ({ topic: 'harness-events', event })))
})

test('an unscoped refresh reaches open owner workspaces; metadata also refreshes the local list', () => {
  publishEvent({ type: 'applets:refresh', only: 'views' })
  publishEvent({ type: 'theme:updated', workspaceId: 'owner-board', origin: 'tab' })
  expect(sent).toEqual([
    { topic: 'workspace-refresh', event: { type: 'applets:refresh', only: 'views' } },
    { topic: 'workspace-events:owner-board', event: { type: 'theme:updated', origin: 'tab' } },
    { topic: 'events', event: { type: 'workspaces-list:updated' } }
  ])
})
