import { mkdir, writeFile } from 'node:fs/promises'
import {
  parseRemoteWorkspaceConfig,
  parseRemoteWorkspaceTarget,
  type RemoteWorkspaceTarget,
  type WorkspaceFileConfig
} from '@/lib/workspace-config'
import { join } from 'path'

import type { AppletKind, WorkspaceLayout, WorkspacePreview } from '@/lib/types'
import { createDefaultWorkspaceLayout } from '@/lib/workspace-layout'
import { isWorkspaceIcon } from '@/lib/workspace-icon'

import { getCapturedThumbnails } from '../applets/thumbnails'

function normalizeLayout(parsed: Record<string, unknown>): WorkspaceLayout {
  return {
    version: 2,
    widgetGrid: (parsed.widgetGrid ??
      createDefaultWorkspaceLayout().widgetGrid) as WorkspaceLayout['widgetGrid'],
    ...(typeof parsed.name === 'string' && { name: parsed.name }),
    ...(isWorkspaceIcon(parsed.icon) && { icon: parsed.icon }),
    ...(typeof parsed.theme === 'object' &&
      parsed.theme !== null && { theme: parsed.theme as WorkspaceLayout['theme'] })
  }
}

export function getLayoutPath(workspacePath: string): string {
  return join(workspacePath, '.moi', '.workspace.json')
}

// This module remains the sole owner of workspace config persistence.
export async function loadWorkspaceFileConfig(workspacePath: string): Promise<WorkspaceFileConfig> {
  const file = Bun.file(getLayoutPath(workspacePath))
  if (!(await file.exists())) return createDefaultWorkspaceLayout()
  const parsed: unknown = await file.json()
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid workspace config')
  const value = parsed as Record<string, unknown>
  if ('remote' in value) return parseRemoteWorkspaceConfig(value)
  if (value.version !== 1 && value.version !== 2)
    throw new Error('Unsupported workspace config version')
  return normalizeLayout(value)
}

export async function loadLayout(workspacePath: string): Promise<WorkspaceLayout> {
  const config = await loadWorkspaceFileConfig(workspacePath)
  if (config.remote) throw new Error('Remote workspace has no local layout')
  return config
}

export async function saveLayout(layout: WorkspaceLayout, workspacePath: string): Promise<void> {
  const existing = await loadWorkspaceFileConfig(workspacePath)
  if (existing.remote)
    throw new Error('Cannot replace a remote workspace reference with a local layout')
  await Bun.write(getLayoutPath(workspacePath), JSON.stringify(layout, null, 2))
}

// The editor owns widgets and theme; identity changes use the config API.
export function mergeLayoutForSave(
  existing: WorkspaceLayout,
  body: WorkspaceLayout
): WorkspaceLayout {
  return normalizeLayout({
    ...existing,
    widgetGrid: body.widgetGrid ?? existing.widgetGrid,
    theme: body.theme ?? existing.theme
  })
}

// Thumbnails for the home screen's workspace card. Widgets take the front
// slots in grid order, then recent views fill what remains.
const PREVIEW_LIMIT = 3
const PREVIEW_MESSAGE_LIMIT = 240

function normalizePreviewMessage(message: string | undefined): string | undefined {
  const normalized = message?.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  if (normalized.length <= PREVIEW_MESSAGE_LIMIT) return normalized
  return `${normalized.slice(0, PREVIEW_MESSAGE_LIMIT - 1).trimEnd()}…`
}

export type WorkspacePreviewOptions = {
  getHarnessPreview?: (includeFirstUserMessage: boolean) => Promise<{
    firstUserMessage?: string
    updatedAt?: number
  }>
  viewIds?: readonly string[]
  // Maps a captured applet to the image URL the home card should render —
  // the API layer owns the route shape (GET .../applet-thumbnails/:kind/:id).
  // `version` changes with every capture, so the URL can be cached forever.
  thumbnailUrl: (kind: AppletKind, id: string, version: string) => string
}

export async function getWorkspacePreview(
  workspacePath: string,
  { getHarnessPreview, viewIds = [], thumbnailUrl }: WorkspacePreviewOptions
): Promise<WorkspacePreview> {
  try {
    const layout = await loadLayout(workspacePath)
    const captured = await getCapturedThumbnails(workspacePath)
    const validViewIds = new Set(viewIds)
    const capturedWidgets = new Map(
      captured
        .filter(record => record.kind === 'widget')
        .map(record => [record.id, record.capturedAt])
    )
    const widgetImages = [...layout.widgetGrid]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .flatMap(item => {
        const version = capturedWidgets.get(item.i)
        return version === undefined ? [] : [thumbnailUrl('widget', item.i, version)]
      })
    const viewImages = captured
      .filter(record => record.kind === 'view' && validViewIds.has(record.id))
      .sort((a, b) => Date.parse(b.viewedAt) - Date.parse(a.viewedAt))
      .map(record => thumbnailUrl('view', record.id, record.capturedAt))
    const thumbnails = [...widgetImages, ...viewImages].slice(0, PREVIEW_LIMIT)
    // The message bubble is the card's fallback for "nothing to show": gate on
    // captured thumbnails, not grid emptiness — a workspace with widgets that
    // were never captured (never opened in a browser) still renders an empty
    // folder otherwise.
    const includeFirstUserMessage = thumbnails.length === 0
    const harnessPreview = await getHarnessPreview?.(includeFirstUserMessage).catch(() => undefined)
    const updatedAt = harnessPreview?.updatedAt
    const theme = layout.theme

    if (includeFirstUserMessage) {
      const firstUserMessage = normalizePreviewMessage(harnessPreview?.firstUserMessage)
      return {
        thumbnails,
        ...(firstUserMessage ? { firstUserMessage } : {}),
        ...(updatedAt !== undefined ? { updatedAt } : {}),
        ...(theme ? { theme } : {})
      }
    }

    return {
      thumbnails,
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      ...(theme ? { theme } : {})
    }
  } catch {
    return { thumbnails: [] }
  }
}

export async function initializeRemoteWorkspaceConfig(
  workspacePath: string,
  remote: RemoteWorkspaceTarget
): Promise<void> {
  remote = parseRemoteWorkspaceTarget(remote)
  await mkdir(join(workspacePath, '.moi'), { recursive: true })
  await writeFile(getLayoutPath(workspacePath), JSON.stringify({ version: 2, remote }, null, 2), {
    flag: 'wx'
  })
}
