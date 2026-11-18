import { isRemoteWorkspace } from '@/client/features/workspace/remote'
import type { ComponentType } from 'react'
import { useRouter } from 'wouter'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { workspaceKeys } from '@/client/api/workspace-keys'

import {
  type AppletSegment,
  appletKey,
  appletUrl,
  getCachedApplet,
  invalidateApplet,
  invalidateAppletSegment,
  setCachedApplet
} from '@/client/features/applets/applet-cache'
import { attachAppletBridge } from '@/client/features/applets/applet-runtime'
import { reportAppletError } from '@/client/features/applets/applet-log'
import { useWorkspaceId } from '@/client/features/workspace/workspace-context'
import { type ClientEvent, useWorkspaceEvent } from '@/client/runtime/use-client-events'
import type { AppletKind } from '@/lib/types'

// Views receive URL query params. Widgets mount without params; applets must
// render sensibly with missing fields.
export type AppletComponentProps = {
  params?: Record<string, string>
}

export type AppletState =
  | { status: 'loading'; version: number }
  | { status: 'ready'; Component: ComponentType<AppletComponentProps>; version: number }
  | { status: 'error'; error: string; version: number }

// An applet kind (widget / view) differs only in its URL path segment and which
// MEI events tell it to reload. Everything else — dynamic import, caching,
// cache-busting — is shared. An applet is an agent-authored UI unit loaded as an
// ESM module and mounted into the workspace.
type AppletKindSpec = {
  kind: AppletKind
  segment: AppletSegment
  // True when this MEI event means the named applet should cache-bust + reload.
  shouldReload: (event: ClientEvent, name: string) => boolean
}

const WIDGET_KIND: AppletKindSpec = {
  kind: 'widget',
  segment: 'widgets',
  shouldReload: (e, name) =>
    (e.type === 'widget:changed' && e.name === name) ||
    (e.type === 'applets:refresh' && e.only !== 'views' && (!e.name || e.name === name))
}

const VIEW_KIND: AppletKindSpec = {
  kind: 'view',
  segment: 'views',
  shouldReload: (e, name) =>
    (e.type === 'view:changed' && e.name === name) ||
    (e.type === 'applets:refresh' && e.only !== 'widgets' && (!e.name || e.name === name))
}

function loadApplet(
  kind: AppletKindSpec,
  workspaceId: string,
  name: string,
  base: string
): Promise<ComponentType<AppletComponentProps>> {
  const { segment } = kind
  const key = appletKey(segment, workspaceId, name)
  const existing = getCachedApplet(key) as Promise<ComponentType<AppletComponentProps>> | undefined
  if (existing) return existing

  // Import the bundle dir's entry at its current `?v`; the version is bumped
  // (and this entry dropped) by `invalidateApplet` on every rebuild — including
  // while this applet is unmounted — so a backgrounded tab never serves stale.
  const promise = import(/* @vite-ignore */ appletUrl(segment, workspaceId, name)).then(mod => {
    if (!mod.default) throw new Error(`"${name}" has no default export`)
    // Wire this module instance's `moi` bridge to the workspace's applet
    // runtime — the only moment the namespace is in hand, before React renders
    // the component. Disposal rides invalidateApplet (same key). The identity
    // passed here is what the applet's chat messages are attributed to.
    attachAppletBridge(mod, workspaceId, key, { kind: kind.kind, name }, base)
    return mod.default as ComponentType<AppletComponentProps>
  })

  setCachedApplet(key, promise)
  return promise
}

