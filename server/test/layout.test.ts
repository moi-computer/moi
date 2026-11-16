import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { DEFAULT_VIEWS_WIDGET } from '@/lib/default-widgets'
import type { AppletKind, WorkspaceLayout } from '@/lib/types'

import {
  getLayoutPath,
  getWorkspacePreview,
  loadLayout,
  mergeLayoutForSave
} from '../workspaces/layout'
import { getThumbnailsDir } from '../applets/thumbnails'

const base: WorkspaceLayout = {
  version: 2,
  widgetGrid: []
}

async function withWorkspaceFile<T>(
  body: Record<string, unknown>,
  fn: (dir: string) => Promise<T>
) {
  const dir = await mkdtemp(join(tmpdir(), 'moi-layout-'))
  try {
    const file = getLayoutPath(dir)
    await mkdir(dirname(file), { recursive: true })
    await Bun.write(file, JSON.stringify(body, null, 2))
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Seed the `.moi/.cache/thumbnails` store the preview reads from. Writing the
// index directly keeps `viewedAt` controllable (saves stamp the server clock).
async function seedThumbnails(
  dir: string,
  records: { kind: AppletKind; id: string; viewedAt?: string }[]
) {
  const cacheDir = getThumbnailsDir(dir)
  await mkdir(cacheDir, { recursive: true })
  const index = []
  for (const record of records) {
    const file = `${record.kind}-${record.id}.webp`
    await Bun.write(join(cacheDir, file), 'bytes')
    index.push({
      kind: record.kind,
      id: record.id,
      revision: 'revision',
      capturedAt: '2026-01-01T00:00:00.000Z',
      viewedAt: record.viewedAt ?? '2026-01-01T00:00:00.000Z',
      file
    })
  }
  await Bun.write(join(cacheDir, 'index.json'), JSON.stringify(index))
}

// Deterministic URL shape for assertions; the real one is the API route.
const thumbnailUrl = (kind: AppletKind, id: string) => `${kind}:${id}`

describe('loadLayout', () => {
  test('new workspaces have shared widgets without personal layout', async () => {
    await withWorkspaceFile({ version: 2 }, async dir => {
      expect(await loadLayout(dir)).toEqual({
        version: 2,
        widgetGrid: [{ i: DEFAULT_VIEWS_WIDGET.id, x: 0, y: 0 }]
      })
    })
  })

  test('reads only shared presentation fields', async () => {
    await withWorkspaceFile(
      { ...base, tabs: { active: 'scratchpad' }, selectedModel: 'old', unknown: true },
      async dir => {
        expect(await loadLayout(dir)).toEqual(base)
      }
    )
  })
})

test('layout edits update widgets and theme while preserving identity', () => {
  const existing: WorkspaceLayout = {
    ...base,
    name: 'Photos',
    icon: { type: 'emoji', value: '📷' }
  }
  const edit: WorkspaceLayout = {
    ...base,
    name: 'Stale name',
    icon: { type: 'emoji', value: '💡' },
    widgetGrid: [{ i: 'w', x: 1, y: 2 }],
    theme: { font: 'sans', color: 'rose', radius: 'square', agent: 'dorito' }
  }
  expect(mergeLayoutForSave(existing, edit)).toEqual({
    ...edit,
    name: existing.name,
    icon: existing.icon
  })
  expect(mergeLayoutForSave({ ...existing, theme: edit.theme }, base).theme).toEqual(edit.theme)
  expect(mergeLayoutForSave(base, edit)).toEqual({
    version: 2,
    widgetGrid: edit.widgetGrid,
    theme: edit.theme
  })
})

describe('getWorkspacePreview', () => {
  test('includes the persisted workspace theme', async () => {
    const theme = {
      font: 'sans' as const,
      color: 'rose' as const,
      radius: 'squishy' as const,
      agent: 'pill' as const
    }
    await withWorkspaceFile(
      {
        ...base,
        theme
      },
      async dir => {
        expect(await getWorkspacePreview(dir, { thumbnailUrl })).toEqual({
          thumbnails: [],
          theme
        })
      }
    )
  })

  test('sorts thumbnails top-to-bottom and left-to-right, then caps the stack', async () => {
    await withWorkspaceFile(
      {
        ...base,
        widgetGrid: [
          { i: 'bottom', x: 0, y: 2 },
          { i: 'fourth', x: 0, y: 3 },
          { i: 'right', x: 2, y: 0 },
          { i: 'left', x: 0, y: 0 }
        ]
      },
      async dir => {
        await seedThumbnails(dir, [
          { kind: 'widget', id: 'stale' },
          { kind: 'widget', id: 'right' },
          { kind: 'widget', id: 'bottom' },
          { kind: 'widget', id: 'fourth' },
          { kind: 'widget', id: 'left' }
        ])
        expect(await getWorkspacePreview(dir, { thumbnailUrl })).toEqual({
          thumbnails: ['widget:left', 'widget:right', 'widget:bottom']
        })
      }
    )
  })

  test('puts widgets first and fills remaining slots with recent views', async () => {
    await withWorkspaceFile(
      {
        ...base,
        widgetGrid: [{ i: 'widget', x: 0, y: 0 }]
      },
      async dir => {
        await seedThumbnails(dir, [
          { kind: 'widget', id: 'widget' },
          { kind: 'view', id: 'deleted', viewedAt: '2026-01-04T00:00:00.000Z' },
          { kind: 'view', id: 'recent', viewedAt: '2026-01-03T00:00:00.000Z' },
          { kind: 'view', id: 'older', viewedAt: '2026-01-02T00:00:00.000Z' }
        ])
        expect(
          await getWorkspacePreview(dir, { viewIds: ['older', 'recent'], thumbnailUrl })
        ).toEqual({
          thumbnails: ['widget:widget', 'view:recent', 'view:older']
        })
      }
    )
  })

  test('uses widgets when stored view thumbnails belong to deleted views', async () => {
    await withWorkspaceFile(
      {
        ...base,
        widgetGrid: [{ i: 'widget', x: 0, y: 0 }]
      },
      async dir => {
        await seedThumbnails(dir, [
          { kind: 'widget', id: 'widget' },
          { kind: 'view', id: 'deleted' }
        ])
        expect(await getWorkspacePreview(dir, { viewIds: [], thumbnailUrl })).toEqual({
          thumbnails: ['widget:widget']
        })
      }
    )
  })

  test('loads and normalizes the first user message when the grid is empty', async () => {
    await withWorkspaceFile(base, async dir => {
      const message = `  ${'A'.repeat(260)}\nsecond line  `
      const preview = await getWorkspacePreview(dir, {
        getHarnessPreview: async includeFirstUserMessage => ({
          firstUserMessage: includeFirstUserMessage ? message : undefined,
          updatedAt: 900
        }),
        thumbnailUrl
      })

      expect(preview.thumbnails).toEqual([])
      expect(preview.updatedAt).toBe(900)
      expect(preview.firstUserMessage?.length).toBe(240)
      expect(preview.firstUserMessage?.endsWith('…')).toBe(true)
      expect(preview.firstUserMessage).not.toContain('\n')
    })
  })

  test('loads the message fallback when widgets exist without thumbnails', async () => {
    await withWorkspaceFile(
      {
        ...base,
        widgetGrid: [{ i: 'waiting-for-thumbnail', x: 0, y: 0 }]
      },
      async dir => {
        const preview = await getWorkspacePreview(dir, {
          getHarnessPreview: async includeFirstUserMessage => {
            expect(includeFirstUserMessage).toBe(true)
            return {
              firstUserMessage: 'Shown until a capture lands',
              updatedAt: 900
            }
          },
          thumbnailUrl
        })

        expect(preview).toEqual({
          thumbnails: [],
          firstUserMessage: 'Shown until a capture lands',
          updatedAt: 900
        })
      }
    )
  })

  test('does not load the message fallback when thumbnails exist', async () => {
    await withWorkspaceFile(
      {
        ...base,
        widgetGrid: [{ i: 'captured', x: 0, y: 0 }]
      },
      async dir => {
        await seedThumbnails(dir, [{ kind: 'widget', id: 'captured' }])
        const preview = await getWorkspacePreview(dir, {
          getHarnessPreview: async includeFirstUserMessage => {
            expect(includeFirstUserMessage).toBe(false)
            return {
              firstUserMessage: 'Should stay hidden',
              updatedAt: 900
            }
          },
          thumbnailUrl
        })

        expect(preview).toEqual({ thumbnails: ['widget:captured'], updatedAt: 900 })
      }
    )
  })

  test('keeps an empty folder when the fallback is empty or unreadable', async () => {
    await withWorkspaceFile(base, async dir => {
      expect(
        await getWorkspacePreview(dir, {
          getHarnessPreview: async () => ({ firstUserMessage: ' \n ' }),
          thumbnailUrl
        })
      ).toEqual({
        thumbnails: []
      })
      expect(
        await getWorkspacePreview(dir, {
          getHarnessPreview: async () => {
            throw new Error('unreadable session')
          },
          thumbnailUrl
        })
      ).toEqual({ thumbnails: [] })
    })
  })
})
