import type { NavigationRequest } from './navigation'
import type {
  AppSettings,
  CompiledView,
  HarnessAvailability,
  HarnessStatus,
  HarnessType,
  WidgetInfo,
  WorkspaceState
} from './types'

// The workspace URL supplies scope on the wire; the browser adds its local ID.
export type SharedWorkspaceEvent =
  | { type: 'widget:updated'; name: string }
  | { type: 'widget-layout:updated'; widgets: WidgetInfo[] }
  | { type: 'applets:refresh'; only?: 'widgets' | 'views' }
  | { type: 'view:updated'; name: string }
  | { type: 'view-layout:updated'; views: CompiledView[] }
  | { type: 'view:deleted'; name: string }
  | { type: 'theme:updated'; origin?: string }
  | { type: 'workspace:updated'; origin?: string }
  | { type: 'scratchpad:updated'; origin?: string }

export type HarnessEvent =
  | { type: 'harness-status:changed'; harness: HarnessType; status: HarnessStatus }
  | { type: 'harness:updated'; workspaceId: string; availability: HarnessAvailability }
  | { type: 'workspace-harness:switched'; workspaceId: string; harness: HarnessType }

export type WorkspaceEvent =
  | (SharedWorkspaceEvent & { workspaceId?: string })
  | HarnessEvent
  // The machine's app socket opened or reopened.
  | { type: 'connection:opened' }
  // The shown workspace's owner socket opened or reopened.
  | { type: 'workspace:connected'; workspaceId: string }
  | { type: 'state:changed'; workspaceId: string; state: WorkspaceState }
  | { type: 'env:updated'; workspaceId: string }
  | { type: 'workspaces-list:updated'; origin?: string }
  | { type: 'settings:updated'; settings: AppSettings }
  | NavigationRequest

export function isSharedWorkspaceEvent(event: { type?: unknown }): event is SharedWorkspaceEvent {
  switch (event.type) {
    case 'widget:updated':
    case 'widget-layout:updated':
    case 'applets:refresh':
    case 'view:updated':
    case 'view-layout:updated':
    case 'view:deleted':
    case 'theme:updated':
    case 'workspace:updated':
    case 'scratchpad:updated':
      return true
    default:
      return false
  }
}
