import { DEFAULT_WORKSPACE_STATE_ROOT, setWorkspaceStateRoot } from '../workspace-state'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import * as appConfig from '../app-config'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify, parse } from 'devalue'
import { api } from './index'
import * as events from '../events'
import {
  DEFAULT_REGISTRY_PATH,
  getWorkspace,
  registerWorkspace,
  setRegistryPath
} from '../workspaces/registry'
import { completeRemoteViewBuilds } from '../sessions/pending-views'
import { loadLayout, saveLayout } from '../workspaces/layout'
import { buildAllViews } from '../applets/views'
import { killAllWorkers } from '../applets/functions'
import { createDefaultWorkspaceLayout } from '@/lib/workspace-layout'

let root: string, owner: string, visitor: string, ownerId: string, visitorId: string, base: string
let local: string
const spies: { mockRestore(): void }[] = []
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'moi-remote-'))
  setWorkspaceStateRoot(join(root, 'state'))
  owner = join(root, 'owner-board')
  visitor = join(root, 'visitor-alias')
  await mkdir(join(owner, '.moi/views'), { recursive: true })
  await mkdir(join(visitor, '.moi'), { recursive: true })
  setRegistryPath(join(root, 'registry.json'))
  ownerId = (await registerWorkspace(owner)).id
  visitorId = (await registerWorkspace(visitor)).id
  base = `/api/workspaces/${ownerId}`
  await saveLayout(
    {
      ...createDefaultWorkspaceLayout(),
      name: 'Owner board'
    },
    owner
  )
  await Bun.write(
    join(visitor, '.moi/.workspace.json'),
    JSON.stringify({
      version: 2,
      remote: { user_id: 'alice', workspace_id: ownerId }
    })
  )
  local = `/api/workspaces/${visitorId}`
  spies.push(
    spyOn(appConfig, 'getAppConfig').mockReturnValue({
      ...appConfig.getAppConfig(),
      environment: 'cloud'
    })
  )
})
afterEach(async () => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  killAllWorkers()
  setWorkspaceStateRoot(DEFAULT_WORKSPACE_STATE_ROOT)
  setRegistryPath(DEFAULT_REGISTRY_PATH)
  await rm(root, { recursive: true, force: true })
})
const put = (body: unknown) => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

test('remote open tabs persist on the visitor without changing the owner or reference', async () => {
  const referenceBefore = await Bun.file(join(visitor, '.moi/.workspace.json')).text()
  const ownerBefore = await Bun.file(join(owner, '.moi/.workspace.json')).text()
  const openTabs = ['views/two', 'scratchpad', 'views/one']
  const response = await api.request(`${local}/state/tabs`, put({ openTabs }))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ revision: 1, openTabs })
  expect(await Bun.file(join(root, 'state', visitorId, 'state.json')).json()).toMatchObject({
    openTabs
  })
  setWorkspaceStateRoot(join(root, 'state')) // Reload from disk, as after a server restart.
  expect(await (await api.request(`${local}/state`)).json()).toMatchObject({ openTabs })
  expect(await (await api.request(`${base}/state`)).json()).not.toHaveProperty('openTabs')
  expect(await Bun.file(join(visitor, '.moi/.workspace.json')).text()).toBe(referenceBefore)
  expect(await Bun.file(join(owner, '.moi/.workspace.json')).text()).toBe(ownerBefore)
})

test('tab writes omit Overview, drop invalid paths and deduplicate', async () => {
  const response = await api.request(
    `${local}/state/tabs`,
    put({ openTabs: ['scratchpad', 'overview', 'views/../bad', 'chats/id', 1, 'scratchpad'] })
  )
  expect(await response.json()).toMatchObject({ openTabs: ['scratchpad'] })
})

test('saving only Overview keeps an explicit empty list after a restart', async () => {
  const response = await api.request(`${local}/state/tabs`, put({ openTabs: ['overview'] }))
  expect(await response.json()).toMatchObject({ openTabs: [] })
  expect(await Bun.file(join(root, 'state', visitorId, 'state.json')).json()).toMatchObject({
    openTabs: []
  })
  setWorkspaceStateRoot(join(root, 'state'))
  expect(await (await api.request(`${local}/state`)).json()).toMatchObject({ openTabs: [] })
})

