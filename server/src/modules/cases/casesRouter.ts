import { createCase, updateCase } from './service.js'
import { traceWorkflow } from '../../trace.js'
import { Router } from 'express'
import * as repo from '../../store/fsRepo.js'
import {
  type RequirementVersion,
  type TestCase,
} from '../../store/schema.js'
import { AppError, nowIso } from '../../utils.js'
import { assessCases } from '../../validate/caseSupport.js'
import { prescreenDuplicates, mergeCaseGroup, mergeAllDuplicates } from '../review/dedupe.js'
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

casesRouter.post('/requirements/:rid/duplicates/merge', async (req, res) => {
  const rid = String(req.params.rid)
  const requirement = requireRequirement(rid)
  const caseIds = Array.isArray(req.body?.caseIds) ? req.body.caseIds.map(String) : []
  const allCases = casesOf(rid)

  const result = await traceWorkflow('case_edit', requirement, { action: 'merge_duplicates', caseIds }, async (run) => {
    let mergedCases: TestCase[] = []
    let removedIds: string[] = []

    if (caseIds.length >= 2) {
      const outcome = mergeCaseGroup(allCases, caseIds)
      if (!outcome) throw new AppError('指定的用例无法合并（未找到至少两条有效用例）', 400)
      mergedCases = [outcome.merged]
      removedIds = outcome.removedIds
    } else {
      const outcome = mergeAllDuplicates(allCases)
      mergedCases = outcome.mergedCases
      removedIds = outcome.removedIds
    }

    if (!removedIds.length) {
      return { ok: true, mergedCount: 0, removedCount: 0, removedIds: [] }
    }

    for (const c of mergedCases) {
      repo.update<TestCase>('cases', c.id, c)
    }
    for (const id of removedIds) {
      repo.remove<TestCase>('cases', id)
    }

    run.caseIds = mergedCases.map((c) => c.id)
    return {
      ok: true,
      mergedCount: mergedCases.length,
      removedCount: removedIds.length,
      mergedCases,
      removedIds,
    }
  })

  res.json(result)
})

casesRouter.post('/requirements/:rid/cases', async (req, res) => {
  res.json(await createCase(requireRequirement(String(req.params.rid)), req.body ?? {}))
})

casesRouter.patch('/cases/:cid', async (req, res) => {
  res.json(await updateCase(String(req.params.cid), req.body ?? {}))
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
