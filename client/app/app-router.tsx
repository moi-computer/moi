import { OnboardingRoute } from './routes/onboarding-route'
import { Suspense, lazy } from 'react'

import { Redirect, Route, Switch, useLocation } from 'wouter'

import { homePath } from '@/client/api/app-config'
import { useClientEvent } from '@/client/runtime/use-client-events'
import { useWorkspaceStateSync } from '@/client/features/workspace/workspace-state'

import { SettingsRoute } from './routes/settings-route'
import { HomeRoute } from './routes/home-route'
import { WorkspaceRoute } from './routes/workspace-route'

// Dev-only playground routes: colocated in features/dev and loaded as a
// separate lazy chunk. The NODE_ENV gate is statically false in the prod
// build (scripts/build-client.ts defines it), so the bundler drops the
// dynamic import and none of features/dev is emitted into dist at all.
// In production /dev redirects home.
const DevRoutes =
  process.env.NODE_ENV === 'development'
    ? lazy(() => import('@/client/features/dev/dev-routes'))
    : null

function DevLazy() {
  if (!DevRoutes) return <Redirect to={homePath()} />
  return (
    <Suspense fallback={null}>
      <DevRoutes />
    </Suspense>
  )
}

// Top-level router — sets up all client-side routes
export function AppRouter() {
  const [, navigate] = useLocation()
  useWorkspaceStateSync()

  useClientEvent(event => {
    if (event.type === 'workspace:open-requested') navigate(`/workspace/${event.workspaceId}`)
  })

  return (
    <Switch>
      <Route path="/dev/*?" component={DevLazy} />
      <Route path={homePath()} component={HomeRoute} />
      <Route path="/onboarding" component={OnboardingRoute} />
      <Route path="/settings" component={SettingsRoute} />
      {/* The wildcard is the destination path (`views/orders`, `overview`, …) —
          the URL is the tab address, read downstream with `useParams`. This
          pattern is its only definition. Keyed by workspace id only, so tab
          switches never remount the workspace tree. */}
      <Route path="/workspace/:id/*?">
        {(params: { id: string }) => <WorkspaceRoute key={params.id} id={params.id} />}
      </Route>
    </Switch>
  )
}
