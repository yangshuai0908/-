import { Router } from 'express'
import { diffChunks, findImpactedCases, assertComparable } from '../docs/diff.js'
import { chatJson } from '../llm/json.js'
import { buildCompareMessages } from '../prompts/compare.js'
import * as repo from '../store/fsRepo.js'
import {
  LlmCompareResultSchema,
  blankAssessment,
  type ChangeItem,
  type CompareReport,
  type LlmCompareResult,
  type RequirementVersion,
  type TestCase,
} from '../store/schema.js'
import { AppError, genId, nowIso } from '../utils.js'
import { buildCase } from './generate.js'
import { assessCases } from '../validate/caseSupport.js'

export const compareRouter = Router()

/** 单个批次最多塞几条变更。条数太多模型一次要说清所有新增/调整建议，输出必然被 max_tokens 截断 */
const MAX_CHANGES_PER_BATCH = 4

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * 分批跑对比建议再合并。
 * 每批只带「引用了本批条款」的用例，既压小输入，也避免模型被不相关的用例干扰。
 */
async function compareInBatches(
  changes: ChangeItem[],
  impacted: TestCase[],
): Promise<LlmCompareResult> {
  const relevant = changes.filter((c) => c.type !== 'unchanged')
  const batches = chunkArray(relevant, MAX_CHANGES_PER_BATCH)
  const merged: LlmCompareResult = {
    newCases: [],
    adjustedCases: [],
    deprecatedCases: [],
    notes: [],
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    const reqIds = new Set(
      batch.flatMap((c) => [c.fromReqId, c.toReqId]).filter((id): id is string => Boolean(id)),
    )
    const related = impacted.filter((c) => c.evidence.some((e) => reqIds.has(e.reqId)))
    const removedCaseIds = related
      .filter((c) =>
        batch.some((ch) => ch.type === 'removed' && c.evidence.some((e) => e.reqId === ch.fromReqId)),
      )
      .map((c) => c.id)

    const r = await chatJson(
      LlmCompareResultSchema,
      buildCompareMessages({ changes: batch, impactedCases: related, removedCaseIds }),
      { label: `需求变更对比 ${i + 1}/${batches.length}` },
    )
    merged.newCases.push(...r.newCases)
    merged.adjustedCases.push(...r.adjustedCases)
    merged.deprecatedCases.push(...r.deprecatedCases)
    merged.notes.push(...r.notes)
  }

  // 同一条用例可能引用多条变更条款，跨批次会重复出现，按 caseId 去重
  const seenAdjust = new Set<string>()
  merged.adjustedCases = merged.adjustedCases.filter((a) => {
    if (seenAdjust.has(a.caseId)) return false
    seenAdjust.add(a.caseId)
    return true
  })
  const seenDeprecated = new Set<string>()
  merged.deprecatedCases = merged.deprecatedCases.filter((d) => {
    if (seenDeprecated.has(d.caseId)) return false
    seenDeprecated.add(d.caseId)
    return true
  })
  // 新增用例按标题去重，不同批次可能给出同一个条款的近义用例
  const seenNew = new Set<string>()
  merged.newCases = merged.newCases.filter((n) => {
    const key = n.title.trim()
    if (seenNew.has(key)) return false
    seenNew.add(key)
    return true
  })

  return merged
}

