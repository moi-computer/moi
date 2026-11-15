import { afterEach, expect, test } from 'bun:test'
import type { ClientAppConfig } from '@/lib/types'

import { homePath, loadAppConfig } from './app-config'

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch)
  else Reflect.deleteProperty(globalThis, 'fetch')
})

test('startup receives confirmed config while a failed refresh cannot enable a local profile from cached config', async () => {
  const config: ClientAppConfig = {
    environment: 'local',
    demo: false,
    demoInstallUrl: 'https://moi.computer'
  }
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => Response.json(config)
  })
  expect(await loadAppConfig()).toEqual(config)
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => Response.json({}, { status: 503 })
  })
  expect(await loadAppConfig()).toBeUndefined()
})

test('home lives at /demo only when the server runs the demo', async () => {
  const serve = (demo: boolean) =>
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () =>
        Response.json({
          environment: 'cloud',
          demo,
          demoInstallUrl: 'https://moi.computer'
        } satisfies ClientAppConfig)
    })
  serve(true)
  await loadAppConfig()
  expect(homePath()).toBe('/demo')
  serve(false)
  await loadAppConfig()
  expect(homePath()).toBe('/')
})
