#!/usr/bin/env bun
// Plain ESM launcher so Node can parse far enough to print a friendly error.
// The real CLI (server/cli.ts) is TypeScript, uses Bun-only APIs, and relies
// on the `@/` path alias — none of which Node can load. So it MUST be a
// dynamic import placed AFTER the Bun guard below: a static import would be
// hoisted and fail before the guard ever runs.
if (!process.versions.bun) {
  console.error('Moi requires Bun (Node is not supported).')
  console.error('Install Bun:  curl -fsSL https://bun.sh/install | bash')
  console.error('Then run:     bun i -g moi-computer')
  process.exit(1)
}

// The standalone OpenClaw client uses Node's WebSocket upgrade path, which
// fails on Bun 1.3. Reject old runtimes before they fail during connection.
const MIN_BUN = '1.4.0'
if (!Bun.semver?.satisfies(Bun.version, `>=${MIN_BUN}`)) {
  console.error(`Moi requires Bun ${MIN_BUN} or newer (this is Bun ${Bun.version}).`)
  console.error('Upgrade Bun:  bun upgrade')
  process.exit(1)
}

// The `moi` command is meant to live on your PATH permanently: the agent
// shells out to `moi bundle`/`moi refresh` from your workspaces, which only
// works if it's installed. If `moi` doesn't resolve as a command, nudge toward
// a global install. (`Bun.which` honors a custom global bin dir and finds
// installs from any package manager, unlike checking a hardcoded path.)
if (!Bun.which('moi')) {
  console.error('Note: `moi` is not installed as a command — this run is temporary.')
  console.error(
    'Install it so the command stays available (the agent calls it from your workspaces):'
  )
  console.error('  bun i -g moi-computer\n')
}

// Prefer source in a checkout, including after packing for a release test.
const source = new URL('../server/cli.ts', import.meta.url)
await import(
  (await Bun.file(source).exists())
    ? source.href
    : new URL('../runtime/cli.js', import.meta.url).href
)
