import { expect, test } from 'bun:test'

import pkg from '../../package.json'

// Both the browser and server schema are now prebuilt. Keep the pins explicit
// so intentional schema upgrades and the checked-in vendor files stay aligned.
test('tldraw is pinned to an exact version', () => {
  expect(pkg.devDependencies.tldraw).toMatch(/^\d/)
})

// The server writes scratchpad snapshots through tldraw's React-free
// sub-packages (see server/scratchpad/executor.ts), imported directly rather
// than via `tldraw`. They must be pinned to the very same version as `tldraw`:
// they're the schema the server writes, and `tldraw` is the schema the browser
// reads. Bump all four together.
const SERVER_SUBPACKAGES = ['@tldraw/store', '@tldraw/tlschema', '@tldraw/utils'] as const

test('the server-side tldraw sub-packages are pinned to the same exact version', () => {
  for (const name of SERVER_SUBPACKAGES) {
    expect(pkg.devDependencies[name]).toBe(pkg.devDependencies.tldraw)
  }
})
