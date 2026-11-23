import { useState, useSyncExternalStore } from 'react'

import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { USER_COLORS } from '@/lib/collab/colors'
import type { UserProfile } from '@/lib/collab/types'
import { User } from '@/client/features/collab/components/user'
import { UserAvatar } from '@/client/features/collab/components/user-avatar'
import {
  getCurrentUser,
  getCurrentUserSource,
  setLocalUser,
  subscribeCurrentUserStore
} from '@/client/features/collab/host-state'
import {
  getLocalTestProfile,
  setLocalTestProfile,
  useLocalCollabTesting
} from '@/client/features/collab/local-test-profile'
import { localUserProfile } from '@/client/features/collab/local-user'

export function LocalUserSettings() {
  const testing = useLocalCollabTesting()
  const source = useSyncExternalStore(
    subscribeCurrentUserStore,
    getCurrentUserSource,
    getCurrentUserSource
  )
  const profile = useSyncExternalStore(subscribeCurrentUserStore, getCurrentUser, getCurrentUser)
  if (source === 'external') {
    return profile ? (
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Signed-in user</h2>
        <User profile={profile} />
      </section>
    ) : null
  }
  if (source === 'cloudflare-access') return <AccessUser profile={profile} />
  if (profile) return <LocalUserEditor key={profile.id} profile={profile} testing={testing} />
  return (
    <section aria-labelledby="local-user-title" className="flex flex-col gap-5">
      <h2 id="local-user-title" className="text-base font-medium">
        Local user
      </h2>
      <p className="text-sm text-muted-foreground">
        Couldn’t resolve your user identity. Reload Moi to try again.
      </p>
    </section>
  )
}

type AccessUserProps = { profile: UserProfile | undefined }

// Behind Cloudflare Access the profile is inherited, so there is nothing to edit.
// Access profiles carry no name, so the label is the email, as in workspaces.
function AccessUser({ profile }: AccessUserProps) {
  return (
    <section aria-labelledby="access-user-title" className="flex flex-col gap-5">
      <header>
        <h2 id="access-user-title" className="text-base font-medium">
          Cloudflare Access user
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {profile
            ? 'This server uses your Cloudflare Access account. You appear by your email, with a color picked from your Access user ID.'
            : 'This server uses Cloudflare Access, but this page wasn’t opened through it. Open Moi at its Cloudflare Access address to appear in workspaces.'}
        </p>
      </header>
      {profile && <User profile={profile} />}
    </section>
  )
}

type LocalUserEditorProps = { profile: UserProfile; testing: boolean }

function LocalUserEditor({ profile, testing }: LocalUserEditorProps) {
  const [saved, setSaved] = useState(() => (testing ? getLocalTestProfile() : undefined))
  const initial = saved ?? profile
  const [name, setName] = useState(initial.name ?? '')
  const [color, setColor] = useState(initial.color)
  const trimmedName = name.trim()
  const preview = testing ? { ...initial, name: trimmedName || undefined, color } : profile
  const canSave = trimmedName && (!saved || saved.name !== trimmedName || saved.color !== color)

  return (
    <section aria-labelledby="local-user-title" className="flex flex-col gap-5">
      <header>
        <h2 id="local-user-title" className="text-base font-medium">
          Local user
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {testing
            ? 'Set the name and color you’ll use in local workspaces in this tab.'
            : 'Change your collaboration color here. Edit your name in Settings.'}
        </p>
      </header>
      <form
        className="flex flex-col gap-5"
        onSubmit={event => {
          event.preventDefault()
          if (!testing || !canSave) return
          const next = localUserProfile(saved?.id ?? `dev-${crypto.randomUUID()}`, { name, color })
          setLocalTestProfile(next)
          setSaved(next)
        }}
      >
        <div className="flex flex-col items-start gap-5 sm:flex-row">
          <div
            data-collab-color={preview.color}
            role="img"
            aria-label="Local user preview"
            className="size-16 shrink-0 overflow-hidden rounded-full"
          >
            <UserAvatar profile={preview} className="data-[size=default]:size-full" />
          </div>
          <div className="flex w-full max-w-sm min-w-0 flex-col gap-4">
            {testing && (
              <div className="flex flex-col gap-1.5 text-sm">
                <label htmlFor="collab-user-name">Name</label>
                <Input
                  id="collab-user-name"
                  value={name}
                  maxLength={80}
                  onChange={event => setName(event.target.value)}
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5 text-sm">
              <span id="collab-color-label">Color</span>
              <div
                role="radiogroup"
                aria-labelledby="collab-color-label"
                className="flex flex-wrap gap-2"
              >
                {USER_COLORS.map(color => (
                  <label key={color} data-collab-color={color} className="cursor-pointer">
                    <input
                      type="radio"
                      name="color"
                      value={color}
                      aria-label={color[0].toUpperCase() + color.slice(1)}
                      checked={preview.color === color}
                      onChange={() => {
                        if (testing) setColor(color)
                        else setLocalUser({ ...profile, color })
                      }}
                      className="peer sr-only"
                    />
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="size-6 rounded-full ring-foreground ring-offset-2 ring-offset-background transition-shadow peer-checked:ring-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                    >
                      <circle cx="12" cy="12" r="12" className="fill-collab" />
                    </svg>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
        {testing ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!canSave}>
                Save for this tab
              </Button>
              {saved && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setLocalTestProfile()
                    setSaved(undefined)
                    setName(profile.name ?? '')
                    setColor(profile.color)
                  }}
                >
                  Reset to default
                </Button>
              )}
            </div>
            {saved && (
              <p role="status" className="text-sm text-muted-foreground">
                Using {saved.name} in this tab
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your user is saved in this browser and shared across tabs. The playground below uses its
            own sample users.
          </p>
        )}
      </form>
    </section>
  )
}
