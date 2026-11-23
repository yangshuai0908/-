import { z } from 'zod'
import * as repo from '../../store/fsRepo.js'
import { CategorySchema, PrioritySchema, blankAssessment, type Evidence, type RequirementVersion, type TestCase } from '../../store/schema.js'
import { AppError, genId, nowIso } from '../../utils.js'
import { verifyEvidenceList } from '../../validate/evidence.js'
import { assessCases } from '../../validate/caseSupport.js'
import { traceStep, traceWorkflow, recordChange } from '../../trace.js'
const CaseInputSchema = z.object({
  title: z.string().optional(), category: CategorySchema.optional(), priority: PrioritySchema.optional(),
  module: z.string().optional(), precondition: z.string().optional(), steps: z.array(z.string()).optional(),
  expected: z.array(z.string()).optional(), assumptions: z.array(z.string()).optional(),
  evidence: z.array(z.object({ reqId: z.string(), quote: z.string() })).optional(),
  businessConfirmation: z.string().optional(), businessConfirmer: z.string().optional(),
})
function caseInput(input: unknown) {
  const result = CaseInputSchema.safeParse(input)
  if (!result.success) throw new AppError('用例字段格式无效：' + result.error.issues[0]?.message)
  return result.data
}
function findRequirement(id: string) {
  const requirement = repo.findById<RequirementVersion>('requirements', id)
  if (!requirement) throw new AppError('需求版本不存在', 404)
  return requirement
}

export async function createCase(requirement: RequirementVersion, input: unknown, actor: 'human' | 'agent' = 'human') {
  const rid = requirement.id
  const body = caseInput(input)
  if (actor === 'agent' && (!body.title?.trim() || !body.steps?.some(s => s.trim()) || !body.expected?.some(s => s.trim()) || !body.evidence?.length))
    throw new AppError('Agent 新增用例必须提供标题、步骤、可判定预期和原文依据')

  const rawEvidence = Array.isArray(body.evidence)
    ? body.evidence.map((e) => ({ reqId: String(e?.reqId ?? ''), quote: String(e?.quote ?? '') }))
    : []

  const evidence: Evidence[] = verifyEvidenceList(requirement.chunks, rawEvidence)
  if (actor === 'agent' && evidence.some(e => e.quoteMatch !== 'exact')) throw new AppError('Agent 新增用例的依据必须匹配需求原文')

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
    origin: actor === 'agent' ? 'generated' : 'manual',
    updatedAt: nowIso(),
  }

  const [checked] = await assessCases([testCase], requirement.chunks)
  repo.insert('cases', checked)
  recordChange('case_edit', requirement, { action: actor === 'agent' ? 'Agent 新增' : '手动新增', actor }, checked, [checked.id])
  return checked
}

export async function updateCase(cid: string, input: unknown, actor: 'human' | 'agent' = 'human') {
  const existing = repo.findById<TestCase>('cases', cid)
  if (!existing) throw new AppError('用例不存在', 404)

  const requirement = findRequirement(existing.requirementId)
  const previousUpdatedAt = existing.updatedAt
  const result = await traceWorkflow('case_edit', requirement, { case: structuredClone(existing), request: input, actor }, async run => {
    run.caseIds = [existing.id]
    const body = caseInput(input)
    if (actor === 'agent') { delete body.businessConfirmation; delete body.businessConfirmer }
    const patch: Partial<TestCase> = { updatedAt: new Date(Math.max(Date.now(), Date.parse(existing.updatedAt) + 1)).toISOString() }

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

    if (Array.isArray(body.evidence)) patch.evidence = verifyEvidenceList(requirement.chunks, body.evidence)

    const contentChanged = ['title', 'precondition', 'steps', 'expected', 'evidence'].some((key) => {
      if (!(key in patch)) return false
      if (key === 'evidence') {
        const previous = existing.evidence.map(({ reqId, quote }) => ({ reqId, quote }))
        return JSON.stringify(patch.evidence?.map(({ reqId, quote }) => ({ reqId, quote }))) !== JSON.stringify(previous)
      }
      return JSON.stringify(patch[key as keyof TestCase]) !== JSON.stringify(existing[key as keyof TestCase])
    })
    if (contentChanged) {
      const [checked] = await assessCases([{ ...existing, ...patch, origin: 'manual' }], requirement.chunks)
      patch.evidence = checked.evidence
      patch.assumptions = checked.assumptions
      patch.assessment = blankAssessment()
    }

    if (repo.findById<TestCase>('cases', cid)?.updatedAt !== previousUpdatedAt)
      throw new AppError('用例在校验期间已被修改，请刷新后重试', 409)
    const updated = await traceStep('保存用例修改', { patch }, () => repo.update<TestCase>('cases', cid, patch))
    return updated
  })
  return result
}
