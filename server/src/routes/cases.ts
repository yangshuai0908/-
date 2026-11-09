import { traceStep, traceWorkflow, recordChange } from '../trace.js'
import { Router } from 'express'
import * as repo from '../store/fsRepo.js'
import {
  CategorySchema,
  PrioritySchema,
  blankAssessment,
  type Evidence,
  type RequirementVersion,
  type TestCase,
} from '../store/schema.js'
import { AppError, genId, nowIso } from '../utils.js'
import { verifyEvidenceList } from '../validate/evidence.js'
import { assessCases } from '../validate/caseSupport.js'
import { prescreenDuplicates } from '../review/dedupe.js'
import { assessmentOf } from '../review/assessment.js'

export const casesRouter = Router()

function casesOf(requirementId: string): TestCase[] {
  return repo
    .all<TestCase>('cases')
    .filter((c) => c.requirementId === requirementId)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

function requireRequirement(rid: string): RequirementVersion {
  const req = repo.findById<RequirementVersion>('requirements', rid)
  if (!req) throw new AppError('需求版本不存在', 404)
  return req
}

casesRouter.get('/requirements/:rid/cases', (req, res) => {
  const rid = String(req.params.rid)
  requireRequirement(rid)
  res.json(casesOf(rid))
})

casesRouter.get('/requirements/:rid/duplicates', (req, res) => {
  const rid = String(req.params.rid)
  requireRequirement(rid)
  res.json(prescreenDuplicates(casesOf(rid)))
})

casesRouter.post('/requirements/:rid/cases', async (req, res) => {
  const rid = String(req.params.rid)
  const requirement = requireRequirement(rid)
  const body = (req.body ?? {}) as Partial<TestCase>

  const rawEvidence = Array.isArray(body.evidence)
    ? body.evidence.map((e) => ({ reqId: String(e?.reqId ?? ''), quote: String(e?.quote ?? '') }))
    : []

  const evidence: Evidence[] = verifyEvidenceList(requirement.chunks, rawEvidence)

  const testCase: TestCase = {
    id: genId('case'),
    projectId: requirement.projectId,
    requirementId: rid,
    title: (body.title ?? '').trim() || '未命名用例',
    category: CategorySchema.catch('normal').parse(body.category),
    priority: PrioritySchema.catch('P1').parse(body.priority),
    module: body.module?.trim() ?? '',
    precondition: body.precondition?.trim() ?? '',
    steps: (body.steps ?? []).filter((s) => s.trim()).map((s) => s.trim()),
    expected: (body.expected ?? []).filter((s) => s.trim()).map((s) => s.trim()),
    evidence,
    assumptions: body.assumptions ?? [],
    businessConfirmation: '',
    businessConfirmer: '',
    assessment: blankAssessment(),
    origin: 'manual',
    updatedAt: nowIso(),
  }

  const [checked] = await assessCases([testCase], requirement.chunks)
  repo.insert('cases', checked)
  recordChange('case_edit', requirement, { action: '手动新增' }, checked, [checked.id])
  res.json(checked)
})

casesRouter.patch('/cases/:cid', async (req, res) => {
  const cid = String(req.params.cid)
  const existing = repo.findById<TestCase>('cases', cid)
  if (!existing) throw new AppError('用例不存在', 404)

  const requirement = requireRequirement(existing.requirementId)
  const result = await traceWorkflow('case_edit', requirement, { case: structuredClone(existing), request: req.body ?? {} }, async run => {
    run.caseIds = [existing.id]
    const body = (req.body ?? {}) as Partial<TestCase>
    const patch: Partial<TestCase> = { updatedAt: nowIso() }

    if (typeof body.title === 'string') patch.title = body.title.trim() || existing.title
    if (body.category !== undefined) patch.category = CategorySchema.catch(existing.category).parse(body.category)
    if (body.priority !== undefined) patch.priority = PrioritySchema.catch(existing.priority).parse(body.priority)
    if (typeof body.module === 'string') patch.module = body.module
    if (typeof body.precondition === 'string') patch.precondition = body.precondition
    if (Array.isArray(body.steps)) patch.steps = body.steps.map((s) => String(s))
    if (Array.isArray(body.expected)) patch.expected = body.expected.map((s) => String(s))
    if (Array.isArray(body.assumptions)) patch.assumptions = body.assumptions.map((s) => String(s))
    if (typeof body.businessConfirmation === 'string') patch.businessConfirmation = body.businessConfirmation.trim()
    if (typeof body.businessConfirmer === 'string') patch.businessConfirmer = body.businessConfirmer.trim()

    if (Array.isArray(body.evidence)) patch.evidence = body.evidence.map((e) => ({ ...e, reqId: String(e?.reqId ?? ''), quote: String(e?.quote ?? '') }))

    const contentChanged = ['title', 'precondition', 'steps', 'expected', 'evidence'].some((key) => {
      if (!(key in patch)) return false
      if (key === 'evidence') {
        const previous = existing.evidence.map(({ reqId, quote }) => ({ reqId, quote }))
        return JSON.stringify(patch.evidence) !== JSON.stringify(previous)
      }
      return JSON.stringify(patch[key as keyof TestCase]) !== JSON.stringify(existing[key as keyof TestCase])
    })
    if (contentChanged) {
      const [checked] = await assessCases([{ ...existing, ...patch, origin: 'manual' }], requirement.chunks)
      patch.evidence = checked.evidence
      patch.assumptions = checked.assumptions
      patch.assessment = blankAssessment()
    }

    const updated = await traceStep('保存用例修改', { patch }, () => repo.update<TestCase>('cases', cid, patch))
    return updated
  })
  res.json(result)
})

casesRouter.delete('/cases/:cid', (req, res) => {
  const ok = repo.remove<TestCase>('cases', String(req.params.cid))
  if (!ok) throw new AppError('用例不存在', 404)
  res.json({ ok: true })
})

/** 重新校验一条用例的全部证据（用户手改后或需求版本更新后） */
casesRouter.post('/cases/:cid/recheck', async (req, res) => {
  const cid = String(req.params.cid)
  const existing = repo.findById<TestCase>('cases', cid)
  if (!existing) throw new AppError('用例不存在', 404)
  const requirement = requireRequirement(existing.requirementId)

  const result = await traceWorkflow('recheck', requirement, { case: structuredClone(existing), request: req.body ?? {} }, async run => {
    run.caseIds = [existing.id]
    const sanitizeGenerated = existing.origin === 'generated'
      && assessmentOf(existing).verdict === 'unreviewed'
      && !existing.businessConfirmation
    const [checked] = await assessCases([
      sanitizeGenerated ? { ...existing, assumptions: [] } : existing,
    ], requirement.chunks, sanitizeGenerated)
    const updated = repo.update<TestCase>('cases', cid, {
      evidence: checked.evidence, assumptions: checked.assumptions,
      expected: checked.expected, updatedAt: nowIso(),
    })
    return updated
  })
  res.json(result)
})