test('visitor API returns the reference, folder and resolved routing', async () => {
  const list = await (await api.request('/api/workspaces')).json()
  expect(list.find((entry: { id: string }) => entry.id === visitorId)).toMatchObject({
    remote: { user_id: 'alice', workspace_id: ownerId },
    name: ownerId
  })
  const layout = await (await api.request(local)).json()
  expect(layout).toMatchObject({
    cwd: visitor,
    apiBase: `/api/workspaces/alice:${ownerId}`,
    isRemote: true,
    remote: { user_id: 'alice', workspace_id: ownerId }
  })
  expect(layout.widgetGrid).toBeUndefined()
  expect(layout.tabs).toBeUndefined()
  expect((await api.request(`${base}/widgets`)).status).toBe(200)
})

test('local workspace info includes routing without persisting response metadata', async () => {
  const info = await (await api.request(base)).json()
  expect(info).toMatchObject({ apiBase: base, isRemote: false, name: 'Owner board' })
  expect((await api.request(base, put(info))).status).toBe(204)
  const saved = await Bun.file(join(owner, '.moi/.workspace.json')).json()
  expect(saved).not.toHaveProperty('apiBase')
  expect(saved).not.toHaveProperty('isRemote')
})

test('visitor layout writes cannot add preferences or overwrite the reference', async () => {
  const before = await Bun.file(join(visitor, '.moi/.workspace.json')).text()
  const ownerBefore = await loadLayout(owner)
  const response = await api.request(
    local,
    put({
      version: 2
    })
  )
  expect(response.status).toBe(403)
  expect(await Bun.file(join(visitor, '.moi/.workspace.json')).text()).toBe(before)
  expect(await loadLayout(owner)).toEqual(ownerBefore)
})

