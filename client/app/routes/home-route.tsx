import { Redirect } from 'wouter'
import { useOnboardingSettings } from '@/client/features/onboarding/api'
import { SidebarLayout } from '@/client/app/shell/sidebar-layout'
import { HomePage } from '@/client/features/home/home-page'

// The home route (`/`, or `/demo` in demo mode): the app shell wrapping the workspaces view.
export function HomeRoute() {
  const onboarding = useOnboardingSettings()
  if (onboarding.loading) return null
  if (onboarding.showOnboarding) return <Redirect to="/onboarding" />
  return (
    <SidebarLayout showWorkspaces={false}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <HomePage />
      </div>
    </SidebarLayout>
  )
}
