import { basename, join } from 'node:path'
import { PACKAGE_ROOT } from './version'

// Replaced only by the release build. Source checkouts always execute source,
// even when a previous pack left generated files in the working tree.
declare const MOI_BUNDLED: boolean
export const isBundled = typeof MOI_BUNDLED !== 'undefined' && MOI_BUNDLED

export function packagePath(...parts: string[]): string {
  return join(PACKAGE_ROOT, ...parts)
}

export function serverEntry(source: string): string {
  return isBundled
    ? packagePath('runtime', basename(source, '.ts') + '.js')
    : packagePath('server', source)
}

export function appletRuntime(name: string): string {
  return isBundled
    ? packagePath('runtime', 'applets', name + '.js')
    : packagePath('server', 'applets', 'runtime', name + '.ts')
}