test('remote bundle RPC reads and writes owner data; assets and validators retain the destination', async () => {
  await symlink(join(import.meta.dir, '../../node_modules'), join(owner, '.moi/node_modules'))
  await Bun.write(
    join(owner, '.moi/views/counter.tsx'),
    `import { increment } from './counter.server'; export const config = { title: 'Counter' }; export default function Counter() { return <button onClick={() => increment()}>Increment</button> }`
  )
  await Bun.write(
    join(owner, '.moi/views/counter.server.ts'),
    `import { join } from 'node:path'; const path = join(import.meta.dir, '../count.json'); export async function increment() { const n = await Bun.file(path).json().catch(() => 0); await Bun.write(path, JSON.stringify(n + 1)); return n + 1 }`
  )
  await buildAllViews(owner)
  const bundle = await api.request(`${base}/views/counter/module`)
  expect(bundle.status).toBe(200)
  const etag = bundle.headers.get('etag')!
  const legacyEtag = etag.replace('-url-base-v2', '')
  expect(
    (
      await api.request(`${base}/views/counter/module`, {
        headers: { 'if-none-match': legacyEtag }
      })
    ).status
  ).toBe(200)
  expect(
    (
      await api.request(`${base}/views/counter/module`, {
        headers: { 'if-none-match': etag }
      })
    ).status
  ).toBe(304)
  const text = await bundle.text()
  expect(text).toContain('new URL(import.meta.url)')
  // Execute the served module with the URL it has behind Batiok, without a DOM.
  // Parsing the entire bundle also catches invalid substitutions in minified code.
  const publicUrl = `http://cloud.test/api/workspaces/alice:${ownerId}/views/counter/module`
  const source = text.replaceAll('import.meta.url', JSON.stringify(publicUrl))
  new Bun.Transpiler({ loader: 'js' }).scan(source)
  const expression = source.match(/\(new URL\([^\n]+?\?\.\[0\] \?\? [^\n]+?\)/)?.[0]
  expect(expression).toBeDefined()
  expect(new Function(`return ${expression}`)()).toBe(`/api/workspaces/alice:${ownerId}`)
  const response = await api.request(`${base}/rpc/views/counter/increment`, {
    method: 'POST',
    body: stringify([])
  })
  expect(response.status).toBe(200)
  expect(parse(await response.text())).toBe(1)
  expect(await Bun.file(join(owner, '.moi/count.json')).json()).toBe(1)
  expect(await Bun.file(join(visitor, '.moi/count.json')).exists()).toBe(false)
  await Bun.write(join(owner, 'hello.svg'), '<svg/>')
  expect(await (await api.request(`${base}/files/hello.svg`)).text()).toBe('<svg/>')
})

test('remote reference serves no shared content and keeps personal state local', async () => {
  for (const path of ['/widgets', '/views', '/scratchpad', '/config'])
    expect([path, (await api.request(local + path)).status]).toEqual([path, 404])
  expect((await api.request(local, { method: 'DELETE' })).status).toBe(403)
  // Chat state, the agent and what it runs with are the visitor's own and never leave this Moi.
  for (const path of ['/state', '/env', '/skills'])
    expect([path, (await api.request(local + path)).status]).toEqual([path, 200])
  const previews = await (await api.request('/api/workspaces/previews')).json()
  expect(previews[visitorId]).toEqual({ thumbnails: [] })
})

test('shared routes reject a remote reference before reading request data', async () => {
  const routes = [
    ['GET', '/widgets/card/module'],
    ['GET', '/views/board/module'],
    ['GET', '/files/private.txt'],
    ['POST', '/rpc/board/read'],
    ['POST', '/applet-log'],
    ['PUT', '/config'],
    ['POST', '/scratchpad/ops'],
    ['PUT', '/scratchpad'],
    ['POST', '/scratchpad/assets'],
    ['GET', '/scratchpad/assets/photo.png'],
    ['PUT', '/icon'],
    ['DELETE', '/icon'],
    ['GET', '/applet-thumbnails'],
    ['GET', '/applet-thumbnails/view/board'],
    ['PUT', '/applet-thumbnails']
  ] as const
  for (const [method, path] of routes) {
    const response = await api.request(local + path, { method })
    expect([method, path, response.status, await response.text()]).toEqual([
      method,
      path,
      404,
      'Use the owner workspace address'
    ])
  }
})

test('a view being built stays with the visitor until the owner lists it as compiled', async () => {
  const pendingIds = async () =>
    Object.keys((await (await api.request(`${local}/state`)).json()).pendingViews)
  const created = await api.request(`${local}/views`, { method: 'POST' })
  expect(created.status).toBe(201)
  const { id } = await created.json()
  expect(await pendingIds()).toEqual([id])
  expect(Object.keys((await (await api.request(`${base}/state`)).json()).pendingViews)).toEqual([])
  const patch = (body: unknown) => ({ ...put(body), method: 'PATCH' })
  expect((await api.request(`${local}/views/${id}`, patch({ title: 'Launch plan' }))).status).toBe(
    200
  )
  // Compiled views are the owner's: the reference neither renames nor deletes them.
  expect((await api.request(`${local}/views/compiled`, patch({ title: 'Mine' }))).status).toBe(404)
  expect((await api.request(`${local}/views/compiled`, { method: 'DELETE' })).status).toBe(404)
  const reference = (await getWorkspace(visitorId))!
  const published = spyOn(events, 'publishEvent')
  spies.push(published)
  const ownerLists =
    (...ids: string[]) =>
    async () =>
      Response.json({ views: ids.map(id => ({ id, status: 'compiled', title: id })) })
  await completeRemoteViewBuilds(reference, ownerLists('compiled'))
  expect(await pendingIds()).toEqual([id])
  await completeRemoteViewBuilds(reference, ownerLists('compiled', id))
  expect(published).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'personal-state:changed',
      workspaceId: visitorId,
      completedViews: [{ id, status: 'compiled', title: id }]
    })
  )
  expect(await pendingIds()).toEqual([])
})

test('a remote reference reports and changes the visitor’s own agent', async () => {
  expect((await (await api.request(local)).json()).harness).toBeUndefined()
  const changed = await api.request(`${local}/harness`, {
    ...put({ harness: 'codex' }),
    method: 'PATCH'
  })
  expect(changed.status).toBe(200)
  expect(await (await api.request(local)).json()).toMatchObject({
    isRemote: true,
    harness: 'codex'
  })
})

