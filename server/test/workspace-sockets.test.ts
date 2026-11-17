import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function freePort() {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
  const port = server.port!
  server.stop(true)
  return port
}

async function connect(url: string) {
  const socket = new WebSocket(url)
  const messages: Record<string, unknown>[] = []
  socket.onmessage = event => messages.push(JSON.parse(String(event.data)))
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = reject
  })
  return { socket, messages }
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a socket message')
    await Bun.sleep(10)
  }
}

test('real socket routes isolate shared workspaces, personal state, harness events and navigation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moi-sockets-'))
  const port = freePort()
  const controlPort = freePort()
  for (const id of ['one', 'two', 'visitor']) {
    await Bun.write(
      join(root, id, '.moi/.workspace.json'),
      JSON.stringify({
        version: 2,
        ...(id === 'visitor' ? { remote: { user_id: 'alice', workspace_id: 'one' } } : {})
      })
    )
  }
  await Bun.write(
    join(root, 'workspaces.json'),
    JSON.stringify(
      ['one', 'two', 'visitor'].map(id => ({ id, path: join(root, id), harness: 'codex' }))
    )
  )
  const ready = Promise.withResolvers<void>()
  const navigation = Promise.withResolvers<void>()
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `
    await import('./server/web.ts');
    const { publishEvent } = await import('./server/events.ts');
    const { navigationRelay } = await import('./server/navigation-relay.ts');
    process.on('message', async message => {
      if (message.type === 'publish') publishEvent(message.event);
      if (message.type === 'navigate') {
        await navigationRelay.navigate('one', 'moi:/overview');
        process.send({ type: 'navigated' });
      }
    });
    process.send({ type: 'ready' });
  `
    ],
    {
      cwd: join(import.meta.dir, '../..'),
      env: {
        ...process.env,
        MOI_DATA_DIR: root,
        MOI_ENVIRONMENT: 'local',
        MOI_SECRET_BACKEND: 'file',
        PORT: String(port),
        MOI_CONTROL_PORT: String(controlPort)
      },
      stdout: 'ignore',
      stderr: 'pipe',
      ipc(message) {
        if (message.type === 'ready') ready.resolve()
        if (message.type === 'navigated') navigation.resolve()
      }
    }
  )
  const sockets: WebSocket[] = []
  try {
    await Promise.race([
      ready.promise,
      child.exited.then(async code => {
        throw new Error(`Server exited ${code}: ${await new Response(child.stderr).text()}`)
      }),
      Bun.sleep(10_000).then(() => {
        throw new Error('Server startup timed out')
      })
    ])
    const base = `ws://127.0.0.1:${port}`
    const connections: Awaited<ReturnType<typeof connect>>[] = []
    for (const path of [
      '/api/events',
      '/api/harness/events',
      '/api/workspaces/one/events',
      '/api/workspaces/two/events'
    ]) {
      const connection = await connect(base + path)
      sockets.push(connection.socket)
      connections.push(connection)
    }
    const [machine, harness, one, two] = connections
    one!.socket.send(JSON.stringify({ type: 'ping' }))
    await until(() => one!.messages.some(message => message.type === 'pong'))
    expect(harness!.messages).toContainEqual({ type: 'status_snapshot', sessions: [] })
    for (const connection of connections) connection.messages.length = 0
    const send = (event: object) => child.send({ type: 'publish', event })
    send({ type: 'state:changed', workspaceId: 'visitor', state: { revision: 4 } })
    send({ type: 'harness:updated', workspaceId: 'visitor', availability: { status: 'available' } })
    send({ type: 'view:updated', workspaceId: 'one', name: 'plan' })
    send({ type: 'view:updated', workspaceId: 'two', name: 'other' })
    await until(() => connections.every(connection => connection.messages.length > 0))
    expect(machine!.messages).toEqual([
      { type: 'state:changed', workspaceId: 'visitor', state: { revision: 4 } }
    ])
    expect(harness!.messages).toEqual([
      { type: 'harness:updated', workspaceId: 'visitor', availability: { status: 'available' } }
    ])
    expect(one!.messages).toEqual([{ type: 'view:updated', name: 'plan' }])
    expect(two!.messages).toEqual([{ type: 'view:updated', name: 'other' }])

    // Register on both transports. Only the machine channel can become a navigation target.
    const presence = JSON.stringify({
      type: 'navigation:presence',
      workspaceId: 'one',
      focused: true
    })
    machine!.socket.send(presence)
    one!.socket.send(presence)
    // A local HTTP round trip gives the server time to consume the frames.
    await fetch(`http://127.0.0.1:${port}/api/config`)
    child.send({ type: 'navigate' })
    await until(() => machine!.messages.some(message => message.type === 'navigation:request'))
    const request = machine!.messages.find(message => message.type === 'navigation:request')!
    machine!.socket.send(
      JSON.stringify({ type: 'navigation:result', requestId: request.requestId, ok: true })
    )
    await navigation.promise
    expect(one!.messages.some(message => message.type === 'navigation:request')).toBe(false)
    expect(two!.messages.some(message => message.type === 'navigation:request')).toBe(false)
    expect((await fetch(`http://127.0.0.1:${port}/api/workspaces/visitor/events`)).status).toBe(404)
  } finally {
    for (const socket of sockets) socket.close()
    child.kill('SIGTERM')
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
