import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createPrivateKey } from 'node:crypto'
import { join } from 'node:path'
import { deviceAuthHost } from './device-auth'

const directories: string[] = []
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'moi-device-test-'))
  directories.push(directory)
  return { directory, host: deviceAuthHost({ OPENCLAW_STATE_DIR: directory }) }
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test('reuses the OpenClaw identity and never overwrites damaged keys', () => {
  const { directory, host } = setup()
  const identity = host.loadOrCreateDeviceIdentity!()!
  const path = join(directory, 'identity/device.json')
  const original = readFileSync(path, 'utf8')
  expect(deviceAuthHost({ OPENCLAW_STATE_DIR: directory }).loadOrCreateDeviceIdentity!()).toEqual(
    identity
  )
  expect(readFileSync(path, 'utf8')).toBe(original)
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  writeFileSync(path, '{broken')
  expect(() => host.loadOrCreateDeviceIdentity!()).toThrow()
  expect(readFileSync(path, 'utf8')).toBe('{broken')
})

test('loads legacy raw keys from the same OpenClaw identity', () => {
  const { directory, host } = setup()
  const identity = host.loadOrCreateDeviceIdentity!()!
  const key = createPrivateKey(identity.privateKeyPem).export({ format: 'jwk' })
  writeFileSync(
    join(directory, 'identity/device.json'),
    JSON.stringify({ deviceId: identity.deviceId, publicKey: key.x, privateKey: key.d })
  )
  const loaded = host.loadOrCreateDeviceIdentity!()!
  expect(loaded.deviceId).toBe(identity.deviceId)
  expect(loaded.publicKeyPem).toBe(identity.publicKeyPem)
  expect(loaded.privateKeyPem).toBe(identity.privateKeyPem)
})

test('token updates compare before writing and preserve other roles', async () => {
  const { host } = setup()
  const base = {
    deviceId: host.loadOrCreateDeviceIdentity!()!.deviceId,
    role: 'operator',
    scopes: ['operator.read']
  }
  await host.storeDeviceAuthToken!({ ...base, token: 'first', expectedToken: null })
  await Promise.all([
    host.storeDeviceAuthToken!({ ...base, token: 'second', expectedToken: 'first' }),
    host.storeDeviceAuthToken!({ ...base, role: 'node', token: 'node-token' })
  ])
  await host.storeDeviceAuthToken!({ ...base, token: 'stale', expectedToken: 'first' })
  await host.clearDeviceAuthToken!({ ...base, expectedToken: 'first' })
  expect((await host.loadDeviceAuthToken!(base))?.token).toBe('second')
  await host.clearDeviceAuthToken!({ ...base, expectedToken: 'second' })
  expect(await host.loadDeviceAuthToken!(base)).toBeNull()
  expect((await host.loadDeviceAuthToken!({ ...base, role: 'node' }))?.token).toBe('node-token')
})

test('a revoked connection cannot persist credentials', async () => {
  const { host } = setup()
  const base = {
    deviceId: host.loadOrCreateDeviceIdentity!()!.deviceId,
    role: 'operator',
    scopes: []
  }
  await expect(
    host.storeDeviceAuthToken!({ ...base, token: 'stale', signal: AbortSignal.abort() })
  ).rejects.toThrow()
  let checks = 0
  await expect(
    host.storeDeviceAuthToken!({
      ...base,
      token: 'stale',
      assertCurrent: () => {
        if (++checks > 1) throw new Error('revoked')
      }
    })
  ).rejects.toThrow('revoked')
  expect(await host.loadDeviceAuthToken!(base)).toBeNull()
})