test('remote scratchpad documents and assets stay on the owner', async () => {
  const document = { store: {}, schema: { schemaVersion: 2, sequences: {} } }
  expect((await api.request(`${base}/scratchpad`, put({ document }))).status).toBe(204)
  const loaded = await (await api.request(`${base}/scratchpad`)).json()
  expect(loaded.document).toEqual(document)
  expect(await Bun.file(join(visitor, '.moi/.scratchpad.json')).exists()).toBe(false)
  const upload = await api.request(`${base}/scratchpad/assets`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: new Uint8Array([1, 2, 3])
  })
  expect(upload.status).toBe(200)
  const { src } = await upload.json()
  const asset = await api.request(`${base}/scratchpad/assets/${src.slice('asset:'.length)}`)
  expect(asset.status).toBe(200)
  expect(new Uint8Array(await asset.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
})

test('scratchpad edit API runs ops on the owner and never reads caller paths', async () => {
  const { readScratchpadShapes, readScratchpadImage } = await import('../scratchpad/document')
  const sharp = (await import('sharp')).default
  const image = await sharp({
    create: { width: 10, height: 10, channels: 3, background: '#ff0000' }
  })
    .png()
    .toBuffer()
  const edit = async (op: unknown, bytes?: Uint8Array) => {
    const body = new FormData()
    body.set('op', JSON.stringify(op))
    if (bytes)
      body.set('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'visitor.png')
    return api.request(`${base}/scratchpad/ops`, { method: 'POST', body })
  }
  expect((await edit({ kind: 'add-text', name: 'note', x: 1, y: 2, text: 'Hello' })).status).toBe(
    200
  )
  expect((await edit({ kind: 'move', name: 'note', x: 30, y: 40 })).status).toBe(200)
  expect((await edit({ kind: 'set', name: 'note', text: 'Updated' })).status).toBe(200)
  expect((await readScratchpadShapes(owner))[0]).toMatchObject({
    id: 'note',
    x: 30,
    y: 40,
    text: 'Updated'
  })
  expect(
    (
      await edit(
        { kind: 'add-image', name: 'photo', path: '/visitor-only/image.png', x: 0, y: 0 },
        image
      )
    ).status
  ).toBe(200)
  expect(await readScratchpadImage(owner, 'photo')).toMatchObject({
    src: expect.stringContaining('data:image/')
  })
  expect((await edit({ kind: 'delete', name: 'note' })).status).toBe(200)
  expect((await readScratchpadShapes(owner)).map(shape => shape.id)).toEqual(['photo'])
  expect((await edit({ kind: 'clear' })).status).toBe(200)
  expect(await readScratchpadShapes(owner)).toEqual([])
  expect(await readScratchpadShapes(visitor)).toEqual([])
  expect((await edit({ kind: 'view' })).status).toBe(400)
  expect((await edit({ kind: 'unknown' })).status).toBe(400)
  expect(await readScratchpadShapes(owner)).toEqual([])
  expect(
    (await edit({ kind: 'add-image', name: 'bad', path: '/owner/private.png', x: 0, y: 0 })).status
  ).toBe(400)
})

test('standalone hides remote registrations and refuses remote opening', async () => {
  const spy = spyOn(appConfig, 'getAppConfig').mockReturnValue({
    ...appConfig.getAppConfig(),
    environment: 'local'
  })
  try {
    for (const path of ['', '/state', '/widgets'])
      expect((await api.request(local + path)).status).toBe(403)
    expect(
      (await (await api.request('/api/workspaces')).json()).some(
        (entry: { id: string }) => entry.id === visitorId
      )
    ).toBe(false)
    expect(
      (
        await api.request('/api/workspaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ remote: { user_id: 'alice', workspace_id: ownerId } })
        })
      ).status
    ).toBe(403)
    expect((await api.request(base)).status).toBe(200)
  } finally {
    spy.mockRestore()
  }
})

test('standalone can reorder visible workspaces while preserving remote registrations', async () => {
  spies.push(
    spyOn(appConfig, 'getAppConfig').mockReturnValue({
      ...appConfig.getAppConfig(),
      environment: 'local'
    })
  )
  const response = await api.request('/api/workspaces/order', put({ ids: [ownerId] }))
  expect(response.status).toBe(200)
  expect((await response.json()).map((entry: { id: string }) => entry.id)).toEqual([ownerId])
  const { listWorkspaces } = await import('../workspaces/registry')
  expect((await listWorkspaces()).map(entry => entry.id)).toEqual([ownerId, visitorId])
})

test('remote registration reuses the existing reference and validates its input', async () => {
  const register = (body: unknown) =>
    api.request('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  const remote = { user_id: 'alice', workspace_id: ownerId }
  const response = await register({ remote })
  expect(response.status).toBe(201)
  expect((await response.json()).id).toBe(visitorId)
  expect((await (await register({ remote })).json()).id).toBe(visitorId)
  for (const body of [
    { remote: null },
    { remote: {} },
    { remote, path: owner },
    { remote, harness: 'openclaw' },
    { remote, harness: 'unknown' }
  ]) {
    expect((await register(body)).status).toBe(400)
  }
})
