import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { workspaceKeys } from '@/client/api/workspace-keys'
import {
  usePinnedSession,
  useSelectedSession
} from '@/client/features/chat/sessions/use-selected-session'
import { AppContext } from '@/client/runtime/app-context'
import { AppEventsClient } from '@/client/runtime/app-events'
import type { ClientEvent } from '@/client/runtime/use-client-events'
import type { CompiledView, WorkspaceState } from '@/lib/types'
import { useViewActions } from '@/client/features/views/use-view-actions'
import { useViews } from '@/client/features/views/api'
import { Workspace } from './workspace-context'
import { WorkspaceLayoutContext } from './workspace-layout-context'
import { createDefaultWorkspaceLayout } from '@/lib/workspace-layout'
import { useWorkspaceState, useWorkspaceStateSync, useWorkspaceStateWrite } from './workspace-state'

const WORKSPACE_ID = 'abc'

type Request = { method: string; url: string; body: unknown }

function workspaceState(patch: Partial<WorkspaceState> = {}): WorkspaceState {
  return { revision: 1, selected: {}, sessions: {}, pendingViews: {}, ...patch }
}

let cleanup: () => Promise<void> = async () => {}
afterEach(() => cleanup())

// Mounts `children` with a query client seeded with `initial`, a fake events
// socket, and a fake server that answers every request with `respond`.
function mount(initial: WorkspaceState, respond: (request: Request) => Promise<unknown>) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
  const globals = { window, document, IS_REACT_ACT_ENVIRONMENT: true }
  const descriptors = new Map(
    Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  notifyManager.setNotifyFunction(callback => {
    act(callback)
  })

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(workspaceKeys.state(WORKSPACE_ID), initial)
  const requests: Request[] = []
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = {
          method: init?.method ?? 'GET',
          url: String(input),
          body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
        }
        requests.push(request)
        return Response.json(await respond(request))
      },
      { preconnect: fetch.preconnect }
    )
  )
  const events = new AppEventsClient('ws://localhost/api/events')
  const root = createRoot(document.getElementById('root')!)
  cleanup = async () => {
    await act(async () => {
      root.unmount()
      queryClient.clear()
      await Bun.sleep(0)
    })
    notifyManager.setNotifyFunction(callback => callback())
    fetchSpy.mockRestore()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
  const render = (children: React.ReactNode) =>
    act(async () => {
      root.render(
        <Workspace id={WORKSPACE_ID}>
          <AppContext value={{ events }}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          </AppContext>
        </Workspace>
      )
    })
  return {
    queryClient,
    requests,
    render,
    cached: () => queryClient.getQueryData<WorkspaceState>(workspaceKeys.state(WORKSPACE_ID)),
    emit: (event: ClientEvent) =>
      act(() => {
        events.emit(event)
      }),
    settle: () =>
      act(async () => {
        await Bun.sleep(10)
      })
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => (resolve = done))
  return { promise, resolve }
}

