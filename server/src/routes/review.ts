import { Router } from 'express'
import { chatJson } from '../llm/json.js'
import { buildReviewMessages } from '../prompts/review.js'
import { buildCoverage, categoryStats, scoreCompleteness } from '../review/coverage.js'
import { prescreenDuplicates } from '../review/dedupe.js'
import * as repo from '../store/fsRepo.js'
import {
  LlmReviewResultSchema,
  type RequirementVersion,
  type ReviewReport,
  type TestCase,
} from '../store/schema.js'
import { AppError, genId, nowIso } from '../utils.js'

export const reviewRouter = Router()

/** 预期结果里的模糊表述，出现即视为不可判定 */
const VAGUE_PATTERNS = [/显示正常/, /符合预期/, /无异常/, /体验良好/, /正常显示/, /一切正常/]

/** 步骤可执行性：模型未给出评分时使用规则兜底 */
function scoreExecutability(cases: TestCase[]): number {
  if (!cases.length) return 1
  const ok = cases.filter(
    (c) => c.steps.length >= 2 && c.steps.every((s) => s.trim().length >= 4),
  ).length
  return Math.max(1, Math.round((ok / cases.length) * 5 * 10) / 10)
}

/** 预期可判定性：规则打分 */
function scoreVerifiability(cases: TestCase[]): number {
  if (!cases.length) return 1
  const ok = cases.filter(
    (c) => c.expected.length > 0 && !c.expected.some((e) => VAGUE_PATTERNS.some((re) => re.test(e))),
  ).length
  return Math.max(1, Math.round((ok / cases.length) * 5 * 10) / 10)
}

function clamp(v: number): number {
  return Math.max(1, Math.min(5, Math.round(v * 10) / 10))
}

export async function createReviewReport(requirementId: string): Promise<ReviewReport> {
  const requirement = repo.findById<RequirementVersion>('requirements', requirementId)
  if (!requirement) throw new AppError('需求版本不存在', 404)

  const cases = repo.all<TestCase>('cases').filter((c) => c.requirementId === requirementId)
  if (!cases.length) throw new AppError('该需求下还没有用例，先跑一次生成再评审')

  const coverage = buildCoverage(requirement.chunks, cases)
  const dupCandidates = prescreenDuplicates(cases)

  const result = await chatJson(
    LlmReviewResultSchema,
    buildReviewMessages({ coverage: coverage.rows, cases, dupCandidates: dupCandidates.slice(0, 15) }),
    { label: '用例评审' },
  )

  const byId = new Map(cases.map((c) => [c.id, c]))
  const sectionOf = new Map(coverage.rows.map((r) => [r.reqId, r.sectionPath]))
  const nonTestableIds = new Set(coverage.rows.filter((r) => !r.testable).map((r) => r.reqId))

  const report: ReviewReport = {
    id: genId('rev'),
    requirementId,
    coverage: coverage.rows,
    coverageRate: Math.round(coverage.rate * 1000) / 1000,
    duplicates: result.duplicates
      .filter((d) => d.caseIds.every((id) => byId.has(id)))
      .map((d) => ({
        caseIds: d.caseIds,
        title: byId.get(d.caseIds[0])?.title ?? '',
        reason: d.reason,
      })),
    gaps: result.gaps
      .filter((g) => sectionOf.has(g.reqId) && !nonTestableIds.has(g.reqId))
      .map((g) => ({
        reqId: g.reqId,
        sectionPath: sectionOf.get(g.reqId) ?? '',
        reason: g.reason,
        severity: g.severity,
      })),
    scores: {
      coverage: clamp(coverage.rate * 5),
      completeness: clamp(result.scores?.completeness ?? scoreCompleteness(cases)),
      executability: clamp(result.scores?.executability ?? scoreExecutability(cases)),
      verifiability: clamp(result.scores?.verifiability ?? scoreVerifiability(cases)),
      total: 0,
    },
    advice: result.advice,
    categoryStats: categoryStats(cases),
    createdAt: nowIso(),
  }

  const s = report.scores
  s.total = Math.round(((s.coverage + s.completeness + s.executability + s.verifiability) / 4) * 10) / 10

  // 同一需求只保留最新一份评审
  repo.removeWhere<ReviewReport>('reviews', (r) => r.requirementId === requirementId)
  repo.insert('reviews', report)
  return report
}

reviewRouter.post('/review', async (req, res) => {
  res.json(await createReviewReport(String(req.body?.requirementId ?? '')))
})

reviewRouter.get('/review/:rid', (req, res) => {
  const report = repo
    .all<ReviewReport>('reviews')
    .find((r) => r.requirementId === String(req.params.rid))
  res.json(report ?? null)
})
