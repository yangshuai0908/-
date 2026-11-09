import * as repo from '../../../store/fsRepo.js'
import type { Project, RequirementVersion } from '../../../store/schema.js'
import { AppError } from '../../../utils.js'

export function scopedProject(projectId: string): Project {
  const project = repo.findById<Project>('projects', projectId)
  if (!project) throw new AppError('项目不存在', 404)
  return project
}

export function scopedRequirement(
  projectId: string,
  requirementId?: string | null,
): RequirementVersion {
  const id = requirementId ?? ''
  const requirement = id ? repo.findById<RequirementVersion>('requirements', id) : undefined
  if (!requirement || requirement.projectId !== projectId) {
    throw new AppError('请先选择当前项目下的需求版本')
  }
  return requirement
}

export function titleKey(title: string): string {
  return title.replace(/[\s\-—_（）()【】\[\]，。、：:；;,.!?！？]/g, '').toLowerCase()
}

