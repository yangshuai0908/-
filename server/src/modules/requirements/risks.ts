import { z } from 'zod'
import * as repo from '../../store/fsRepo.js'
import { RiskIssueSchema, RiskScanSchema, TestPointSchema, type RequirementVersion, type RiskScan } from '../../store/schema.js'
import { AppError, genId, nowIso } from '../../utils.js'
import { assertAnalysisIdle, locateAnalysisEvidence } from './analysis.js'

const SourceSchema = z.object({ reqId: z.string().trim().min(1), quote: z.string().trim().min(1).max(1800) })
export const ScanResultSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  issues: z.array(RiskIssueSchema.omit({ id: true, resolution: true }).extend({
    reqId: z.string().trim().min(1),
    findingKind: RiskIssueSchema.shape.findingKind.default('needs_clarification'),
    evidence: z.array(SourceSchema).max(8).default([]),
    question: z.string().trim().max(500).default(''),
    description: z.string().trim().min(1).max(1000),
  })).max(40),
})

export function buildScanInput(requirement: RequirementVersion, targetReqId?: string) {
  const target = targetReqId ? requirement.chunks.find(c => c.reqId.toUpperCase() === targetReqId.toUpperCase()) : undefined
  if (targetReqId && !target) throw new AppError('选中的条款不存在，请刷新需求后重试', 404)
  const ordered = target ? [target, ...requirement.chunks.filter(c => c !== target)] : requirement.chunks
  let remaining = 24000
  const chunks: { reqId: string; sectionPath: string; text: string }[] = []
  for (const chunk of ordered) {
    if (remaining <= 0) break
    const text = chunk.text.slice(0, remaining)
    chunks.push({ reqId: chunk.reqId, sectionPath: chunk.sectionPath, text })
    remaining -= text.length
  }
  return {
    targetReqId: target?.reqId, chunks,
    includedReqIds: chunks.map(c => c.reqId), totalChunks: requirement.chunks.length,
    contextTruncated: chunks.length !== requirement.chunks.length || chunks.some(c => c.text.length !== requirement.chunks.find(original => original.reqId === c.reqId)!.text.length),
  }
}

export function saveRiskScan(requirementId: string, input: ReturnType<typeof buildScanInput>, result: unknown): RiskScan {
  const requirement = repo.findById<RequirementVersion>('requirements', requirementId)
  if (!requirement) throw new AppError('需求版本已删除，本次扫描未保存', 404)
  const parsed = ScanResultSchema.parse(result)
  const scan = RiskScanSchema.parse({
    ...parsed, id: genId('scan'), createdAt: nowIso(), targetReqId: input.targetReqId,
    includedReqIds: input.includedReqIds, totalChunks: input.totalChunks, contextTruncated: input.contextTruncated,
    issues: parsed.issues.map(issue => {
      if (!input.includedReqIds.includes(issue.reqId)) throw new AppError('扫描返回了上下文以外的条款，本次未保存')
      if (issue.evidence.some(e => !input.includedReqIds.includes(e.reqId))) throw new AppError('扫描引用了未提供的条款，本次未保存')
      return { ...issue, id: genId('risk'), evidence: locateAnalysisEvidence(requirement.chunks, issue.evidence) }
    }),
  })
  repo.update<RequirementVersion>('requirements', requirementId, { riskScans: [...(requirement.riskScans ?? []), scan] })
  return scan
}

const ResolutionSchema = z.object({
  action: z.enum(['question', 'point', 'covered', 'ignored']),
  comment: z.string().trim().max(2000).default(''),
  question: z.string().trim().max(500).optional(),
  point: TestPointSchema.pick({ title: true, objective: true, category: true }).extend({ evidence: z.array(SourceSchema).min(1).max(8) }).optional(),
  evidence: z.array(SourceSchema).min(1).max(8).optional(),
})

