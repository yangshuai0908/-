import * as repo from '../../store/fsRepo.js'
import type { TestCase } from '../../store/schema.js'
import { AppError } from '../../utils.js'
import { scopedRequirement } from './tools/context.js'
import type { ToolContext } from './types.js'

/** Resolve IDs to current business data rather than accepting page snapshots. */
export function readWorkspaceContext(ctx: ToolContext) {
  if (!ctx.workspace) return null
  if (!ctx.currentRequirementId) {
    if (ctx.workspace.focus) throw new AppError('请先选择需求版本，再指定对象')
    return { page: ctx.workspace.page, requirement: null, focus: null }
  }
  const requirement = scopedRequirement(ctx.projectId, ctx.currentRequirementId)
  const points = requirement.analysis?.sections.flatMap(section => section.points) || []
  const cases = repo.all<TestCase>('cases').filter(item => item.requirementId === requirement.id)
  const confirmed = points.filter(point => point.status === 'confirmed' && point.review?.actor === 'human' && point.review.reviewer.trim())
  let focus: unknown = null
  if (ctx.workspace.focus) {
    const { type, id } = ctx.workspace.focus
    const item = type === 'case' ? cases.find(item => item.id === id)
      : type === 'point' ? points.find(item => item.id === id)
      : requirement.chunks.find(item => item.reqId === id)
    if (!item) throw new AppError('选中对象已失效或不属于当前需求，请重新选择', 409)
    focus = { type, data: item }
  }
  return {
    page: ctx.workspace.page,
    requirement: { id: requirement.id, label: requirement.label, clauseCount: requirement.chunks.length },
    analysis: { id: requirement.analysis?.id || null, totalPoints: points.length, confirmedPoints: confirmed.length,
      pendingPoints: points.filter(point => point.status !== 'excluded' && !confirmed.includes(point)).length },
    caseCount: cases.length, focus,
  }
}
