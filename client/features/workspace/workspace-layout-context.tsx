import { WorkspaceLoadingState, WorkspacePendingScreen } from './workspace-pending-screen'
import { WorkspaceOpenError, WorkspaceUnavailableState } from './workspace-error-states'
import { type ReactNode, createContext, useCallback, useContext, useMemo, useRef } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { useLostRemoteAccess } from '@/client/features/home/remote-workspaces'

import {
  type WorkspaceLayoutResponse,
  useSaveLayout,
  useWorkspaceLayout
} from '@/client/features/workspace/api'
import { workspaceKeys } from '@/client/api/workspace-keys'
import { useLatestRef } from '@/client/lib/use-latest-ref'
import type { WorkspaceLayout, WorkspaceLayoutPatch, HarnessType } from '@/lib/types'
import { createDefaultWorkspaceLayout } from '@/lib/workspace-layout'

import { getWorkspaceAddress } from './remote'
import { useWorkspaceState } from './workspace-state'

export type WorkspaceLayoutContextValue = {
  // Shared widget layout and theme. Falls back to an
  // empty default while the query is still loading.
  layout: WorkspaceLayout
  // Merge a partial update into the layout: updates the query cache immediately
  // (optimistic) then debounces a PUT to the server via the save mutation.
  setLayout: (update: WorkspaceLayoutPatch) => void
  // Workspace metadata that rides along on the layout endpoint.
  name: string | null
  cwd: string | null
  // The agent backend (claude-code / openclaw …). Exposed here so descendants
  // can reuse the shared layout query instead of spawning another observer
  // that could refetch on mount and clobber an optimistic layout update.
  harness: HarnessType | null
  // The workspace's registry id (the route param), so descendants can key
  // their own queries (e.g. the model picker) without prop-drilling.
  workspaceId: string
  apiBase: string
  isRemote: boolean
  isLoading: boolean
}

// Exported (with its value type) so fixture surfaces like /dev/chat-states can
// provide a static value without mounting the query-backed provider.
export const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | null>(null)

export function useWorkspaceLayoutCtx(): WorkspaceLayoutContextValue {
  const ctx = useContext(WorkspaceLayoutContext)
  if (!ctx) throw new Error('useWorkspaceLayoutCtx must be used within <WorkspaceLayoutProvider>')
  return ctx
}

// The theme alone, for chrome that only needs to paint itself (widget frames,
// previews). Unlike `useWorkspaceLayoutCtx` this tolerates being read outside a
// provider and returns `undefined` there, which callers already treat as "use
// the default theme" — so the same component still renders in isolation.
export function useWorkspaceThemeSetting(): WorkspaceLayout['theme'] {
  return useContext(WorkspaceLayoutContext)?.layout.theme
}

// Expose the layout separately from its routing metadata.
function stripMeta(data: WorkspaceLayoutResponse): WorkspaceLayout {
  const {
    cwd: _cwd,
    name: _name,
    harness: _harness,
    agentId: _agentId,
    apiBase: _apiBase,
    isRemote: _isRemote,
    ...layout
  } = data
  return layout
}

type WorkspaceLayoutProviderProps = {
  id: string
  children: ReactNode
}

// Owns the layout query + mutation for a workspace and hands the rest of the
// tree a store-like `{ layout, setLayout }` API backed by React Query.
export function WorkspaceLayoutProvider({ id, children }: WorkspaceLayoutProviderProps) {
  const qc = useQueryClient()
  const query = useWorkspaceLayout(id)
  const save = useSaveLayout(id)
  const personal = useWorkspaceState(id)

  // `setLayout` must be referentially stable (it feeds effect deps in the grid
  // reconcile), so reach the latest mutate via a ref instead of closing over it.
  const saveRef = useLatestRef(save.mutate)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<WorkspaceLayoutPatch | null>(null)

  const setLayout = useCallback(
    (update: WorkspaceLayoutPatch) => {
      const key = workspaceKeys.layout(id)
      const prev = qc.getQueryData<WorkspaceLayoutResponse>(key)
      if (!prev) return
      // A GET already in flight would land the pre-change layout over this edit.
      void qc.cancelQueries({ queryKey: key })
      // Optimistic: the grid/theme reflects the change before the PUT lands.
      const next = { ...prev, ...update }
      qc.setQueryData<WorkspaceLayoutResponse>(key, next)
      pendingSave.current = { ...pendingSave.current, ...update }

      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        const payload = pendingSave.current
        pendingSave.current = null
        if (payload) saveRef.current(payload)
      }, 600)
    },
    [id, qc, saveRef]
  )

  // Memoized so the context value keeps a stable identity across unrelated
  // renders — otherwise every consumer (WorkspaceView, Overview, ModelPicker,
  // TurnView, …) would re-render whenever this provider re-renders. `setLayout`
  // is already stable; the rest derive from `query.data`.
  const value = useMemo<WorkspaceLayoutContextValue>(
    () => ({
      layout: query.data ? stripMeta(query.data) : createDefaultWorkspaceLayout(),
      setLayout,
      name: query.data?.name ?? null,
      cwd: query.data?.cwd ?? null,
      harness: query.data ? (query.data.harness ?? 'claude-code') : null,
      workspaceId: id,
      apiBase: query.data?.apiBase ?? '',
      isRemote: query.data?.isRemote ?? false,
      isLoading: query.isLoading
    }),
    [query.data, query.isLoading, setLayout, id]
  )

  // The owner deleted the workspace or removed this member while it was open.
  const lostAccess = useLostRemoteAccess(
    query.data?.isRemote ? getWorkspaceAddress(id, qc) : undefined
  )

  return (
    <WorkspaceLayoutContext value={value}>
      {lostAccess ? (
        <WorkspacePendingScreen setupRequired>
          <WorkspaceUnavailableState />
        </WorkspacePendingScreen>
      ) : query.isPending || personal.isPending ? (
        <WorkspacePendingScreen>
          <WorkspaceLoadingState />
        </WorkspacePendingScreen>
      ) : (query.isError && !query.data) || (personal.isError && !personal.data) ? (
        <WorkspacePendingScreen setupRequired>
          <WorkspaceOpenError
            error={query.error ?? personal.error!}
            retrying={query.isFetching || personal.isFetching}
            onRetry={() => {
              void query.refetch()
              void personal.refetch()
            }}
          />
        </WorkspacePendingScreen>
      ) : (
        children
      )}
    </WorkspaceLayoutContext>
  )
}
