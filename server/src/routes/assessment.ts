import { Router } from 'express'
import { z } from 'zod'
import { summarizeAssessments, assessmentOf } from '../review/assessment.js'
import * as repo from '../store/fsRepo.js'
import {
  GapStatusSchema,
  RevisionCostSchema,
  VerdictSchema,
  blankAssessment,
  type GapReview,
  type RequirementVersion,
  type TestCase,
} from '../store/schema.js'
import { AppError, genId, nowIso } from '../utils.js'
import { recordChange } from '../trace.js'

export const assessmentRouter = Router()

const AssessmentPatchSchema = z
  .object({
    verdict: VerdictSchema.optional(),
    reviewer: z.string().optional(),
    comment: z.string().optional(),
    revisionCost: RevisionCostSchema.optional(),
  })
  .strict()

const GapPatchSchema = z.object({
  reqId: z.string().min(1),
  status: GapStatusSchema,
  reviewer: z.string().default(''),
  comment: z.string().default(''),
})

function casesOf(rid: string): TestCase[] {
  return repo.all<TestCase>('cases').filter((c) => c.requirementId === rid)
}

function requirementOf(rid: string): RequirementVersion {
  const r = repo.findById<RequirementVersion>('requirements', rid)
  if (!r) throw new AppError('需求版本不存在', 404)
  return r
}

/** 人工评审汇总：不依赖模型，也不依赖是否跑过系统评审 */
assessmentRouter.get('/requirements/:rid/assessment-summary', (req, res) => {
  const rid = String(req.params.rid)
  const requirement = requirementOf(rid)
  const gapReviews = repo.all<GapReview>('gapReviews').filter((g) => g.requirementId === rid)
  res.json(summarizeAssessments(casesOf(rid), { chunks: requirement.chunks, gapReviews }))
})

/** 保存一条用例的人工评审。verdict 决定 reviewedAt，避免手工传时间造假 */
assessmentRouter.patch('/cases/:cid/assessment', (req, res) => {
  const parsed = AssessmentPatchSchema.safeParse(req.body ?? {})
  if (!parsed.success) throw new AppError(`评审参数不合法：${parsed.error.issues[0]?.message ?? ''}`)

  const existing = repo.findById<TestCase>('cases', String(req.params.cid))
  if (!existing) throw new AppError('用例不存在', 404)

  const next = { ...assessmentOf(existing), ...parsed.data }
  next.reviewer = next.reviewer.trim().slice(0, 40)
  next.comment = next.comment.trim().slice(0, 1000)
  // 结论改回「待评审」时清空评审痕迹；否则每次保存刷新时间
  next.reviewedAt = next.verdict === 'unreviewed' ? null : nowIso()
  if (next.verdict === 'effective' || next.verdict === 'invalid') next.revisionCost = 'none'

  const updated = repo.update<TestCase>('cases', existing.id, {
    assessment: next,
    updatedAt: nowIso(),
  })
  recordChange('assessment', requirementOf(existing.requirementId), existing, updated, [existing.id])
  res.json(updated)
})

/** 批量清除人工评审（重新生成用例后想重评时用） */
assessmentRouter.post('/requirements/:rid/assessment-reset', (req, res) => {
  const rid = String(req.params.rid)
  requirementOf(rid)
  const list = casesOf(rid)
  for (const c of list) c.assessment = blankAssessment()
  repo.save('cases')
  const clearedGaps = repo.removeWhere<GapReview>('gapReviews', (g) => g.requirementId === rid)
  res.json({ ok: true, reset: list.length, clearedGaps })
})

// ── 条款级遗漏确认 ──

assessmentRouter.get('/requirements/:rid/gap-reviews', (req, res) => {
  const rid = String(req.params.rid)
  requirementOf(rid)
  res.json(repo.all<GapReview>('gapReviews').filter((g) => g.requirementId === rid))
})

assessmentRouter.post('/requirements/:rid/gap-reviews', (req, res) => {
  const rid = String(req.params.rid)
  const requirement = requirementOf(rid)
  const parsed = GapPatchSchema.safeParse(req.body ?? {})
  if (!parsed.success) throw new AppError(`参数不合法：${parsed.error.issues[0]?.message ?? ''}`)

  const { reqId, status, reviewer, comment } = parsed.data
  if (!requirement.chunks.some((c) => c.reqId === reqId)) {
    throw new AppError(`条款 ${reqId} 不属于该需求版本`)
  }

  const existing = repo
    .all<GapReview>('gapReviews')
    .find((g) => g.requirementId === rid && g.reqId === reqId)

  const patch = {
    status,
    reviewer: reviewer.trim().slice(0, 40),
    comment: comment.trim().slice(0, 1000),
    updatedAt: nowIso(),
  }

  if (existing) {
    res.json(repo.update<GapReview>('gapReviews', existing.id, patch))
    return
  }
  res.json(
    repo.insert<GapReview>('gapReviews', {
      id: genId('gap'),
      requirementId: rid,
      reqId,
      ...patch,
    }),
  )
})
