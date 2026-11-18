// Runs inside package-test.dockerfile: real gateway + packed Moi, deterministic model HTTP boundary.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerMessage } from '../lib/types'

process.env.PATH = '/opt/openclaw/node_modules/.bin:' + process.env.PATH
const root = '/opt/moi'
const state = '/tmp/openclaw'
const workspace = '/tmp/openclaw-workspace'
const cli = join(root, 'node_modules/moi-computer/bin/moi.mjs')
const processes: ReturnType<typeof Bun.spawn>[] = []
let logs = ''
function start(args: string[], extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  processes.push(proc)
  for (const stream of [proc.stdout, proc.stderr])
    void (async () => {
      for await (const chunk of stream) logs += new TextDecoder().decode(chunk)
    })()
  return proc
}
async function until(check: () => boolean | Promise<boolean>, message: string, timeout = 60_000) {
  const end = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`${message}\n${logs}`)
    await Bun.sleep(100)
  }
}
const reply = 'The bundled OpenClaw integration works.'
const resumedReply = 'The resumed OpenClaw chat works.'
function hasReply(frames: ServerMessage[], text: string) {
  return frames.some(
    frame =>
      'kind' in frame &&
      frame.kind === 'turn' &&
      frame.turn.role === 'assistant' &&
      frame.turn.parts.some(part => part.type === 'text' && part.text === text)
  )
}
let modelRequests = 0
const model = Bun.serve({
  hostname: '127.0.0.1',
  port: 18080,
  async fetch(request) {
    assert.equal(new URL(request.url).pathname, '/v1/chat/completions')
    const body = (await request.json()) as { model: string; stream: boolean; messages: unknown[] }
    assert.equal(body.model, 'package-test')
    assert.ok(body.messages.length)
    modelRequests++
    const chunk = (delta: object, finish_reason: string | null = null) =>
      `data: ${JSON.stringify({ id: 'test-completion', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    return new Response(
      chunk({
        role: 'assistant',
        content: JSON.stringify(body.messages).includes('Test again after restart.')
          ? resumedReply
          : reply
      }) +
        chunk({}, 'stop') +
        'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } }
    )
  }
})
let socket: WebSocket | undefined
try {
  await mkdir(state, { recursive: true })
  await mkdir(workspace, { recursive: true })
  await Bun.write(
    join(state, 'openclaw.json'),
    JSON.stringify({
      gateway: {
        mode: 'local',
        bind: 'loopback',
        port: 18789,
        auth: { mode: 'token', token: 'isolated-package-test-token' }
      },
      agents: {
        defaults: { workspace, model: { primary: 'test/package-test' }, skipBootstrap: true }
      },
      models: {
        mode: 'merge',
        providers: {
          test: {
            baseUrl: 'http://127.0.0.1:18080/v1',
            apiKey: 'test-only',
            api: 'openai-completions',
            models: [
              {
                id: 'package-test',
                name: 'Package test',
                reasoning: false,
                input: ['text'],
                contextWindow: 128000,
                maxTokens: 1024,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
              }
            ]
          }
        }
      }
    })
  )
  const install = Bun.spawn(['bun', 'add', '--production', '--ignore-scripts', '/test/moi.tgz'], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit'
  })
  assert.equal(await install.exited, 0)
  assert.equal(await Bun.file(join(root, 'node_modules/openclaw/package.json')).exists(), false)
  assert.equal(
    await Bun.file(join(root, 'node_modules/moi-computer/server/cli.ts')).exists(),
    false
  )
  const gatewayArgs = ['/opt/openclaw/node_modules/.bin/openclaw', 'gateway', 'run']
  let gateway = start(gatewayArgs)
  await until(async () => {
    try {
      return (await fetch('http://127.0.0.1:18789/healthz')).ok
    } catch {
      return false
    }
  }, 'Gateway did not start')
  const upstreamProbe = start([
    '/opt/openclaw/node_modules/.bin/openclaw',
    'gateway',
    'call',
    'health'
  ])
  assert.equal(await upstreamProbe.exited, 0, logs)
  const identityPath = join(state, 'identity/device.json')
  const upstreamIdentity = (await Bun.file(identityPath).exists())
    ? await readFile(identityPath, 'utf8')
    : undefined
  start(['bun', '--no-install', cli, 'start'], {
    MOI_SERVER: '1',
    PORT: '13337',
    MOI_CONTROL_PORT: '13059'
  })
  const api = 'http://127.0.0.1:13337/api'
  await until(async () => {
    try {
      return (await fetch(`${api}/harnesses/status`)).ok
    } catch {
      return false
    }
  }, 'Moi did not start')
  const status = await (await fetch(`${api}/harnesses/status?refresh=true`)).json()
  console.log('harness status', JSON.stringify(status.openclaw))
  assert.equal(status.openclaw.availability.status, 'available')
  const discover = await (await fetch(`${api}/workspaces/discover`)).json()
  console.log('discovery', JSON.stringify(discover))
  assert.ok(JSON.stringify(discover).includes(workspace))
  const registered = await fetch(`${api}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: workspace, harness: 'openclaw' })
  })
  const registeredText = await registered.text()
  assert.equal(registered.status, 201, registeredText)
  const ws = JSON.parse(registeredText) as { id: string }
  console.log('workspace', ws.id)
  const frames: ServerMessage[] = []
  socket = new WebSocket('ws://127.0.0.1:13337/api/harness/events')
  socket.onmessage = event => {
    const frame = JSON.parse(String(event.data))
    frames.push(frame)
    // Keep successful runs short; print the transcript if an assertion fails.
  }
  await until(() => socket!.readyState === WebSocket.OPEN, 'Moi socket did not open')
  socket.send(
    JSON.stringify({
      type: 'chat',
      workspaceId: ws.id,
      sessionId: crypto.randomUUID(),
      isNew: true,
      content: 'Test the package integration.',
      model: 'test/package-test',
      stream: true
    })
  )
  await until(() => hasReply(frames, reply), 'Assistant reply did not arrive')
  assert.ok(modelRequests > 0)
  assert.ok(
    frames.some(
      frame =>
        'type' in frame &&
        frame.type === 'session:preview' &&
        frame.blocks.some(block => 'text' in block && block.text === reply)
    )
  )
  const identity = await readFile(identityPath, 'utf8')
  if (upstreamIdentity) assert.equal(identity, upstreamIdentity)
  const firstTurn = frames.find(frame => 'kind' in frame && frame.kind === 'turn')!
  assert.ok('sessionId' in firstTurn)
  gateway.kill('SIGTERM')
  await gateway.exited
  gateway = start(gatewayArgs)
  await until(async () => {
    try {
      return (await fetch('http://127.0.0.1:18789/healthz')).ok
    } catch {
      return false
    }
  }, 'Restarted gateway did not start')
  await until(async () => {
    const health = await (await fetch(`${api}/harnesses/status?refresh=true`)).json()
    return health.openclaw.availability.status === 'available'
  }, 'Gateway did not reconnect')
  const before = frames.length
  socket.send(
    JSON.stringify({
      type: 'chat',
      workspaceId: ws.id,
      sessionId: firstTurn.sessionId,
      isNew: false,
      content: 'Test again after restart.',
      model: 'test/package-test',
      stream: true
    })
  )
  await until(
    () => hasReply(frames.slice(before), resumedReply),
    'Reply after gateway restart did not arrive'
  )
  assert.equal(await readFile(join(state, 'identity/device.json'), 'utf8'), identity)
  console.log(
    JSON.stringify({
      passed: true,
      modelRequests,
      checks: [
        'production-only install',
        'gateway discovery',
        'workspace import',
        'chat through Moi WebSocket',
        'real gateway with local model fixture',
        'gateway restart and second chat',
        'persistent device identity'
      ]
    })
  )
} catch (error) {
  console.error(logs)
  throw error
} finally {
  socket?.close()
  for (const proc of processes) {
    if (proc.exitCode === null) proc.kill('SIGTERM')
  }
  await Promise.all(processes.map(proc => proc.exited))
  model.stop(true)
}
