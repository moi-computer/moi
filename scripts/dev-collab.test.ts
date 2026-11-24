import { expect, test } from 'bun:test'
import { once } from 'node:events'
import { members, participantHost } from './dev-collab'

test('participant URLs keep distinct identities, a stable directory and the same workspace socket', async () => {
  const moi = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname.endsWith('/events') && server.upgrade(request)) return
      return new Response('<script id="moi-start" type="module"></script>', {
        headers: { 'content-type': 'text/html' }
      })
    },
    websocket: {
      open(socket) {
        socket.subscribe('workspace')
      },
      message(socket, message) {
        socket.publish('workspace', message)
      }
    }
  })
  const hosts = members.map(viewer => participantHost(viewer, moi.port!))
  const sockets: WebSocket[] = []
  try {
    for (const [index, host] of hosts.entries()) {
      host.listen(0, '127.0.0.1')
      await once(host, 'listening')
      const address = host.address()
      if (!address || typeof address === 'string') throw new Error('Expected a TCP port')
      const origin = `http://127.0.0.1:${address.port}`
      const me = await (await fetch(origin + '/cloud/api/me')).json()
      expect(me.name).toBe(index === 0 ? 'Anna' : 'Boris')
      const html = await (await fetch(origin + '/workspace/collab')).text()
      const bootstrap = html.split('<script id="moi-start"')[0]
      expect(bootstrap).toContain(`identity.set(${JSON.stringify(me)})`)
      expect(bootstrap).toContain('"id":"anna"')
      expect(bootstrap).toContain('"id":"boris"')
      const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/workspaces/collab/events')
      sockets.push(socket)
      await once(socket, 'open')
    }
    const received = once(sockets[1]!, 'message')
    sockets[0]!.send('Anna is editing')
    expect((await received)[0].data).toBe('Anna is editing')
  } finally {
    for (const socket of sockets) socket.close()
    for (const host of hosts) host.close()
    moi.stop(true)
  }
})