test.each(['owner first', 'personal first'])(
  'a finished view stays visible with %s and a stale list reply',
  async order => {
    const reply = deferred<{ views: CompiledView[] }>()
    const fixture = mount(
      workspaceState({
        pendingViews: { board: { status: 'submitted', requirements: 'Build a board' } }
      }),
      () => reply.promise
    )
    const queryKey = workspaceKeys.views(WORKSPACE_ID)
    fixture.queryClient.setQueryData(queryKey, [])
    const rendered: string[][] = []
    function Probe() {
      useWorkspaceStateSync()
      const { data } = useViews(WORKSPACE_ID)
      useLayoutEffect(() => {
        rendered.push(data?.map(view => `${view.id}:${view.status}`) ?? [])
      }, [data])
      return null
    }
    await fixture.render(
      <WorkspaceLayoutContext.Provider
        value={{
          layout: createDefaultWorkspaceLayout(),
          setLayout: () => {},
          name: null,
          cwd: null,
          harness: 'claude-code',
          workspaceId: WORKSPACE_ID,
          apiBase: `/api/workspaces/${WORKSPACE_ID}`,
          isRemote: false,
          isLoading: false
        }}
      >
        <Probe />
      </WorkspaceLayoutContext.Provider>
    )
    expect(rendered.at(-1)).toEqual(['board:submitted'])

    const request = fixture.queryClient.refetchQueries({ queryKey })
    await fixture.settle()
    fixture.emit({ type: 'views-list:changed', workspaceId: 'other', views: [] })
    await fixture.settle()
    expect(rendered.at(-1)).toEqual(['board:submitted'])

    const compiled: CompiledView = { id: 'board', status: 'compiled', title: 'Board' }
    const owner: ClientEvent = {
      type: 'views-list:changed',
      workspaceId: WORKSPACE_ID,
      views: [compiled]
    }
    const personal: ClientEvent = {
      type: 'personal-state:changed',
      workspaceId: WORKSPACE_ID,
      state: workspaceState({ revision: 2 }),
      completedViews: [compiled]
    }
    for (const event of order === 'owner first' ? [owner, personal] : [personal, owner]) {
      fixture.emit(event)
      await fixture.settle()
      expect(rendered.at(-1)).toEqual(['board:compiled'])
    }
    reply.resolve({ views: [] })
    await request
    await fixture.settle()

    expect(fixture.queryClient.getQueryData<CompiledView[]>(queryKey)).toEqual([compiled])
    expect(rendered.every(views => views.length === 1)).toBe(true)
    expect(rendered.at(-1)).toEqual(['board:compiled'])
  }
)

describe('workspace state writes', () => {
  test('a reply waits while a later write is in flight; the last reply becomes the cache', async () => {
    const replies: ReturnType<typeof deferred<WorkspaceState>>[] = []
    const fixture = mount(workspaceState({ selected: { overview: 'start' } }), async () => {
      const reply = deferred<WorkspaceState>()
      replies.push(reply)
      return reply.promise
    })
    const handles: { write?: (sessionId: string) => void } = {}
    function Probe() {
      useWorkspaceState(WORKSPACE_ID)
      const { mutate } = useWorkspaceStateWrite<string>(WORKSPACE_ID, {
        request: sessionId =>
          fetch(`/api/workspaces/${WORKSPACE_ID}/sessions/${sessionId}/selection`, {
            method: 'PUT'
          }).then(response => response.json() as Promise<WorkspaceState>),
        optimistic: (draft, sessionId) => {
          draft.selected.overview = sessionId
        },
        errorTitle: 'Couldn’t save selected chat'
      })
      useLayoutEffect(() => {
        handles.write = mutate
      })
      return null
    }
    await fixture.render(<Probe />)

    await act(async () => {
      handles.write!('first')
      handles.write!('second')
    })
    expect(fixture.cached()?.selected.overview).toBe('second')

    await fixture.settle()
    replies[0]!.resolve(workspaceState({ revision: 2, selected: { overview: 'first' } }))
    await fixture.settle()
    expect(fixture.cached()?.selected.overview).toBe('second')

    await fixture.settle()
    replies[1]!.resolve(workspaceState({ revision: 3, selected: { overview: 'second' } }))
    await fixture.settle()
    expect(fixture.cached()).toEqual(
      workspaceState({ revision: 3, selected: { overview: 'second' } })
    )
  })

  test('personal-state:changed waits for writes in flight and never brings back an older copy', async () => {
    const reply = deferred<WorkspaceState>()
    const fixture = mount(workspaceState(), () => reply.promise)
    const handles: { pin?: (sessionId: string) => void } = {}
    function Probe() {
      useWorkspaceStateSync()
      const { pin } = usePinnedSession()
      useLayoutEffect(() => {
        handles.pin = pin
      })
      return null
    }
    await fixture.render(<Probe />)

    await act(async () => handles.pin!('mine'))
    fixture.emit({
      type: 'personal-state:changed',
      workspaceId: WORKSPACE_ID,
      state: workspaceState({ revision: 4, pinnedSessionId: 'theirs' })
    })
    expect(fixture.cached()?.pinnedSessionId).toBe('mine')

    reply.resolve(workspaceState({ revision: 5, pinnedSessionId: 'mine' }))
    await fixture.settle()
    expect(fixture.cached()?.revision).toBe(5)

    fixture.emit({
      type: 'personal-state:changed',
      workspaceId: WORKSPACE_ID,
      state: workspaceState({ revision: 4, pinnedSessionId: 'theirs' })
    })
    expect(fixture.cached()?.pinnedSessionId).toBe('mine')
    fixture.emit({
      type: 'personal-state:changed',
      workspaceId: WORKSPACE_ID,
      state: workspaceState({ revision: 6 })
    })
    expect(fixture.cached()).toEqual(workspaceState({ revision: 6 }))
  })

  test('personal-state:changed for a workspace this tab never loaded stays out of the cache', async () => {
    const fixture = mount(workspaceState(), async () => workspaceState())
    function Probe() {
      useWorkspaceStateSync()
      return null
    }
    await fixture.render(<Probe />)
    fixture.emit({ type: 'personal-state:changed', workspaceId: 'other', state: workspaceState() })
    expect(fixture.queryClient.getQueryData(workspaceKeys.state('other'))).toBeUndefined()
  })
})

