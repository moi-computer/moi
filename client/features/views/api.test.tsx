import { afterEach, expect, spyOn, test } from 'bun:test'
import { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { WorkspaceLayoutContext } from '@/client/features/workspace/workspace-layout-context'
import { createDefaultWorkspaceLayout } from '@/lib/workspace-layout'
import type { CompiledView, WorkspaceState } from '@/lib/types'
import {
  useCreateView,
  useDeleteView,
  useRenameView,
  useSaveViewDraft,
  useSubmitView,
  useViews
} from './api'

const LOCAL = '/api/workspaces/visitor'
const OWNER = '/api/workspaces/alice:board'

let cleanup = async () => {}
afterEach(() => cleanup())

// A visitor's workspace with one view still being built and one the owner has compiled.
async function mount(isRemote: boolean, pending: string[], compiled: string[]) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
  const globals = { window, document, IS_REACT_ACT_ENVIRONMENT: true }
  const descriptors = new Map(
    Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const apiBase = isRemote ? OWNER : LOCAL
  const state: WorkspaceState = {
    revision: 1,
    selected: {},
    sessions: {},
    pendingViews: Object.fromEntries(
      pending.map(id => [id, { status: 'submitted', requirements: '' }])
    )
  }
  const views: CompiledView[] = compiled.map(id => ({ id, status: 'compiled', title: id }))
  const writes: string[] = []
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (method === 'GET')
          return Response.json(url.endsWith('/state') ? state : { views: structuredClone(views) })
        writes.push(`${method} ${url}`)
        return Response.json({})
      },
      { preconnect: fetch.preconnect }
    )
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let actions!: ReturnType<typeof useActions>
  function useActions() {
    return {
      create: useCreateView('visitor').mutateAsync,
      save: useSaveViewDraft('visitor').mutateAsync,
      submit: useSubmitView('visitor').mutateAsync,
      rename: useRenameView('visitor').mutateAsync,
      remove: useDeleteView('visitor').mutateAsync
    }
  }
  function Probe() {
    useViews('visitor')
    const current = useActions()
    useLayoutEffect(() => {
      actions = current
    })
    return null
  }
  const root = createRoot(document.getElementById('root')!)
  const settle = () =>
    act(async () => {
      await Bun.sleep(20)
    })
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <WorkspaceLayoutContext
          value={{
            workspaceId: 'visitor',
            layout: createDefaultWorkspaceLayout(),
            setLayout: () => {},
            name: 'Board',
            cwd: null,
            harness: 'codex',
            apiBase,
            isRemote,
            isLoading: false
          }}
        >
          <Probe />
        </WorkspaceLayoutContext>
      </QueryClientProvider>
    )
  )
  await settle()
  cleanup = async () => {
    await act(async () => root.unmount())
    client.clear()
    // Let query notifications drain while the DOM globals still exist.
    await settle()
    fetchSpy.mockRestore()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
  return {
    writes,
    settle,
    run: (action: (current: typeof actions) => Promise<unknown>) => act(() => action(actions))
  }
}

test('a remote view under construction is written to the visitor and a compiled one to the owner', async () => {
  const { writes, run } = await mount(true, ['draft'], ['built'])
  await run(actions => actions.create())
  await run(actions => actions.save({ viewId: 'draft', requirements: 'Cards' }))
  await run(actions =>
    actions.submit({ viewId: 'draft', requirements: 'Cards', sessionId: 's', optimisticId: 'o' })
  )
  await run(actions => actions.rename({ viewId: 'draft', title: 'Cards' }))
  await run(actions => actions.remove('draft'))
  await run(actions => actions.rename({ viewId: 'built', title: 'Plan' }))
  await run(actions => actions.remove('built'))
  expect(writes).toEqual([
    `POST ${LOCAL}/views`,
    `PATCH ${LOCAL}/views/draft`,
    `POST ${LOCAL}/views/draft/submit`,
    `PATCH ${LOCAL}/views/draft`,
    `DELETE ${LOCAL}/views/draft`,
    `PATCH ${OWNER}/views/built`,
    `DELETE ${OWNER}/views/built`
  ])
})
