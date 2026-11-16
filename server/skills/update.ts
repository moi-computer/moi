import { basename } from 'node:path'

import type { WorkspaceSkillsStatus, WorkspaceSkillStatus, HarnessType } from '@/lib/types'

import type { AppletDeclarationFile } from '../applets/declarations'
import { syncAppletDeclarations } from '../applets/declarations'
import { isBehind, skillStatuses, skillStatusesForLocations } from './version'
import { installBundledSkill } from './template'
import { resolveSkillLocations } from './locations'
import {
  installWorkspaceSkillFiles,
  usesSharedWorkspaceSkill,
  workspaceSkillLockPath
} from './workspace'
import { withSkillLock } from './lock'

export type WorkspaceSkillUpdateResult = {
  before: WorkspaceSkillStatus[]
  status: WorkspaceSkillsStatus
  changedSkills: string[]
  changedSkillPaths: string[]
  updatedAppletTypes: AppletDeclarationFile[]
}

export function summarizeSkillStatuses(skills: WorkspaceSkillStatus[]): WorkspaceSkillsStatus {
  return {
    skills,
    updateAvailable: skills.some(skill => isBehind(skill.installed, skill.bundled))
  }
}

export async function getWorkspaceSkillsStatus(
  workspaceRoot: string,
  harness?: HarnessType
): Promise<WorkspaceSkillsStatus> {
  return summarizeSkillStatuses(await skillStatuses(workspaceRoot, harness))
}

export async function updateWorkspaceSkills(
  workspaceRoot: string,
  harness: HarnessType = 'claude-code'
): Promise<WorkspaceSkillUpdateResult> {
  return withSkillLock(workspaceSkillLockPath(workspaceRoot, harness), () =>
    updateWorkspaceSkillFiles(workspaceRoot, harness)
  )
}

async function updateWorkspaceSkillFiles(
  workspaceRoot: string,
  harness: HarnessType
): Promise<WorkspaceSkillUpdateResult> {
  const locations = await resolveSkillLocations(workspaceRoot, harness)
  const before = await skillStatusesForLocations(locations)
  let changedSkillPaths: string[]
  if (usesSharedWorkspaceSkill(harness)) {
    changedSkillPaths = await installWorkspaceSkillFiles(workspaceRoot, harness)
  } else {
    for (const location of locations) {
      if (location.brokenLink) {
        throw new Error(
          `Cannot update skill at ${location.path}: broken symlink ${location.brokenLink}`
        )
      }
    }
    const changedTargets = new Map<string, boolean>()
    for (const location of locations) {
      if (changedTargets.has(location.targetPath)) continue
      try {
        changedTargets.set(
          location.targetPath,
          await installBundledSkill(location.name, location.targetPath)
        )
      } catch (cause) {
        throw new Error(`Cannot update skill at ${location.path}: ${String(cause)}`, { cause })
      }
    }
    changedSkillPaths = locations
      .filter(location => changedTargets.get(location.targetPath))
      .map(location => location.path)
  }
  const changedSkills = [...new Set(changedSkillPaths.map(path => basename(path)))]
  // Applet declarations ship with the CLI, so refresh installed copies along
  // with skills.
  const updatedAppletTypes = await syncAppletDeclarations(workspaceRoot)
  const skills = await skillStatuses(workspaceRoot, harness)

  return {
    before,
    status: summarizeSkillStatuses(skills),
    changedSkills,
    changedSkillPaths,
    updatedAppletTypes
  }
}
