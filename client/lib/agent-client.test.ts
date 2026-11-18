import { expect, test } from 'bun:test'
import { agentClientLabel, agentIcon } from './agent-client'

test('custom client ids get a readable label and the default agent avatar', () => {
  expect(agentClientLabel('town-assistant')).toBe('Town Assistant')
  expect(agentIcon('town-assistant')).toBeUndefined()
  expect(agentClientLabel('grok-bot')).toBe('Grok Bot')
  expect(agentIcon('grok-bot')).toBeTruthy()
  for (const client of [undefined, '', 'other', 'unknown', 'Old Client'])
    expect(agentClientLabel(client)).toBe('Other')
})