function useApplet(kind: AppletKindSpec, name: string, revision?: string): AppletState {
  const workspaceId = useWorkspaceId()
  const { base } = useRouter()
  const key = appletKey(kind.segment, workspaceId, name)
  const generation = useRef(0)
  const [loaded, setLoaded] = useState<{ key: string; state: AppletState }>({
    key,
    state: { status: 'loading', version: 0 }
  })
  const state: AppletState = loaded.key === key ? loaded.state : { status: 'loading', version: 0 }

  const load = useCallback(() => {
    const request = ++generation.current
    loadApplet(kind, workspaceId, name, base)
      .then(Component => {
        if (request !== generation.current) return
        setLoaded(prev => ({
          key,
          state: { status: 'ready', Component, version: prev.state.version + 1 }
        }))
      })
      .catch(err => {
        if (request !== generation.current) return
        // Journal the load failure so `moi debug logs` can surface it to the
        // agent — otherwise only this tab ever sees it (docs/self-correction.md).
        reportAppletError(workspaceId, {
          source: 'load',
          kind: kind.kind,
          name,
          message: String(err),
          ...(err instanceof Error && err.stack ? { stack: err.stack } : {})
        })
        setLoaded(prev =>
          prev.key === key && prev.state.status === 'ready'
            ? prev
            : {
                key,
                state: { status: 'error', error: String(err), version: prev.state.version + 1 }
              }
        )
      })
  }, [base, kind, workspaceId, name, key])

  useEffect(() => {
    load()
    return () => {
      generation.current++
    }
  }, [load])

  // Reload the MOUNTED applet the moment the server says its bundle changed or
  // `moi refresh` targets its kind. Invalidate first so we don't re-read a stale
  // cache entry — `useAppletCacheInvalidation` may already have done so for the
  // unmounted case, but doing it here keeps this self-sufficient and
  // order-independent. The bumped version remounts the component and re-runs its
  // `rpc()` calls.
  useWorkspaceEvent(workspaceId, event => {
    if (kind.shouldReload(event, name)) {
      invalidateApplet(kind.segment, workspaceId, name)
      load()
    }
  })

  // Revisions catch rebuilds missed while the owner's socket was disconnected.
  const remote = isRemoteWorkspace(workspaceId)
  const seen = useRef({ key, revision })
  useEffect(() => {
    const previous = seen.current
    seen.current = { key, revision }
    if (!remote || previous.key !== key || previous.revision === revision) return
    if (previous.revision === undefined || revision === undefined) return
    invalidateApplet(kind.segment, workspaceId, name)
    load()
  }, [remote, key, revision, kind.segment, workspaceId, name, load])
  return state
}

// `revision` is the bundle revision from the widgets/views list.
export function useWidget(name: string, revision?: string): AppletState {
  return useApplet(WIDGET_KIND, name, revision)
}

export function useView(name: string, revision?: string): AppletState {
  return useApplet(VIEW_KIND, name, revision)
}

// Mount once per workspace (in the workspace route). Invalidates the shared
// applet module cache on every `*:updated` event, regardless of what's currently
// mounted — so an applet edited while its tab is backgrounded is fetched fresh on
// the next mount instead of served stale. The per-applet listener above only
// fires while that applet is on screen; this covers the (common) rest.
export function useAppletCacheInvalidation(): void {
  const workspaceId = useWorkspaceId()
  const queryClient = useQueryClient()
  useWorkspaceEvent(workspaceId, event => {
    // Refresh the owner lists too, so new or removed applets become visible.
    if (
      isRemoteWorkspace(workspaceId, queryClient) &&
      (event.type === 'applets:refresh' ||
        event.type === 'view:changed' ||
        event.type === 'widget:changed')
    ) {
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.views(workspaceId)
      })
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.widgets(workspaceId)
      })
    }
    if (event.type === 'view:changed') invalidateApplet('views', workspaceId, event.name)
    else if (event.type === 'widget:changed') invalidateApplet('widgets', workspaceId, event.name)
    else if (event.type === 'applets:refresh') {
      if (event.only && event.name) {
        invalidateApplet(event.only, workspaceId, event.name)
        return
      }
      if (event.only !== 'views') invalidateAppletSegment('widgets', event.workspaceId)
      if (event.only !== 'widgets') invalidateAppletSegment('views', event.workspaceId)
    }
  })
}
