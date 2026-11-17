import { createDefaultWidgetGrid } from './default-widgets'
import type { WorkspaceLayout, WorkspaceTabsState } from './types'
import { isWorkspaceTabId } from './workspace-tabs'

export function normalizeOpenTabs(value: unknown): WorkspaceTabsState['open'] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(tab => isWorkspaceTabId(tab) && tab !== 'overview'))]
}

export function createDefaultWorkspaceLayout(): WorkspaceLayout {
  return {
    version: 2,
    widgetGrid: createDefaultWidgetGrid()
  }
}
