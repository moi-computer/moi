import type { HarnessType } from '@/lib/types'

import { getAppConfig } from '../app-config'
import { collabSkillReferencePath } from './skill'

export async function getCollabReferencePath(
  workspacePath: string,
  harness?: HarnessType
): Promise<string | undefined> {
  if (getAppConfig().environment !== 'cloud') return undefined
  const referencePath = collabSkillReferencePath(workspacePath, harness)
  return (await Bun.file(referencePath).exists()) ? referencePath : undefined
}
