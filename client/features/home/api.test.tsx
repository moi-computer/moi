import { expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWorkspaces, useWorkspaceMetadata } from './api'

test.each(['ready', 'failed', 'slow'] as const)(
  'home deduplicates owner requests and keeps cards available (%s)',
  async state => {
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let wakeOwner: (response: Response) => void = () => {}
    const sleepingOwner = new Promise<Response>(resolve => {
      wakeOwner = resolve
    })
    const calls: string[] = []
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) => {
          const path = String(input)
          calls.push(path)
          if (path === '/api/workspaces')
            return Response.json([
              { id: 'local', path: '/local', name: 'Local', addedAt: '' },
              {
                id: 'visitor',
                path: '/visitor',
                name: 'board',
                addedAt: '',
                remote: { user_id: 'alice', workspace_id: 'board' }
              },
              {
                id: 'another',
                path: '/another',
                addedAt: '',
                remote: { user_id: 'bob', workspace_id: 'other' }
              }
            ])
          if (path === '/api/workspaces/alice:board') {
            if (state === 'slow') return sleepingOwner
            if (state === 'failed') return new Response('Owner unavailable', { status: 503 })
            return Response.json({ name: 'Fresh owner name', isRemote: false })
          }
          if (path === '/api/workspaces/bob:other')
            return Response.json({ name: 'Other owner', isRemote: false })
          throw new Error(`Unexpected request: ${path}`)
        },
        { preconnect: fetch.preconnect }
      )
    )
    function Probe() {
      const { data: entries = [] } = useWorkspaces()
      const cards = useWorkspaceMetadata(entries)
      // Sidebar and home observe the same owner without issuing duplicate requests.
      useWorkspaceMetadata(entries)
      return <p>{cards.map(card => card.name).join(',')}</p>
    }
    const root = createRoot(document.getElementById('root')!)
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>
        )
      )
      for (let i = 0; i < 20 && !document.body.textContent?.includes('Other owner'); i++)
        await act(async () => {
          await Bun.sleep(10)
        })
      expect(document.body.textContent).toContain(
        state === 'ready' ? 'Local,Fresh owner name,Other owner' : 'Local,board,Other owner'
      )
      if (state === 'slow') {
        wakeOwner(Response.json({ name: 'Awake owner', isRemote: false }))
        for (let i = 0; i < 20 && !document.body.textContent?.includes('Awake owner'); i++)
          await act(async () => {
            await Bun.sleep(10)
          })
        expect(document.body.textContent).toContain('Local,Awake owner,Other owner')
      }
      expect(calls.sort()).toEqual([
        '/api/workspaces',
        '/api/workspaces/alice:board',
        '/api/workspaces/bob:other'
      ])
    } finally {
      await act(async () => root.unmount())
      client.clear()
      fetchSpy.mockRestore()
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  }
)
