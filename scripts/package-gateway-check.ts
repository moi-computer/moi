// Copied outside the checkout by test-package.ts so imports cannot find dev dependencies.
import type { GatewayClient as Client } from 'openclaw/plugin-sdk/gateway-runtime'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, verify } from 'node:crypto'
const state = mkdtempSync(join(tmpdir(), 'moi-gateway-state-'))
process.env.OPENCLAW_STATE_DIR = state
process.env.OPENCLAW_HOME = state
process.env.OPENCLAW_LOG_LEVEL = 'silent'
const { GatewayClient } = (await import(process.argv[2]!)) as { GatewayClient: typeof Client }
let connections = 0
let socket: Bun.ServerWebSocket<undefined> | undefined
let helloCount = 0
const events: string[] = []
const errors: string[] = []
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req, server) {
    if (server.upgrade(req)) return
    return new Response('upgrade required', { status: 400 })
  },
  websocket: {
    open(ws) {
      socket = ws
      connections++
      ws.send(
        JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'test-nonce' }
        })
      )
    },
    message(ws, raw) {
      const frame = JSON.parse(String(raw))
      if (frame.method === 'connect') {
        const p = frame.params
        assert.equal(p.auth.token, 'test-token')
        assert.equal(p.minProtocol, 4)
        assert.equal(p.client.version, process.argv[3])
        assert.ok(p.caps.includes('tool-events'))
        assert.equal(p.device.nonce, 'test-nonce')
        const norm = (s = '') => s.trim().toLowerCase()
        const payload = [
          'v3',
          p.device.id,
          p.client.id,
          p.client.mode,
          p.role,
          p.scopes.join(','),
          String(p.device.signedAt),
          p.auth.token,
          p.device.nonce,
          norm(p.client.platform),
          norm(p.client.deviceFamily)
        ].join('|')
        const key = createPublicKey({
          key: Buffer.concat([
            Buffer.from('302a300506032b6570032100', 'hex'),
            Buffer.from(p.device.publicKey, 'base64url')
          ]),
          type: 'spki',
          format: 'der'
        })
        assert.ok(
          verify(null, Buffer.from(payload), key, Buffer.from(p.device.signature, 'base64url'))
        )
        ws.send(
          JSON.stringify({
            type: 'res',
            id: frame.id,
            ok: true,
            payload: {
              type: 'hello-ok',
              protocol: 4,
              server: { version: '2026.7.1' },
              policy: { tickIntervalMs: 30000 },
              auth: { deviceToken: 'test-device-token', role: 'operator', scopes: p.scopes }
            }
          })
        )
      } else if (frame.method === 'sessions.list') {
        ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { sessions: [] } }))
        ws.send(
          JSON.stringify({ type: 'event', event: 'session.message', payload: { text: 'probe' } })
        )
      } else if (frame.method === 'fail') {
        ws.send(
          JSON.stringify({
            type: 'res',
            id: frame.id,
            ok: false,
            error: { code: 'TEST_ERROR', message: 'expected failure' }
          })
        )
      }
    }
  }
})
const client = new GatewayClient({
  url: `ws://127.0.0.1:${server.port}`,
  token: 'test-token',
  role: 'operator',
  scopes: ['operator.admin', 'operator.read', 'operator.write'],
  caps: ['tool-events'],
  minProtocol: 4,
  maxProtocol: 4,
  requestTimeoutMs: 100,
  onHelloOk: () => helloCount++,
  onEvent: e => events.push(e.event),
  onConnectError: e => errors.push(String(e))
})
async function until(check: () => boolean) {
  const end = Date.now() + 5000
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out: ' + errors.join(';'))
    await Bun.sleep(10)
  }
}
try {
  client.start()
  await until(() => helloCount === 1)
  assert.deepEqual(await client.request('sessions.list', {}), { sessions: [] })
  await until(() => events.includes('session.message'))
  await assert.rejects(client.request('fail', {}), /expected failure/)
  await assert.rejects(client.request('hang', {}), /timeout/)
  socket!.close(1012, 'restart')
  await until(() => helloCount === 2)
  assert.deepEqual(await client.request('sessions.list', {}), { sessions: [] })
  assert.ok(existsSync(join(state, 'identity', 'device.json')))
  assert.ok(existsSync(join(state, 'identity', 'device-auth.json')))
  assert.equal(errors.length, 0)
  console.log(
    JSON.stringify({
      passed: true,
      connections,
      checks: [
        'signed challenge handshake',
        'token auth',
        'identity and device token persistence',
        'RPC success',
        'RPC error',
        'RPC timeout',
        'event delivery',
        'reconnect and subsequent RPC'
      ],
      state
    })
  )
} finally {
  client.stop()
  server.stop(true)
  rmSync(state, { recursive: true, force: true })
}