export async function createCompareReport(projectId: string, fromReqId: string, toReqId: string): Promise<CompareReport> {
  const from = repo.findById<RequirementVersion>('requirements', fromReqId)
  const to = repo.findById<RequirementVersion>('requirements', toReqId)
  if (!from || !to) throw new AppError('需求版本不存在', 404)
  if (from.projectId !== projectId || to.projectId !== projectId) throw new AppError('需求版本不属于当前项目')
  try {
    assertComparable(from, to)
  } catch (e) {
    throw new AppError((e as Error).message)
  }

  const diff = diffChunks(from.chunks, to.chunks)
  const allCases = repo.all<TestCase>('cases').filter((c) => c.requirementId === fromReqId)
  const { impacted } = findImpactedCases(allCases, diff)

  const relevantChanges = diff.changes.filter((c) => c.type !== 'unchanged')
  if (!relevantChanges.length) {
    const report: CompareReport = {
      id: genId('cmp'),
      projectId,
      fromReqId,
      toReqId,
      changes: diff.changes,
      impactedCaseIds: [],
      results: { newCases: [], adjustedCases: [], deprecatedCases: [], notes: ['两个版本的条款没有实质差异'] },
      createdAt: nowIso(),
    }
    repo.insert('compares', report)
    return report
  }

  const result = await compareInBatches(diff.changes, impacted)

  const report: CompareReport = {
    id: genId('cmp'),
    projectId,
    fromReqId,
    toReqId,
    changes: diff.changes,
    impactedCaseIds: impacted.map((c) => c.id),
    results: {
      newCases: result.newCases,
      adjustedCases: result.adjustedCases.map((a) => ({
        caseId: a.caseId,
        caseTitle: a.caseTitle ?? allCases.find((c) => c.id === a.caseId)?.title ?? a.caseId,
        reason: a.reason,
        change: a.change,
        patch: a.patch,
      })),
      deprecatedCases: result.deprecatedCases.map((d) => ({
        caseId: d.caseId,
        caseTitle: d.caseTitle ?? allCases.find((c) => c.id === d.caseId)?.title ?? d.caseId,
        reason: d.reason,
      })),
      notes: result.notes,
    },
    createdAt: nowIso(),
  }

  repo.insert('compares', report)
  return report
}

compareRouter.post('/compare', async (req, res) => {
  const report = await createCompareReport(
    String(req.body?.projectId ?? ''),
    String(req.body?.fromReqId ?? ''),
    String(req.body?.toReqId ?? ''),
  )
  res.json(report)
})

compareRouter.get('/projects/:pid/compares', (req, res) => {
  const pid = String(req.params.pid)
  const list = repo
    .all<CompareReport>('compares')
    .filter((c) => c.projectId === pid)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  res.json(list)
})

compareRouter.get('/compare/:cid', (req, res) => {
  const report = repo.findById<CompareReport>('compares', String(req.params.cid))
  if (!report) throw new AppError('对比报告不存在', 404)
  res.json(report)
})

/** 把对比建议里的「新增用例」落到用例表 */
compareRouter.post('/compare/:cid/apply-new/:index', async (req, res) => {
  const report = repo.findById<CompareReport>('compares', String(req.params.cid))
  if (!report) throw new AppError('对比报告不存在', 404)

  const index = Number(req.params.index)
  const raw = report.results.newCases[index]
  if (!raw) throw new AppError('该条建议不存在', 404)

  const requirement = repo.findById<RequirementVersion>('requirements', report.toReqId)
  if (!requirement) throw new AppError('目标需求版本不存在', 404)

  const testCase = buildCase(raw, {
    projectId: report.projectId,
    requirementId: report.toReqId,
    category: raw.category ?? 'normal',
    chunks: requirement.chunks,
  })
  const [checked] = await assessCases([testCase], requirement.chunks, true)
  repo.insert('cases', checked)
  res.json(checked)
})

/** 把对比建议里的「调整」应用到已有用例 */
compareRouter.post('/compare/:cid/apply-adjust/:index', async (req, res) => {
  const report = repo.findById<CompareReport>('compares', String(req.params.cid))
  if (!report) throw new AppError('对比报告不存在', 404)

  const index = Number(req.params.index)
  const advice = report.results.adjustedCases[index]
  if (!advice) throw new AppError('该条建议不存在', 404)

  const existing = repo.findById<TestCase>('cases', advice.caseId)
  if (!existing) throw new AppError('对应用例已不存在', 404)

  const patch: Partial<TestCase> = { updatedAt: nowIso() }
  if (advice.patch?.title) patch.title = advice.patch.title
  if (advice.patch?.precondition !== undefined) patch.precondition = advice.patch.precondition
  if (advice.patch?.steps) patch.steps = advice.patch.steps
  if (advice.patch?.expected) patch.expected = advice.patch.expected

  const requirement = repo.findById<RequirementVersion>('requirements', existing.requirementId)
  if (!requirement) throw new AppError('需求版本不存在', 404)
  const [checked] = await assessCases([{ ...existing, ...patch }], requirement.chunks)
  patch.evidence = checked.evidence
  patch.assumptions = checked.assumptions
  patch.assessment = blankAssessment()
  const updated = repo.update<TestCase>('cases', advice.caseId, patch)
  res.json(updated)
})
