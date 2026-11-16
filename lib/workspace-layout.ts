import { createDefaultWidgetGrid } from './default-widgets'
import type { PersonalWorkspaceLayout, WorkspaceLayout, WorkspaceTabsState } from './types'
import { isWorkspaceTabId } from './workspace-tabs'

export function createDefaultWorkspaceTabs(): WorkspaceTabsState {
  return { open: ['overview'], active: 'overview' }
}

export function normalizeWorkspaceTabs(value: unknown): WorkspaceTabsState {
  const defaults = createDefaultWorkspaceTabs()
  if (!value || typeof value !== 'object') return defaults

  const raw = value as Record<string, unknown>
  const savedOpen = Array.isArray(raw.open)
    ? raw.open.filter(isWorkspaceTabId).filter((tab, index, all) => all.indexOf(tab) === index)
    : []
  if (savedOpen.length === 0) return defaults

  const open = [
    'overview',
    ...savedOpen.filter(tab => tab !== 'overview')
  ] satisfies WorkspaceTabsState['open']
  const active = isWorkspaceTabId(raw.active) && open.includes(raw.active) ? raw.active : 'overview'
  return { open, active }
}

export function createDefaultWorkspaceLayout(): WorkspaceLayout {
  return {
    version: 2,
    widgetGrid: createDefaultWidgetGrid()
  }
}

export function createDefaultPersonalLayout(): PersonalWorkspaceLayout {
  return {
    tabs: createDefaultWorkspaceTabs(),
    layoutMode: 'split',
    chatOpen: false,
    dockedChatWidth: 360,
    popupChatWidth: 440
  }
}

export function parsePersonalLayoutPatch(
  value: unknown
): Partial<PersonalWorkspaceLayout> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const input = value as Record<string, unknown>
  const patch: Partial<PersonalWorkspaceLayout> = {}
  for (const key of Object.keys(input)) {
    const field = input[key]
    if (key === 'layoutMode') {
      if (field !== 'split' && field !== 'fullscreen') return
      patch.layoutMode = field
    } else if (key === 'chatOpen') {
      if (typeof field !== 'boolean') return
      patch.chatOpen = field
    } else if (key === 'dockedChatWidth' || key === 'popupChatWidth') {
      if (typeof field !== 'number' || !Number.isFinite(field) || field <= 0) return
      patch[key] = field
    } else if (key === 'tabs') {
      if (!field || typeof field !== 'object') return
      const tabs = field as Record<string, unknown>
      if (
        !Array.isArray(tabs.open) ||
        !tabs.open.every(isWorkspaceTabId) ||
        !isWorkspaceTabId(tabs.active)
      )
        return
      patch.tabs = normalizeWorkspaceTabs(tabs)
    } else return
  }
  return patch
}
