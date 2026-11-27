import type { AppletKind } from '@/lib/types'
import { realpath, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { analyzeAppletDependencies, collectDependencies, MODULE_FILE_RE } from './dependencies'

type ViewSource = {
  path: string
  source: string
}

export async function readViewSource(
  workspacePath: string,
  viewId: string
): Promise<ViewSource | null> {
  const directory = join(workspacePath, '.moi', 'views')
  for (const extension of ['.tsx', '.ts']) {
    const path = join(directory, `${viewId}${extension}`)
    const file = Bun.file(path)
    if (await file.exists()) return { path, source: await file.text() }
  }
  return null
}

export class AppletMutationError extends Error {
  constructor(
    message: string,
    public status: 404 | 409 | 422
  ) {
    super(message)
    this.name = 'AppletMutationError'
  }
}

function isCleanupSource(moiRoot: string, path: string): boolean {
  if (!path.startsWith(moiRoot + sep) || !MODULE_FILE_RE.test(path)) return false
  // Keep data, installed UI components, packages, and generated/hidden files.
  return !relative(moiRoot, path)
    .split(sep)
    .some(part => part.startsWith('.') || ['data', 'ui', 'node_modules'].includes(part))
}

export async function deleteAppletSourceFiles(
  workspacePath: string,
  kind: AppletKind,
  id: string,
  beforeDelete?: () => Promise<void>
): Promise<void> {
  const workspaceRoot = await realpath(workspacePath)
  const moiRoot = join(workspaceRoot, '.moi')
  const directory = join(moiRoot, `${kind}s`)
  if ((await realpath(directory).catch(() => directory)) !== directory) {
    throw new AppletMutationError(
      'Cannot delete source files through a linked applet directory',
      409
    )
  }
  const sources = ['tsx', 'ts'].map(extension => join(directory, `${id}.${extension}`))
  const roots = new Set([...sources, join(directory, `${id}.server.ts`)])
  const remove = new Set(sources)
  const graph = await analyzeAppletDependencies(workspaceRoot).catch(() => null)

  if (graph?.complete) {
    // A symlink can give one module several identities. Leave helpers behind
    // in that case rather than guessing ownership or doing a more costly scan.
    const canonical = await Promise.all(
      [...graph.modules.keys()].map(async path => (await realpath(path).catch(() => null)) === path)
    )
    if (canonical.every(Boolean)) {
      const candidates = collectDependencies(graph, roots)
      const retained = collectDependencies(graph, [
        ...[...graph.entrypoints].filter(path => !roots.has(path)),
        ...[...candidates].filter(path => !isCleanupSource(moiRoot, path))
      ])
      if (sources.some(path => retained.has(path))) {
        throw new AppletMutationError(
          `Another applet imports this ${kind}. Remove that import before deleting it.`,
          409
        )
      }
      for (const path of candidates) {
        if (!retained.has(path) && isCleanupSource(moiRoot, path)) remove.add(path)
      }
    }
  }

  // Validate shared imports before archiving chats, and archive before removing files.
  await beforeDelete?.()
  await Promise.all([...remove].map(path => rm(path, { force: true })))
}
