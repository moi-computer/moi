import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { api } from './index'
import { DEFAULT_REGISTRY_PATH, registerWorkspace, setRegistryPath } from '../workspaces/registry'

test('deleting a widget removes its files and build while keeping shared code and data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moi-delete-widget-'))
  const workspace = join(root, 'workspace')
  const moi = join(workspace, '.moi')
  try {
    await mkdir(workspace)
    setRegistryPath(join(root, 'registry.json'))
    const { id } = await registerWorkspace(workspace)
    const url = `/api/workspaces/${id}/widgets`
    await Bun.write(join(moi, 'widgets/cards.tsx'), "export * from '../lib/shared'")
    await Bun.write(join(moi, 'widgets/cards.server.ts'), 'export const load = () => 1')
    await Bun.write(join(moi, 'lib/shared.ts'), 'export const title = "Cards"')
    await Bun.write(join(moi, 'views/cards.tsx'), "export * from '../lib/shared'")
    await Bun.write(join(moi, 'data/cards.json'), '[]')
    await Bun.write(join(moi, '.build/widgets/cards/index.js'), 'export default () => null')

    expect((await api.request(url + '/_moi_views', { method: 'DELETE' })).status).toBe(404)
    expect((await api.request(url + '/cards', { method: 'DELETE' })).status).toBe(204)
    expect(await (await api.request(url)).json()).toEqual({ widgets: [] })
    for (const file of [
      'widgets/cards.tsx',
      'widgets/cards.server.ts',
      '.build/widgets/cards/index.js'
    ]) {
      expect(await Bun.file(join(moi, file)).exists()).toBe(false)
    }
    for (const file of ['lib/shared.ts', 'views/cards.tsx', 'data/cards.json']) {
      expect(await Bun.file(join(moi, file)).exists()).toBe(true)
    }
  } finally {
    setRegistryPath(DEFAULT_REGISTRY_PATH)
    await rm(root, { recursive: true, force: true })
  }
})