export function resolveRisk(requirementId: string, scanId: string, issueId: string, input: unknown): RequirementVersion {
  const parsed = ResolutionSchema.safeParse(input)
  if (!parsed.success) throw new AppError('请填写完整且有效的处理内容')
  assertAnalysisIdle(requirementId)
  const requirement = repo.findById<RequirementVersion>('requirements', requirementId)
  if (!requirement) throw new AppError('需求版本不存在', 404)
  const scan = requirement.riskScans?.find(s => s.id === scanId)
  const issue = scan?.issues.find(i => i.id === issueId)
  if (!scan || !issue) throw new AppError('扫描建议不存在，请重新扫描该条款', 404)
  const { action, comment } = parsed.data
  // 重试不重复添加测试点，也不能覆盖已完成的处理。
  const stalePoint = issue.resolution?.action === 'point' && !requirement.analysis?.sections.some(s => s.points.some(p => p.id === issue.resolution?.pointId))
  if (issue.resolution?.action === action && !stalePoint) return requirement
  if (issue.resolution && issue.resolution.action !== 'question' && !stalePoint) throw new AppError('该建议已处理，请在测试点中继续核对', 409)
  const updated = structuredClone(requirement)
  const target = updated.riskScans!.find(s => s.id === scanId)!.issues.find(i => i.id === issueId)!
  const at = nowIso()
  const question = parsed.data.question ?? issue.question
  let pointId: string | undefined
  if (action === 'question') {
    if (!question) throw new AppError('请填写需要向需求方澄清的问题')
    target.question = question
  } else if (action === 'point') {
    if (!updated.analysis) throw new AppError('请先分析需求、提炼测试点，再补充扫描建议', 409)
    const draft = parsed.data.point
    if (!draft) throw new AppError('请填写测试点名称、验证目标和原文依据')
    const evidence = locateAnalysisEvidence(requirement.chunks, draft.evidence)
    if (evidence.some(e => !e.matched)) throw new AppError('引用未匹配需求原文，请修正依据后再补充测试点')
    const section = updated.analysis.sections.find(s => s.reqId === evidence[0].reqId)
    if (!section) throw new AppError('对应条款尚未分析，请先完成需求分析', 409)
    if (updated.analysis.sections.some(s => s.points.some(p => p.title.trim() === draft.title.trim() && p.objective.trim() === draft.objective.trim()))) {
      throw new AppError('已有相同测试点，请核对后标记为已覆盖', 409)
    }
    if ((issue.findingKind === 'needs_clarification' || issue.resolution?.action === 'question') && !question && !comment) {
      throw new AppError('规则尚未明确，请填写待澄清问题或人工核对说明')
    }
    pointId = genId('point')
    section.points.push(TestPointSchema.parse({
      ...draft, evidence, id: pointId, status: 'pending',
      questions: question ? [question] : [],
      rationale: `来自扫描建议：${issue.description}${comment ? `；人工核对：${comment}` : ''}`,
    }))
    section.notTestableReason = ''
    target.question = question
    updated.analysis.updatedAt = new Date(Math.max(Date.now(), Date.parse(updated.analysis.updatedAt) + 1)).toISOString()
  } else if (action === 'covered') {
    if (!comment) throw new AppError('请说明相关规则已在哪里覆盖')
    if (!parsed.data.evidence?.length) throw new AppError('请引用已明确该规则的条款原文')
    const evidence = locateAnalysisEvidence(requirement.chunks, parsed.data.evidence)
    if (evidence.some(e => !e.matched)) throw new AppError('引用未匹配需求原文，不能标记已覆盖')
    target.evidence = evidence
  } else if (!comment) {
    throw new AppError('忽略建议时请填写原因')
  }
  target.resolution = { action, comment, at, ...(pointId ? { pointId } : {}) }
  repo.update<RequirementVersion>('requirements', requirementId, { riskScans: updated.riskScans, analysis: updated.analysis })
  return updated
}
