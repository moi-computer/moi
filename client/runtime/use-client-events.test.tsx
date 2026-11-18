import { useWorkspaceSocket } from '@/client/features/workspace/use-workspace-socket'
import { seedWorkspaceInfo } from '@/client/features/workspace/workspace-test-utils'
import { workspaceKeys } from '@/client/api/workspace-keys'
import { queryClient } from '@/client/api/query-client'
import type { ClientEvent } from '@/lib/events'
import { afterEach, expect, test } from 'bun:test'
import { act, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'

import { AppProvider as EventsProvider } from '@/client/app/app-provider'

import { useClientEvent, useWorkspaceScopedEvent } from './use-client-events'
import { AppEventsClient } from './app-events'

type AppProviderProps = { children: ReactNode }
function AppProvider({ children }: AppProviderProps) {
  const [client] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={client}>
      <EventsProvider>{children}</EventsProvider>
    </QueryClientProvider>
  )
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 0
  closed = false
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
    this.readyState = 3
    this.onclose?.()
  }
}

function HomeShell() {
  useClientEvent(() => {})
  return <div>home</div>
}

function WorkspaceShell() {
  useClientEvent(() => {})
  return <div>workspace</div>
}

let cleanup = async () => {}
afterEach(() => cleanup())

function installDom() {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true })
  const globals = {
    window,
    document,
    location: {
      protocol: 'http:',
      host: 'localhost:13337',
      pathname: '/workspace/visitor-board/overview'
    },
    HTMLElement: window.HTMLElement,
    WebSocket: FakeWebSocket,
    IS_REACT_ACT_ENVIRONMENT: true
  }
  const descriptors = new Map(
    Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  )
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  const root = createRoot(document.getElementById('root')!)
  cleanup = async () => {
    await act(async () => root.unmount())
    FakeWebSocket.instances = []
    for (const [key, value] of descriptors) {
      if (value) Object.defineProperty(globalThis, key, value)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
  return { root, document }
}

// Switching routes unmounts one shell and mounts the other in a single commit,
// so for an instant nothing is subscribed. The socket belongs to the app, not
// to its subscribers, so that must not reconnect.
test('a route switch keeps the one events socket open', async () => {
  const { root, document } = installDom()
  await act(async () =>
    root.render(
      <AppProvider>
        <HomeShell />
      </AppProvider>
    )
  )
  expect(FakeWebSocket.instances.length).toBe(1)
  await act(async () => FakeWebSocket.instances[0]!.open())

  await act(async () =>
    root.render(
      <AppProvider>
        <WorkspaceShell />
      </AppProvider>
    )
  )
  expect(document.body.textContent).toContain('workspace')
  expect(FakeWebSocket.instances.length).toBe(1)
  expect(FakeWebSocket.instances[0]!.closed).toBe(false)
})

test('unmounting the app closes the socket for good', async () => {
  const { root } = installDom()
  await act(async () =>
    root.render(
      <AppProvider>
        <HomeShell />
      </AppProvider>
    )
  )
  await act(async () => FakeWebSocket.instances[0]!.open())
  await act(async () => root.unmount())
  expect(FakeWebSocket.instances[0]!.closed).toBe(true)
  await Bun.sleep(1100)
  expect(FakeWebSocket.instances.length).toBe(1)
})

test('components outside the app open no socket', async () => {
  const { root, document } = installDom()
  await act(async () => root.render(<HomeShell />))
  expect(document.body.textContent).toContain('home')
  expect(FakeWebSocket.instances.length).toBe(0)
})

test('a dropped socket reopens on its own and delivers events again', async () => {
  installDom()
  const client = new AppEventsClient('ws://localhost/api/events', {
    reconnectBaseDelayMs: 1
  })
  const received: string[] = []
  client.subscribe(event => received.push(event.type))
  client.connect()
  FakeWebSocket.instances[0]!.open()

  FakeWebSocket.instances[0]!.close()
  await Bun.sleep(10)
  expect(FakeWebSocket.instances.length).toBe(2)
  FakeWebSocket.instances[1]!.open()
  FakeWebSocket.instances[1]!.onmessage?.({
    data: JSON.stringify({ type: 'workspace-config:changed' })
  })
  expect(received).toEqual(['app:connected', 'app:connected', 'workspace-config:changed'])
  client.close()
})

test('scoped listeners isolate workspaces and share app connection events', async () => {
  const { root } = installDom()
  const received: string[] = []
  function Listener({ id }: { id: string }) {
    useWorkspaceScopedEvent(id, event => received.push(`${id}:${event.type}`))
    return null
  }
  await act(async () =>
    root.render(
      <AppProvider>
        <Listener id="one" />
        <Listener id="two" />
      </AppProvider>
    )
  )
  const socket = FakeWebSocket.instances[0]!
  const send = (event: object) => socket.onmessage?.({ data: JSON.stringify(event) })
  send({ type: 'widget:changed', workspaceId: 'one', name: 'counter' })
  send({ type: 'workspace-config:changed', workspaceId: 'two' })
  send({ type: 'applets:refresh', workspaceId: 'one' })
  expect(received).toEqual([
    'one:widget:changed',
    'two:workspace-config:changed',
    'one:applets:refresh'
  ])
  received.length = 0
  send({ type: 'app:connected' })
  expect(received).toEqual(['one:app:connected', 'two:app:connected'])
})

test('owner events use the visitor cache ID while personal state and navigation use the machine socket', async () => {
  const { root } = installDom()
  const priorCleanup = cleanup
  cleanup = async () => {
    await priorCleanup()
    queryClient.clear()
  }
  seedWorkspaceInfo('visitor-board', { user_id: 'alice', workspace_id: 'board' })
  seedWorkspaceInfo('alice:board')
  const received: ClientEvent[] = []
  function Listener() {
    useWorkspaceSocket('visitor-board')
    useClientEvent(event => received.push(event))
    return null
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <EventsProvider>
          <Listener />
        </EventsProvider>
      </QueryClientProvider>
    )
  )
  const machine = FakeWebSocket.instances.find(socket => socket.url.endsWith('/api/events'))!
  const owner = FakeWebSocket.instances.find(socket =>
    socket.url.endsWith('/api/workspaces/alice:board/events')
  )!
  expect(FakeWebSocket.instances).toHaveLength(2)
  machine.open()
  owner.open()
  expect(machine.sent.map(message => JSON.parse(message).type)).toEqual(['navigation:presence'])
  expect(owner.sent).toEqual([])
  received.length = 0
  // A payload cannot override the identity bound to this connection.
  owner.onmessage?.({
    data: JSON.stringify({ type: 'view:changed', name: 'plan', workspaceId: 'another' })
  })
  owner.onmessage?.({
    data: JSON.stringify({
      type: 'personal-state:changed',
      workspaceId: 'visitor-board',
      state: {}
    })
  })
  owner.onmessage?.({
    data: JSON.stringify({
      type: 'navigation:request',
      workspaceId: 'visitor-board',
      href: '/wrong'
    })
  })
  machine.onmessage?.({
    data: JSON.stringify({
      type: 'personal-state:changed',
      workspaceId: 'visitor-board',
      state: { revision: 3, selected: {}, sessions: {}, pendingViews: {} }
    })
  })
  machine.onmessage?.({
    data: JSON.stringify({
      type: 'navigation:request',
      workspaceId: 'visitor-board',
      href: '/right',
      requestId: 'local-request'
    })
  })
  expect(received).toEqual([
    { type: 'view:changed', name: 'plan', workspaceId: 'visitor-board' },
    {
      type: 'personal-state:changed',
      workspaceId: 'visitor-board',
      state: { revision: 3, selected: {}, sessions: {}, pendingViews: {} }
    },
    {
      type: 'navigation:request',
      workspaceId: 'visitor-board',
      href: '/right',
      requestId: 'local-request'
    }
  ])
  queryClient.setQueryData(workspaceKeys.layout('alice:board'), { name: 'Old' })
  expect(queryClient.getQueryState(workspaceKeys.layout('alice:board'))?.isInvalidated).toBe(false)
  owner.onmessage?.({ data: JSON.stringify({ type: 'workspace-config:changed' }) })
  expect(queryClient.getQueryState(workspaceKeys.layout('alice:board'))?.isInvalidated).toBe(true)
  owner.close()
  await Bun.sleep(550)
  const reconnected = FakeWebSocket.instances.at(-1)!
  expect(reconnected.url).toBe(owner.url)
  received.length = 0
  reconnected.open()
  expect(received).toEqual([{ type: 'workspace:connected', workspaceId: 'visitor-board' }])
  expect(machine.closed).toBe(false)
})
