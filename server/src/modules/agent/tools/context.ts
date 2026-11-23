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
  const projectRequirements = repo.all<RequirementVersion>('requirements').filter((r) => r.projectId === projectId)
  const id = (requirementId ?? '').trim()

  if (!id) {
    if (projectRequirements.length > 0) {
      return projectRequirements[projectRequirements.length - 1]
    }
    throw new AppError('请先选择当前项目下的需求版本')
  }

  // 1. 直接按需求版本 ID 查找
  const requirement = repo.findById<RequirementVersion>('requirements', id)
  if (requirement && requirement.projectId === projectId) {
    return requirement
  }

  // 2. 兼容：大模型可能将条款编号（如 REQ-001）当作 requirementId 传入，查找包含该条款的需求版本
  const matchedByChunk = projectRequirements.find((r) =>
    r.chunks.some((c) => c.reqId.toLowerCase() === id.toLowerCase() || c.sectionPath.toLowerCase().includes(id.toLowerCase())),
  )
  if (matchedByChunk) {
    return matchedByChunk
  }

  // 3. 兼容：按版本 label 查找（如 v1.0）
  const matchedByLabel = projectRequirements.find((r) => r.label.toLowerCase() === id.toLowerCase())
  if (matchedByLabel) {
    return matchedByLabel
  }

  // 4. 容错回退：如果传入的 id 明显是条款编号（如以 REQ- 开头）且项目下有需求版本，直接回退到项目最新的需求版本
  if (/^req-\d+/i.test(id) && projectRequirements.length > 0) {
    return projectRequirements[projectRequirements.length - 1]
  }

  throw new AppError('请先选择当前项目下的需求版本')
}

export function titleKey(title: string): string {
  return title.replace(/[\s\-—_（）()【】\[\]，。、：:；;,.!?！？]/g, '').toLowerCase()
}

