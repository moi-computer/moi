import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { clientAppConfig, initializeAppConfig, resetAppConfig } from '../app-config'
import { getCollabReferencePath } from './config'
import { collabSkillReferencePath } from './skill'

let workspacePath: string
const envKeys = ['HOST', 'MOI_COLLAB', 'MOI_DEMO', 'MOI_DEV', 'MOI_ENVIRONMENT']
let savedEnv: Record<string, string | undefined>
beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'moi-collab-config-'))
  savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  for (const key of envKeys) delete process.env[key]
  process.env.MOI_ENVIRONMENT = 'local'
  resetAppConfig()
})
afterEach(async () => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  resetAppConfig()
  await rm(workspacePath, { recursive: true, force: true })
})

describe('collab startup configuration', () => {
  test('local dev presence is limited to standalone loopback servers', () => {
    expect(clientAppConfig().localDevPresence).toBeUndefined()
    process.env.MOI_DEV = '1'
    process.env.HOST = '127.0.0.1'
    expect(clientAppConfig().localDevPresence).toBe(true)
    process.env.HOST = '0.0.0.0'
    expect(clientAppConfig().localDevPresence).toBeUndefined()
    process.env.HOST = '127.0.0.1'
    process.env.MOI_ENVIRONMENT = 'cloud'
    initializeAppConfig()
    expect(clientAppConfig().localDevPresence).toBeUndefined()
  })

  test('local dev and legacy workspace flags keep cloud instructions hidden', async () => {
    process.env.MOI_DEV = '1'
    await Bun.write(
      join(workspacePath, '.moi', '.workspace.json'),
      JSON.stringify({ version: 1, experimental: { collab: true } })
    )
    expect(clientAppConfig().environment === 'cloud').toBe(false)
    expect(await getCollabReferencePath(workspacePath)).toBeUndefined()
  })

  test('hides installed collaboration instructions while runtime is disabled', async () => {
    const referencePath = collabSkillReferencePath(workspacePath)
    await Bun.write(referencePath, '# Collab')
    expect(await getCollabReferencePath(workspacePath)).toBeUndefined()
    process.env.MOI_ENVIRONMENT = 'cloud'
    initializeAppConfig()
    expect(await getCollabReferencePath(workspacePath)).toBe(referencePath)
  })
})
