import { join } from 'node:path'
import type { HarnessType } from '@/lib/types'
import { skillsDirFor } from '../../workspaces/init'

export function collabSkillReferencePath(workspacePath: string, harness?: HarnessType): string {
  return join(skillsDirFor(workspacePath, harness), 'moi-workspace', 'references', 'COLLAB.md')
}
