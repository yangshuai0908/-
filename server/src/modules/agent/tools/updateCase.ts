import * as repo from '../../../store/fsRepo.js'
import type { TestCase } from '../../../store/schema.js'
import { AppError } from '../../../utils.js'
import { updateCase } from '../../cases/service.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'

export const updateCaseTool = {
  name: 'update_case' as const,
  label: '修改用例',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const existing = repo.findById<TestCase>('cases', args.caseId || '')
    if (!existing) throw new AppError('用例不存在或未提供 caseId', 404)
    if (existing.projectId !== ctx.projectId) throw new AppError('不能修改其他项目的用例', 403)
    if (ctx.currentRequirementId && existing.requirementId !== ctx.currentRequirementId)
      throw new AppError('用例不属于当前需求版本，请先切换到目标需求', 409)
    const input = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== undefined))
    const item = await updateCase(existing.id, input, 'agent')
    return { title: `已保存用例「${item!.title}」`, data: { case: item, caseId: existing.id }, changes: ['cases'],
      artifact: { view: 'cases', requirementId: existing.requirementId, caseId: existing.id } }
  },
}