type Handles = {
  select?: (sessionId: string | null) => void
  unpin?: () => void
  shown?: string | null
}

type SelectionProbeProps = {
  handles: Handles
}

// Hands the overview selection and its actions to the test after each render.
function SelectionProbe({ handles }: SelectionProbeProps) {
  const [selectedSessionId, setSelectedSessionId] = useSelectedSession('overview')
  const { unpin } = usePinnedSession()
  useLayoutEffect(() => {
    Object.assign(handles, { select: setSelectedSessionId, unpin, shown: selectedSessionId })
  })
  return null
}

describe('selection and pin requests', () => {
  test('choosing a chat sends the chat the tab showed; New chat clears the current one', async () => {
    let server = workspaceState({ selected: { overview: 'session-1' } })
    const fixture = mount(server, async request => {
      const sessionId = decodeURIComponent(request.url.split('/sessions/')[1]!.split('/')[0]!)
      const selected = { ...server.selected }
      if (request.method === 'PUT') selected.overview = sessionId
      else if (selected.overview === sessionId) delete selected.overview
      server = { ...server, revision: server.revision + 1, selected }
      return server
    })
    const handles: Handles = {}
    await fixture.render(<SelectionProbe handles={handles} />)
    expect(handles.shown).toBe('session-1')

    await act(async () => handles.select!('session-2'))
    await fixture.settle()
    expect(handles.shown).toBe('session-2')
    await act(async () => handles.select!(null))
    await fixture.settle()
    expect(handles.shown).toBeNull()

    expect(fixture.requests).toEqual([
      {
        method: 'PUT',
        url: `/api/workspaces/${WORKSPACE_ID}/sessions/session-2/selection`,
        body: { tabId: 'overview', ifMatch: 'session-1' }
      },
      {
        method: 'DELETE',
        url: `/api/workspaces/${WORKSPACE_ID}/sessions/session-2/selection`,
        body: { tabId: 'overview' }
      }
    ])
    expect(fixture.cached()).toEqual(workspaceState({ revision: 3 }))
  })

  test('a pinned chat ignores tab choices until it is unpinned', async () => {
    const fixture = mount(
      workspaceState({ pinnedSessionId: 'pinned', selected: { overview: 'session-1' } }),
      async () => workspaceState({ revision: 2, selected: { overview: 'session-1' } })
    )
    const handles: Handles = {}
    await fixture.render(<SelectionProbe handles={handles} />)

    await act(async () => handles.select!('session-2'))
    expect(handles.shown).toBe('pinned')
    expect(fixture.requests).toEqual([])

    await act(async () => handles.unpin!())
    await fixture.settle()
    expect(handles.shown).toBe('session-1')
    expect(fixture.requests).toEqual([
      {
        method: 'DELETE',
        url: `/api/workspaces/${WORKSPACE_ID}/sessions/pinned/pin`,
        body: undefined
      }
    ])
  })
})

