import type { DeviceIdentity, GatewayClientHostDeps } from '@openclaw/gateway-client'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { lock } from 'proper-lockfile'
import { z } from 'zod'

const identitySchema = z.object({
  version: z.literal(1),
  deviceId: z.string(),
  publicKeyPem: z.string(),
  privateKeyPem: z.string()
})
const tokenSchema = z.object({
  version: z.literal(1),
  deviceId: z.string(),
  tokens: z.record(
    z.string(),
    z.object({
      token: z.string(),
      role: z.string(),
      scopes: z.array(z.string()),
      updatedAtMs: z.number()
    })
  )
})

function rawPublicKey(pem: string): Buffer {
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Expected an Ed25519 device key')
  return Buffer.from(key.export({ format: 'jwk' }).x!, 'base64url')
}

function readIdentity(path: string): DeviceIdentity {
  const saved: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const legacy = z
    .object({ deviceId: z.string(), publicKey: z.string(), privateKey: z.string() })
    .safeParse(saved)
  const identity = legacy.success
    ? {
        deviceId: legacy.data.deviceId,
        publicKeyPem: createPublicKey({
          key: { kty: 'OKP', crv: 'Ed25519', x: legacy.data.publicKey },
          format: 'jwk'
        })
          .export({ type: 'spki', format: 'pem' })
          .toString(),
        privateKeyPem: createPrivateKey({
          key: { kty: 'OKP', crv: 'Ed25519', x: legacy.data.publicKey, d: legacy.data.privateKey },
          format: 'jwk'
        })
          .export({ type: 'pkcs8', format: 'pem' })
          .toString()
      }
    : identitySchema.parse(saved)
  const probe = Buffer.from('openclaw-device-identity-self-check')
  if (!verify(null, probe, identity.publicKeyPem, sign(null, probe, identity.privateKeyPem)))
    throw new Error('OpenClaw device keys do not match')
  return {
    ...identity,
    deviceId: createHash('sha256').update(rawPublicKey(identity.publicKeyPem)).digest('hex')
  }
}

function loadIdentity(directory: string): DeviceIdentity {
  const path = join(directory, 'device.json')
  if (existsSync(path)) return readIdentity(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const identity = {
    version: 1,
    deviceId: createHash('sha256').update(rawPublicKey(publicKeyPem)).digest('hex'),
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    createdAtMs: Date.now()
  }
  const temp = `${path}.${crypto.randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(identity), { mode: 0o600, flag: 'wx' })
  try {
    // Another process may have created its identity while our key was generated.
    linkSync(temp, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    unlinkSync(temp)
  }
  return readIdentity(path)
}

export function deviceAuthHost(env: NodeJS.ProcessEnv = process.env): GatewayClientHostDeps {
  const osHome = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir()
  const expand = (path: string, home: string) => resolve(path.replace(/^~(?=$|[\\/])/, home))
  const home = expand(env.OPENCLAW_HOME?.trim() || osHome, osHome)
  const state = env.OPENCLAW_STATE_DIR?.trim()
  const defaultState = join(home, '.openclaw')
  const legacyState = join(home, '.clawdbot')
  const directory = join(
    state
      ? expand(state, home)
      : !existsSync(defaultState) && existsSync(legacyState)
        ? legacyState
        : defaultState,
    'identity'
  )
  const path = join(directory, 'device-auth.json')
  function readTokens(deviceId: string) {
    if (!existsSync(path))
      return { version: 1 as const, deviceId, tokens: {} } satisfies z.infer<typeof tokenSchema>
    const saved = tokenSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    return saved.deviceId === deviceId ? saved : { version: 1 as const, deviceId, tokens: {} }
  }
  type Operation = {
    deviceId: string
    role: string
    signal?: AbortSignal
    assertCurrent?: () => void
    expectedToken?: string | null
  }
  async function mutate(
    op: Operation,
    update: (tokens: z.infer<typeof tokenSchema>['tokens']) => void
  ) {
    const assertCurrent = () => {
      op.signal?.throwIfAborted()
      op.assertCurrent?.()
    }
    assertCurrent()
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    let compromised: Error | undefined
    const release = await lock(path, {
      realpath: false,
      retries: { retries: 20, minTimeout: 10, maxTimeout: 100 },
      onCompromised: error => {
        compromised = error
      }
    })
    try {
      assertCurrent()
      if (compromised) throw compromised
      const saved = readTokens(op.deviceId)
      const previous = saved.tokens[op.role]?.token
      if (op.expectedToken !== undefined && (previous ?? null) !== op.expectedToken) return
      update(saved.tokens)
      const temp = `${path}.${crypto.randomUUID()}.tmp`
      try {
        writeFileSync(temp, JSON.stringify(saved), { mode: 0o600, flag: 'wx' })
        assertCurrent()
        renameSync(temp, path)
      } finally {
        if (existsSync(temp)) unlinkSync(temp)
      }
    } finally {
      if (!compromised) await release()
    }
  }
  return {
    loadOrCreateDeviceIdentity: () => loadIdentity(directory),
    signDevicePayload: (key, payload) =>
      sign(null, Buffer.from(payload), key).toString('base64url'),
    publicKeyRawBase64UrlFromPem: key => rawPublicKey(key).toString('base64url'),
    loadDeviceAuthToken: op => {
      op.signal?.throwIfAborted()
      op.assertCurrent?.()
      return readTokens(op.deviceId).tokens[op.role] ?? null
    },
    storeDeviceAuthToken: op =>
      mutate(op, tokens => {
        tokens[op.role] = {
          token: op.token,
          role: op.role,
          scopes: op.scopes,
          updatedAtMs: Date.now()
        }
      }),
    clearDeviceAuthToken: op =>
      mutate(op, tokens => {
        delete tokens[op.role]
      })
  }
}
