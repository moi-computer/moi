import type { WorkspaceTabId } from '@/lib/types'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type WorkspaceSession = {
  activeTab?: WorkspaceTabId
  chatOpen?: boolean
}

type WorkspaceSessionStore = {
  workspaces: Record<string, WorkspaceSession>
  setWorkspaceSession: (workspaceId: string, patch: WorkspaceSession) => void
}

// Per-browser-tab UI state that survives reloads.
export const useWorkspaceSessionStore = create<WorkspaceSessionStore>()(
  persist(
    set => ({
      workspaces: {},
      setWorkspaceSession: (workspaceId, patch) =>
        set(state => ({
          workspaces: {
            ...state.workspaces,
            [workspaceId]: { ...state.workspaces[workspaceId], ...patch }
          }
        }))
    }),
    { name: 'moi:workspace-session', storage: createJSONStorage(() => sessionStorage) }
  )
)
