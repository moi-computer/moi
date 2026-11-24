import { expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as appConfig from '@/client/api/app-config'
import { useRegisteredWorkspaces, useWorkspaces, useWorkspaceMetadata } from './api'
import * as accountApi from '../account/api'
import { cleanupAccount, mountAccount } from '../account/account-test-utils'
import { remoteWorkspacesKey } from '@/client/api/workspace-keys'
import { useLostRemoteAccess, useRemoteWorkspaces, homeWorkspaces } from './remote-workspaces'

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
                id: 'left',
                path: '/left',
                addedAt: '',
                remote: { user_id: 'carol', workspace_id: 'board' }
              }
            ])
          if (path === '/cloud/api/workspaces/remote')
            return Response.json({
              workspaces: [
                { id: 'board', owner: { id: 'alice', name: 'Alice' } },
                { id: 'other', owner: { id: 'bob', name: 'Bob' } }
              ]
            })
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
    const configSpy = spyOn(appConfig, 'useAppConfig').mockReturnValue({
      environment: 'cloud',
      demo: false,
      demoInstallUrl: ''
    })
    function Probe() {
      const registry = useRegisteredWorkspaces()
      const entries = useWorkspaces()
      const remote = useRemoteWorkspaces()
      const cards = useWorkspaceMetadata(homeWorkspaces(entries.data ?? [], remote.data ?? []))
      // Sidebar and home observe the same owner without issuing duplicate requests.
      useWorkspaceMetadata(entries.data ?? [])
      return (
        <p data-registry={registry.data?.map(entry => entry.id).join(',')}>
          {cards.map(card => card.name).join(',')}
        </p>
      )
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
        state === 'ready' ? 'Other owner,Local,Fresh owner name' : 'Other owner,Local,board'
      )
      expect(document.querySelector('p')?.getAttribute('data-registry')).toBe('local,visitor,left')
      expect(document.body.textContent).not.toContain('left')
      if (state === 'slow') {
        wakeOwner(Response.json({ name: 'Awake owner', isRemote: false }))
        for (let i = 0; i < 20 && !document.body.textContent?.includes('Awake owner'); i++)
          await act(async () => {
            await Bun.sleep(10)
          })
        expect(document.body.textContent).toContain('Other owner,Local,Awake owner')
      }
      expect(calls.sort()).toEqual([
        '/api/workspaces',
        '/api/workspaces/alice:board',
        '/api/workspaces/bob:other',
        '/cloud/api/workspaces/remote'
      ])
    } finally {
      await act(async () => root.unmount())
      client.clear()
      fetchSpy.mockRestore()
      configSpy.mockRestore()
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  }
)

test('confirmed loss of access survives a pending or failed refresh until Cloud grants access again', async () => {
  function Workspace() {
    return <p>{useLostRemoteAccess('alice:board') ? 'Access denied' : 'Workspace open'}</p>
  }
  const first = Promise.withResolvers<Response>()
  const refresh = Promise.withResolvers<Response>()
  let response = first.promise
  const cloudRequest = accountApi.cloudRequest
  const request = spyOn(accountApi, 'cloudRequest').mockImplementation((path, ...args) =>
    path === '/api/workspaces/remote' ? response : cloudRequest(path, ...args)
  )
  const ui = await mountAccount({ children: <Workspace /> })
  const status = () => ui.document.querySelector('p')?.textContent
  const refetch = () => ui.qc.refetchQueries({ queryKey: remoteWorkspacesKey })
  try {
    expect(status()).toBe('Workspace open')
    first.resolve(Response.json({ workspaces: [] }))
    await ui.settle()
    expect(status()).toBe('Access denied')

    response = refresh.promise
    const pending = refetch()
    await ui.settle()
    expect(status()).toBe('Access denied')
    refresh.reject(new Error('Offline'))
    await pending
    await ui.settle()
    expect(status()).toBe('Access denied')

    response = Promise.resolve(
      Response.json({ workspaces: [{ id: 'board', owner: { id: 'alice' } }] })
    )
    await refetch()
    await ui.settle()
    expect(status()).toBe('Workspace open')
  } finally {
    await cleanupAccount()
    request.mockRestore()
  }
})
