import { seedWorkspaceInfo } from '@/client/features/workspace/workspace-test-utils'
import { expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { workspaceKeys } from '@/client/api/workspace-keys'
import { AppContext } from '@/client/runtime/app-context'
import type { WorkspaceEvent, WorkspaceEventsClient } from '@/client/runtime/workspace-events'
import { useAppletCacheInvalidation, useView } from './use-applet'
import * as cache from './applet-cache'
import * as journal from './applet-log'
import { Workspace } from '../workspace/workspace-context'
import { queryClient } from '@/client/api/query-client'

test('a remote view reloads only when its revision changes, staying visible meanwhile', async () => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
  const globals = {
    window,
    document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true
  }
  const descriptors = new Map(
    Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const first = () => <p>First view</p>
  const second = () => <p>Second view</p>
  let finish: (component: typeof first) => void = () => {}
  let next = Promise.resolve(first)
  const load = spyOn(cache, 'getCachedApplet').mockImplementation(() => next)
  const log = spyOn(journal, 'reportAppletError').mockImplementation(() => {})
  seedWorkspaceInfo('visitor', { user_id: 'alice', workspace_id: 'board' })
  type ProbeProps = { name: string; revision: string }
  function Probe({ name, revision }: ProbeProps) {
    const state = useView(name, revision)
    return state.status === 'ready' ? <state.Component /> : <p>{state.status}</p>
  }
  const root = createRoot(document.getElementById('root')!)
  const render = (name: string, revision: string) =>
    act(async () =>
      root.render(
        <Workspace id="visitor">
          <Probe name={name} revision={revision} />
        </Workspace>
      )
    )
  try {
    await render('first', 'a')
    expect(document.body.textContent).toContain('First view')
    // An unchanged revision (a list refetch on focus) loads nothing.
    const loads = load.mock.calls.length
    await render('first', 'a')
    expect(load.mock.calls.length).toBe(loads)
    next = new Promise(resolve => {
      finish = resolve
    })
    await render('first', 'b')
    expect(load.mock.calls.length).toBe(loads + 1)
    expect(document.body.textContent).toContain('First view')
    next = Promise.resolve(second)
    await render('second', 'a')
    expect(document.body.textContent).toContain('Second view')
    await act(async () => finish(first))
    expect(document.body.textContent).toContain('Second view')
    next = Promise.reject(new Error('Owner unavailable'))
    await render('second', 'b')
    expect(document.body.textContent).toContain('Second view')
    expect(log).toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    load.mockRestore()
    log.mockRestore()
    queryClient.clear()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

test.each([true, false])(
  'moi refresh re-reads the owner’s applet lists only in a remote workspace (remote: %s)',
  async remote => {
    const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
    const globals = { window, document, IS_REACT_ACT_ENVIRONMENT: true }
    const descriptors = new Map(
      Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
    )
    for (const [key, value] of Object.entries(globals))
      Object.defineProperty(globalThis, key, { configurable: true, value })
    const client = new QueryClient()
    seedWorkspaceInfo(
      'visitor',
      remote ? { user_id: 'alice', workspace_id: 'board' } : undefined,
      client
    )
    const lists = [workspaceKeys.views('visitor'), workspaceKeys.widgets('visitor')]
    for (const key of lists) client.setQueryData(key, [])
    let emit: (event: WorkspaceEvent) => void = () => {}
    // Only `subscribe` is reached by the hook under test.
    const events = {
      subscribe: (handler: (event: WorkspaceEvent) => void) => {
        emit = handler
        return () => {}
      }
    } as unknown as WorkspaceEventsClient
    function Probe() {
      useAppletCacheInvalidation()
      return null
    }
    const root = createRoot(document.getElementById('root')!)
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <AppContext value={{ events }}>
              <Workspace id="visitor">
                <Probe />
              </Workspace>
            </AppContext>
          </QueryClientProvider>
        )
      )
      const stale = () => lists.map(key => client.getQueryState(key)?.isInvalidated)
      // Another workspace's refresh never touches this one.
      await act(async () => emit({ type: 'applets:refresh', workspaceId: 'other' }))
      expect(stale()).toEqual([false, false])
      await act(async () => emit({ type: 'applets:refresh', workspaceId: 'visitor' }))
      expect(stale()).toEqual([remote, remote])
    } finally {
      await act(async () => root.unmount())
      client.clear()
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  }
)
