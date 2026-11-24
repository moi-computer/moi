import { loadWorkspaceFileConfig } from './layout'
import { existsSync, realpathSync } from 'node:fs'
import { readdir, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'path'

import { sameRemoteWorkspace, type RemoteWorkspaceTarget } from '@/lib/workspace-config'
import { newWorkspaceId, validateWorkspaceId } from '@/lib/ids'
import type { WorkspaceSuggestion, WorkspaceEntry, HarnessType } from '@/lib/types'
import { orderHarnesses } from '@/lib/harness-types'

import { DATA_DIR } from '../data-dir'
import { allHarnesses } from '../harness/registry'
import type { HarnessWorkspaceSuggestion } from '../harness/types'
import { createdWorkspacesRoot } from '../app-config'
import { findStateIdForPath } from '../workspace-state'

// Replace the home-dir prefix with `~` for display. Keeps the original
// absolute path in place; callers should put the result in `displayPath`.
export function tildify(absPath: string): string {
  const home = homedir()
  if (!home) return absPath
  if (absPath === home) return '~'
  const prefix = home.endsWith('/') ? home : home + '/'
  if (absPath.startsWith(prefix)) return '~/' + absPath.slice(prefix.length)
  return absPath
}

function withDisplayPath<T extends { path: string }>(entry: T): T & { displayPath: string } {
  return { ...entry, displayPath: tildify(entry.path) }
}

export const DEFAULT_REGISTRY_PATH = join(DATA_DIR, 'workspaces.json')

// Overridable for tests
let _registryPath = DEFAULT_REGISTRY_PATH
export function setRegistryPath(p: string) {
  _registryPath = p
}

// A workspace in trash stays in the registry file with `trashedAt`, and is left
// out of every lookup and listing except the trash ones below. The API, the CLI
// and agents therefore all see it as gone. `deleting` marks an entry whose
// permanent deletion has started, so it can only finish, never be restored.
type StoredEntry = WorkspaceEntry & { deleting?: true | RemoteWorkspaceTarget }

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

async function readRegistry(): Promise<StoredEntry[]> {
  // A fresh install reads the registry before anything has written it. Skip
  // the read while the file is missing: on Windows, a Bun.file() read under a
  // not-yet-created data dir can exit the CLI before its ENOENT rejection is
  // delivered (the silent `moi init` no-op from #136). existsSync is a plain
  // synchronous stat, so it cannot leave the event loop empty, and the read
  // path stays free of side effects: the first write creates the directory.
  if (!existsSync(_registryPath)) return []
  try {
    const text = await Bun.file(_registryPath).text()
    // `type` is the field's name in registries written before it became `harness`.
    const entries = JSON.parse(text) as (StoredEntry & { type?: HarnessType })[]
    return entries.map(({ remote: _storedRemote, type, ...entry }) =>
      type && !entry.harness ? { ...entry, harness: type } : entry
    )
  } catch {
    return []
  }
}

// Owner routing lives in each folder's config. Reading it costs a file per
// entry, so only listings and single lookups pay for it, never every registry read.
async function withRemote(entry: WorkspaceEntry): Promise<WorkspaceEntry> {
  const config = await loadWorkspaceFileConfig(entry.path).catch(() => undefined)
  return config?.remote ? { ...entry, remote: config.remote } : entry
}

async function writeRegistry(entries: StoredEntry[]): Promise<void> {
  const temporaryPath = `${_registryPath}.${crypto.randomUUID()}.tmp`
  try {
    // Owner routing is derived from each folder's config, never persisted here.
    const stored = entries.map(({ remote: _remote, ...entry }) => entry)
    await Bun.write(temporaryPath, JSON.stringify(stored, null, 2))
    await rename(temporaryPath, _registryPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

// Lock the whole read-modify-write operation, including validation. Atomic
// replacement keeps readers safe; the queue keeps concurrent writers safe.
let writeChain: Promise<unknown> = Promise.resolve()

function locked<T>(operation: () => Promise<T>): Promise<T> {
  const run = writeChain.then(operation)
  writeChain = run.catch(() => {})
  return run
}

// An unregistered workspace keeps its state folder. Re-adding the same folder takes
// its old id back, and with it the pinned chat, selections and chat settings.
async function previousWorkspaceId(
  entries: WorkspaceEntry[],
  normalPath: string
): Promise<string | undefined> {
  const id = await findStateIdForPath(normalPath)
  if (!id || validateWorkspaceId(id) || entries.some(e => e.id === id)) return undefined
  return id
}

export type RegisterOptions = {
  // Register under this id instead of a generated one. Only accepted while the
  // workspace is unregistered — see `workspaceIdError`.
  id?: string
  harness?: HarnessType
  name?: string
  agentId?: string
  isDefault?: boolean
  lastRunAt?: string
}

// Why a chosen id can be refused. An id is baked into `/workspace/<id>` URLs
// and outlives the registration, so it is assigned once: a workspace that
// already carries an id keeps it, and no two workspaces may share one.
function workspaceIdError(
  entries: WorkspaceEntry[],
  normalPath: string,
  id: string
): string | null {
  const invalid = validateWorkspaceId(id)
  if (invalid) return invalid
  const existing = entries.find(e => e.path === normalPath)
  if (existing && existing.id !== id) {
    return `${normalPath} is already registered with id ${existing.id}`
  }
  if (entries.some(e => e.id === id && e.path !== normalPath)) {
    return `Workspace id ${id} is already taken`
  }
  return null
}

// Check a chosen id against the registry without registering anything, so a
// caller can fail before doing expensive setup work. `registerWorkspace`
// re-checks, so this is a courtesy, not the enforcement point.
export async function assertWorkspaceIdAvailable(absPath: string, id: string): Promise<void> {
  const error = workspaceIdError(await readRegistry(), resolve(absPath), id)
  if (error) throw new Error(error)
}

export async function registerWorkspace(
  absPath: string,
  opts: RegisterOptions = {}
): Promise<WorkspaceEntry> {
  return locked(async () => {
    const normalPath = resolve(absPath)
    const remote = (await loadWorkspaceFileConfig(normalPath).catch(() => undefined))?.remote
    const entries = await readRegistry()
    if (opts.id) {
      const error = workspaceIdError(entries, normalPath, opts.id)
      if (error) throw new Error(error)
    }
    const existing = entries.find(e => e.path === normalPath)
    if (existing?.trashedAt) throw new Error('This workspace is in trash. Restore it from Home')
    if (existing) return remote ? { ...existing, remote } : existing
    if (remote) {
      // One registration per owner workspace, whichever folder points at it.
      const duplicate = (await Promise.all(entries.filter(e => !e.trashedAt).map(withRemote))).find(
        entry => sameRemoteWorkspace(entry.remote, remote)
      )
      if (duplicate) return withDisplayPath(duplicate)
    }
    const entry: WorkspaceEntry = {
      id: opts.id ?? (await previousWorkspaceId(entries, normalPath)) ?? newWorkspaceId(),
      ...(remote ? { remote } : {}),
      path: normalPath,
      addedAt: new Date().toISOString(),
      ...(opts.harness ? { harness: opts.harness } : {}),
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
      ...(opts.isDefault ? { isDefault: opts.isDefault } : {}),
      ...(opts.lastRunAt ? { lastRunAt: opts.lastRunAt } : {})
    }
    await writeRegistry([entry, ...entries])
    return withDisplayPath(entry)
  })
}

export async function getWorkspace(id: string): Promise<WorkspaceEntry | null> {
  const entry = (await readRegistry()).find(e => e.id === id && !e.trashedAt)
  return entry ? withRemote(entry) : null
}

export async function unregisterWorkspace(id: string): Promise<boolean> {
  return locked(async () => {
    const entries = await readRegistry()
    const next = entries.filter(e => e.id !== id || e.trashedAt)
    if (next.length === entries.length) return false
    await writeRegistry(next)
    return true
  })
}

export async function listWorkspaces(): Promise<WorkspaceEntry[]> {
  const active = (await readRegistry()).filter(e => !e.trashedAt)
  return (await Promise.all(active.map(withRemote))).map(withDisplayPath)
}

export async function reorderWorkspaces(ids: string[]): Promise<WorkspaceEntry[]> {
  return locked(async () => {
    const stored = await readRegistry()
    const entries = stored.filter(e => !e.trashedAt)
    if (ids.length !== entries.length)
      throw new Error('Workspace order must include every workspace')

    const unique = new Set(ids)
    if (unique.size !== ids.length) throw new Error('Workspace order contains duplicate ids')

    const byId = new Map(entries.map(e => [e.id, e]))
    const next = ids.map(id => byId.get(id))
    if (next.some(e => !e)) throw new Error('Workspace order contains unknown ids')

    const ordered = next as WorkspaceEntry[]
    await writeRegistry([...ordered, ...stored.filter(e => e.trashedAt)])
    return (await Promise.all(ordered.map(withRemote))).map(withDisplayPath)
  })
}

// Resolve a path to the registered workspace that *contains* it: the entry
// whose path equals `reqPath` or is its nearest ancestor (longest matching
// prefix, git-style). This lets workspace-scoped commands (e.g. `moi bundle`)
// run from `.moi/` or any subdirectory and still target the real root, instead
// of treating the CWD as a workspace and scaffolding a phantom nested `.moi/`.
// Returns null when the path is not inside any registered workspace.
export function findWorkspaceForPath<T extends { path: string }>(
  workspaces: T[],
  reqPath: string
): T | null {
  // Shells can resolve aliases such as macOS /tmp → /private/tmp differently.
  function canonicalPath(path: string) {
    try {
      return realpathSync(path)
    } catch {
      return resolve(path)
    }
  }
  const normal = canonicalPath(reqPath)
  const matches = workspaces
    .map(workspace => ({ workspace, path: canonicalPath(workspace.path) }))
    .filter(w => normal === w.path || normal.startsWith(w.path + sep))
  if (matches.length === 0) return null
  return matches.reduce((best, w) => (w.path.length > best.path.length ? w : best)).workspace
}

// If `p` lies inside a workspace's `.moi/` directory, return the workspace root
// (the directory that contains that `.moi`); otherwise return `p` unchanged.
// Cuts at the FIRST `.moi` segment, so an accidentally-nested `.moi/.moi/…`
// path lifts all the way back to the real root. Pure (no filesystem access) —
// `moi init` uses it so running from inside `.moi` never creates a nested
// workspace, and the command always targets the real workspace root.
export function liftToWorkspaceRoot(p: string): string {
  const normal = resolve(p)
  const segments = normal.split(sep)
  const i = segments.indexOf('.moi')
  if (i === -1) return normal
  return segments.slice(0, i).join(sep) || sep
}

async function listHarnessWorkspaceSuggestions(
  registeredPaths: Set<string>
): Promise<HarnessWorkspaceSuggestion[]> {
  const perHarness = await Promise.all(
    allHarnesses().map(
      h => h.listWorkspaceSuggestions?.(registeredPaths).catch(() => []) ?? Promise.resolve([])
    )
  )
  return perHarness.flat()
}

// Only inspect immediate children of the workspace root, never the whole disk.
export async function listWorkspaceFolders(
  root = createdWorkspacesRoot()
): Promise<{ path: string }[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const suggestions = await Promise.all(
    entries
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
      .map(async entry => {
        const path = resolve(root, entry.name)
        const moi = await stat(join(path, '.moi')).catch(() => undefined)
        return moi?.isDirectory() ? { path } : undefined
      })
  )
  return suggestions.filter(suggestion => suggestion !== undefined)
}

export function mergeWorkspaceSuggestions(
  suggestions: { path: string; harness?: HarnessType }[],
  registeredPaths: Set<string> = new Set()
): WorkspaceSuggestion[] {
  const normalizedRegisteredPaths = new Set([...registeredPaths].map(path => resolve(path)))
  const byPath = new Map<string, Set<HarnessType>>()

  for (const suggestion of suggestions) {
    const path = resolve(suggestion.path)
    if (normalizedRegisteredPaths.has(path)) continue
    const types = byPath.get(path) ?? new Set<HarnessType>()
    if (suggestion.harness) types.add(suggestion.harness)
    byPath.set(path, types)
  }

  return [...byPath].map(([path, types]) => ({
    path,
    harnesses: orderHarnesses(types)
  }))
}

// Combine agent history with Moi folders that may not have any chats yet.
export async function listWorkspaceSuggestions(): Promise<WorkspaceSuggestion[]> {
  const registeredPaths = new Set((await readRegistry()).map(e => e.path))
  const [harnessWorkspaces, workspaceFolders] = await Promise.all([
    listHarnessWorkspaceSuggestions(registeredPaths),
    listWorkspaceFolders()
  ])
  const suggestions = mergeWorkspaceSuggestions(
    [...harnessWorkspaces, ...workspaceFolders],
    registeredPaths
  )
  const importable = await Promise.all(suggestions.map(suggestion => isImportable(suggestion.path)))
  return suggestions.filter((_, index) => importable[index]).map(withDisplayPath)
}

// Agent history outlives its folder, so a permanently deleted workspace would
// otherwise be offered again. A reference to someone else's workspace is not
// offered either: it is opened through its share, never imported.
async function isImportable(path: string): Promise<boolean> {
  const folder = await stat(path).catch(() => undefined)
  if (!folder?.isDirectory()) return false
  const config = await loadWorkspaceFileConfig(path).catch(() => undefined)
  return !config?.remote
}

export async function listTrashedWorkspaces(now = new Date()): Promise<WorkspaceEntry[]> {
  return (await readRegistry())
    .filter(e => e.trashedAt && !e.deleting && !trashExpired(e, now))
    .map(({ deleting: _deleting, ...entry }) => withDisplayPath(entry))
}

function trashExpired(entry: StoredEntry, now: Date): boolean {
  return !!entry.trashedAt && now.getTime() - Date.parse(entry.trashedAt) >= TRASH_RETENTION_MS
}

type TrashUpdateResult =
  | { status: 'updated'; entry: WorkspaceEntry }
  | { status: 'missing' | 'expired' }

// Restore and permanent deletion both decide under the registry lock, so a
// workspace is either restored or deleted, never both.
export async function setWorkspaceTrashed(
  id: string,
  trashed: boolean,
  clearAccess: (id: string) => Promise<unknown>,
  now = new Date()
): Promise<TrashUpdateResult> {
  return locked(async () => {
    const entries = await readRegistry()
    const entry = entries.find(e => e.id === id)
    if (!entry || Boolean(entry.trashedAt) === trashed) return { status: 'missing' }
    if (entry.deleting || trashExpired(entry, now)) return { status: 'expired' }
    if (trashed) {
      await clearAccess(id)
      entry.trashedAt = now.toISOString()
    } else delete entry.trashedAt
    await writeRegistry(entries)
    return { status: 'updated', entry: withDisplayPath(entry) }
  })
}

// Claim under the same lock as restore. Include unfinished deletions from earlier sweeps.
export function claimExpiredWorkspaces(now: Date) {
  return locked(async () => {
    const entries = await readRegistry()
    const expired = entries.filter(
      entry => entry.deleting === true || (!entry.deleting && trashExpired(entry, now))
    )
    if (expired.some(entry => !entry.deleting)) {
      for (const entry of expired) entry.deleting = true
      await writeRegistry(entries)
    }
    return expired
  })
}

export function claimRevokedReferences(references: WorkspaceEntry[]) {
  return locked(async () => {
    const entries = await readRegistry()
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    let changed = false
    for (const reference of references) {
      const entry = byId.get(reference.id)
      if (!entry || entry.trashedAt || entry.path !== reference.path || !reference.remote) continue
      if (!sameRemoteWorkspace((await withRemote(entry)).remote, reference.remote)) continue
      entry.trashedAt = new Date().toISOString()
      entry.deleting = reference.remote
      changed = true
    }
    if (changed) await writeRegistry(entries)
    // The saved address lets us retry even if the reference folder is already gone.
    return entries.flatMap(({ deleting, ...entry }) =>
      deleting && deleting !== true ? [{ ...entry, remote: deleting }] : []
    )
  })
}

// Drop a workspace whose permanent deletion has finished.
export async function finishWorkspaceDeletion(id: string): Promise<void> {
  return locked(async () => {
    const entries = await readRegistry()
    const next = entries.filter(e => !(e.id === id && e.deleting))
    if (next.length !== entries.length) await writeRegistry(next)
  })
}

export async function updateWorkspaceHarness(
  id: string,
  harness: HarnessType
): Promise<WorkspaceEntry> {
  return locked(async () => {
    const entries = await readRegistry()
    const entry = entries.find(entry => entry.id === id && !entry.trashedAt)
    if (!entry) throw new Error('Workspace not found')
    entry.harness = harness
    await writeRegistry(entries)
    return withDisplayPath(entry)
  })
}
