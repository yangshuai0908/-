import type { LlmGenerateResult, TestCase, Chunk } from '../../store/schema.js'
import { blankAssessment } from '../../store/schema.js'
import { genId, nowIso, type Category } from '../../utils.js'
import { verifyEvidenceList } from '../../validate/evidence.js'

export function buildCase(
  raw: LlmGenerateResult['cases'][number],
  ctx: { projectId: string; requirementId: string; category: Category; chunks: Chunk[] },
): TestCase {
  const evidence = verifyEvidenceList(ctx.chunks, raw.evidence ?? [])
  const claim = `${raw.title} ${raw.precondition ?? ''} ${(raw.steps ?? []).join(' ')} ${(raw.expected ?? []).join(' ')}`
  const category = /(普通用户|管理员|未登录用户|访客|越权|他人订单|其他用户订单)/.test(claim)
    && /(权限|访问|查看|查询|修改|取消|操作|登录)/.test(claim)
    ? 'permission' : (raw.category ?? ctx.category)
  return {
    id: genId('case'),
    projectId: ctx.projectId,
    requirementId: ctx.requirementId,
    title: raw.title.trim() || '未命名用例',
    category,
    priority: raw.priority ?? 'P1',
    module: raw.module?.trim() ?? '',
    precondition: raw.precondition?.trim() ?? '',
    steps: (raw.steps ?? []).map((s) => s.trim()).filter(Boolean),
    expected: (raw.expected ?? []).map((s) => s.trim()).filter(Boolean),
    evidence,
    assumptions: raw.assumptions ?? [],
    businessConfirmation: '',
    businessConfirmer: '',
    assessment: blankAssessment(),
    origin: 'generated',
    updatedAt: nowIso(),
  }
}