test('a view submission keeps its chat through delayed snapshots and a native session rename', async () => {
  const reply = deferred<{ viewId: string; sessionId: string; state: WorkspaceState }>()
  const initial = workspaceState({
    pendingViews: { board: { status: 'draft', requirements: '' } }
  })
  let server = initial
  const fixture = mount(initial, async request => {
    if (request.url.endsWith('/submit')) return reply.promise
    if (request.url.endsWith('/state')) return server
    if (request.url.endsWith('/harness')) return { models: [] }
    throw new Error(`Unexpected request: ${request.url}`)
  })
  let actions!: ReturnType<typeof useViewActions>
  function Probe() {
    const current = useViewActions()
    useLayoutEffect(() => {
      actions = current
    })
    useWorkspaceStateSync()
    return null
  }
  await fixture.render(
    <WorkspaceLayoutContext
      value={{
        layout: createDefaultWorkspaceLayout(),
        setLayout: () => {},
        name: null,
        cwd: null,
        harness: 'claude-code',
        workspaceId: WORKSPACE_ID,
        apiBase: `/api/workspaces/${WORKSPACE_ID}`,
        isRemote: false,
        isLoading: false
      }}
    >
      <Probe />
    </WorkspaceLayoutContext>
  )
  let submission!: Promise<void>
  await act(async () => {
    submission = actions.submit({ id: 'board', status: 'draft', requirements: '' }, 'Build cards')
  })
  const selected = fixture.cached()?.selected['views/board']
  expect(selected).toBeString()
  fixture.emit({ type: 'personal-state:changed', workspaceId: WORKSPACE_ID, state: initial })
  await fixture.queryClient.refetchQueries({ queryKey: workspaceKeys.state(WORKSPACE_ID) })
  expect(fixture.cached()?.selected['views/board']).toBe(selected)

  server = workspaceState({
    revision: 3,
    selected: { 'views/board': 'native' },
    sessions: { native: { tabId: 'views/board' } },
    pendingViews: {
      board: { status: 'submitted', requirements: 'Build cards', buildSessionId: 'native' }
    }
  })
  fixture.emit({ type: 'personal-state:changed', workspaceId: WORKSPACE_ID, state: server })
  await act(async () => {
    reply.resolve({ viewId: 'board', sessionId: 'native', state: server })
    await submission
  })
  expect(fixture.cached()).toEqual(server)
  expect(fixture.requests.filter(request => request.url.endsWith('/state'))).toHaveLength(1)
  fixture.emit({ type: 'personal-state:changed', workspaceId: WORKSPACE_ID, state: initial })
  expect(fixture.cached()?.selected['views/board']).toBe('native')
})

test('a newer socket snapshot survives an older write reply', async () => {
  const reply = deferred<WorkspaceState>()
  const fixture = mount(workspaceState(), () => reply.promise)
  let pin!: (sessionId: string) => void
  function Probe() {
    const current = usePinnedSession().pin
    useLayoutEffect(() => {
      pin = current
    })
    useWorkspaceStateSync()
    return null
  }
  await fixture.render(<Probe />)
  await act(async () => pin('mine'))
  const latest = workspaceState({
    revision: 3,
    pinnedSessionId: 'mine',
    selected: { 'views/board': 'native' }
  })
  fixture.emit({ type: 'personal-state:changed', workspaceId: WORKSPACE_ID, state: latest })
  expect(fixture.cached()?.pinnedSessionId).toBe('mine')
  reply.resolve(workspaceState({ revision: 2, pinnedSessionId: 'mine' }))
  await fixture.settle()
  expect(fixture.cached()).toEqual(latest)
})
