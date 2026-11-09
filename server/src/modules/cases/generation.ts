import { config } from '../../config.js'
import { chatJson } from '../../llm/json.js'
import { buildGenerateMessages } from '../../prompts/generate.js'
import { prescreenDuplicates } from '../../review/dedupe.js'
import * as repo from '../../store/fsRepo.js'
import { LlmGenerateResultSchema, type RequirementVersion, type TestCase, type TestPoint } from '../../store/schema.js'
import { traceStep, traceWorkflow } from '../../trace.js'
import { AppError, CATEGORIES, type Category } from '../../utils.js'
import { assessCases } from '../../validate/caseSupport.js'
import { overallState } from '../../validate/evidence.js'
import { buildCase } from './buildCase.js'

const generating = new Set<string>()
const BATCH_SIZE = 3
export const GENERATION_VERSION = 'confirmed-points-v1'

export function generationPlan(requirement: RequirementVersion, categories: Category[]) {
  const all = requirement.analysis?.sections.flatMap(section => section.points) ?? []
  const points = all.filter(point => point.status === 'confirmed' && categories.includes(point.category))
  const batches = CATEGORIES.filter(category => categories.includes(category)).flatMap(category => {
    const selected = points.filter(point => point.category === category)
    return Array.from({ length: Math.ceil(selected.length / BATCH_SIZE) }, (_, index) => selected.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE))
  })
  return { points, batches, pending: all.filter(point => point.status === 'pending').length, excluded: all.filter(point => point.status === 'excluded').length }
}

export interface GenerationEvent {
  type: 'progress' | 'case' | 'assumption' | 'done' | 'error' | 'trace'
  runId?: string
  done?: number
  total?: number
  message?: string
  data?: TestCase
  items?: string[]
  summary?: { total: number; unverified: number; errors: number }
}

export async function generateConfirmedCases(requirement: RequirementVersion, categories: Category[], overwrite = false, emit: (event: GenerationEvent) => void = () => {}) {
  if (generating.has(requirement.id)) throw new AppError('该需求正在生成，请勿重复提交', 409)
  generating.add(requirement.id)
  // 固定当时的条款与确认结果，生成期间的修改不能悄悄改变本次输入。
  const snapshot = structuredClone(requirement)
  try {
    return await traceWorkflow('generation', snapshot, { requirement: snapshot, categories, overwrite, promptVersion: GENERATION_VERSION }, async run => {
      emit({ type: 'trace', runId: run.id })
      const plan = await traceStep('检查已确认测试点', { categories }, () => {
        if (!categories.length) throw new AppError('至少选择一个场景类型')
        if (!snapshot.analysis) throw new AppError('请先分析需求并人工确认测试点')
        const plan = generationPlan(snapshot, categories)
        if (!plan.points.length) throw new AppError('所选场景没有已确认测试点，请先在需求管理中确认')
        for (const point of plan.points) {
          if (!point.evidence.length || point.evidence.some(evidence => !snapshot.chunks.some(chunk => chunk.reqId === evidence.reqId && chunk.text.includes(evidence.quote)))) {
            throw new AppError(`测试点「${point.title}」的引用不匹配原文，请重新核对后确认`)
          }
        }
        if (plan.batches.length > config.maxLlmCalls) throw new AppError('已确认测试点过多，请减少本次场景类型')
        if (!config.apiKey) throw new AppError('未配置模型密钥')
        return plan
      })
      const baseline = structuredClone(repo.all<TestCase>('cases').filter(c => c.requirementId === snapshot.id))
      const created: TestCase[] = []
      const errors: string[] = []
      const skipped: { title: string; pointId: string; reason: string }[] = []
      for (const [index, points] of plan.batches.entries()) {
        emit({ type: 'progress', done: index, total: plan.batches.length, message: `按已确认测试点生成第 ${index + 1}/${plan.batches.length} 批` })
        try {
          const checked = await traceStep(`第 ${index + 1} 批：生成与校验`, { points }, async () => {
            const ids = new Set(points.flatMap(point => point.evidence.map(e => e.reqId)))
            const chunks = snapshot.chunks.filter(chunk => ids.has(chunk.reqId))
            const candidates = overwrite ? created : [...baseline, ...created]
            const result = await chatJson(LlmGenerateResultSchema, buildGenerateMessages({
              chunks, points, apiList: snapshot.apiList, category: points[0].category,
              existingTitles: candidates.map(c => c.title),
            }), { label: `测试点生成-${index + 1}`, jsonMode: true })
            const built = await traceStep('检查测试点关联和原文引用', result, () => {
              const cases = result.cases.map(raw => {
                const point = points.find(point => point.id === raw.testPointId)
                if (!point) throw new AppError(`用例「${raw.title}」没有有效的已确认测试点关联`)
                if (!raw.title.trim() || !raw.steps?.some(step => step.trim()) || !raw.expected?.some(expected => expected.trim())) {
                  throw new AppError('生成用例缺少标题、步骤或预期结果，未保存本批候选')
                }
                const pointReqIds = new Set(point.evidence.map(e => e.reqId))
                if (!raw.evidence?.length || raw.evidence.some(e => !pointReqIds.has(e.reqId) || !snapshot.chunks.some(chunk => chunk.reqId === e.reqId && chunk.text.includes(e.quote)))) {
                  throw new AppError(`用例「${raw.title}」的引用未逐字匹配原文`)
                }
                const built = buildCase(raw, { projectId: snapshot.projectId, requirementId: snapshot.id, category: point.category, chunks: snapshot.chunks })
                built.category = point.category
                built.assumptions = [...new Set([...built.assumptions, ...point.questions])]
                built.source = {
                  runId: run.id, analysisId: snapshot.analysis!.id, analysisUpdatedAt: snapshot.analysis!.updatedAt,
                  pointId: point.id, title: point.title, objective: point.objective,
                  reqIds: point.evidence.map(e => e.reqId),
                }
                return built
              })
              const missing = points.filter(point => !cases.some(c => c.source?.pointId === point.id))
              if (missing.length) throw new AppError(`本批遗漏测试点：${missing.map(point => point.title).join('、')}`)
              return cases
            })
            return traceStep('语义复核测试条件与预期', built, () => assessCases(built, snapshot.chunks, true))
          })
          await traceStep('重复检查', { cases: checked }, () => {
            for (const testCase of checked) {
              const existing = overwrite ? created : [...baseline, ...created]
              if (prescreenDuplicates([...existing, testCase]).some(d => d.score === 1 && d.caseIds.includes(testCase.id))) {
                skipped.push({ title: testCase.title, pointId: testCase.source!.pointId, reason: '与已有用例的验证点相同，本次未重复保存' })
              } else created.push(testCase)
            }
            return { candidates: created.length, skipped }
          })
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          errors.push(`第 ${index + 1} 批：${reason}`)
          emit({ type: 'error', message: errors.at(-1), runId: run.id })
        }
      }
      if (overwrite && errors.length) throw new AppError('重新生成存在失败批次，原有用例已保留；请查看追溯记录后重试')
      if (errors.length && !created.length) throw new AppError('本次没有成功生成用例，请查看失败步骤后重试')
      await traceStep('检查输入未变化并保存用例', { candidates: created, overwrite }, () => {
        const current = repo.findById<RequirementVersion>('requirements', snapshot.id)
        if (!current || current.analysis?.id !== snapshot.analysis!.id || current.analysis.updatedAt !== snapshot.analysis!.updatedAt) {
          throw new AppError('生成期间需求分析已变化，本次候选未保存；请按最新确认结果重试', 409)
        }
        const list = repo.all<TestCase>('cases')
        const latest = list.filter(c => c.requirementId === snapshot.id)
        if (JSON.stringify(latest) !== JSON.stringify(baseline)) throw new AppError('生成期间用例已被修改，本次候选未保存，请刷新后重试', 409)
        if (overwrite && !created.length) throw new AppError('模型未生成可保存用例，原有用例已保留')
        const before = [...list]
        const next = overwrite ? list.filter(c => c.requirementId !== snapshot.id) : [...list]
        list.splice(0, list.length, ...next, ...created)
        try { repo.save('cases') } catch (error) { list.splice(0, list.length, ...before); throw error }
        run.caseIds = created.map(c => c.id)
        return { saved: created, replaced: overwrite ? baseline : [], skipped }
      })
      if (errors.length) run.status = 'partial'
      for (const data of created) emit({ type: 'case', data, runId: run.id })
      const assumptions = [...new Set(created.flatMap(c => c.assumptions))]
      emit({ type: 'assumption', items: assumptions })
      const summary = { total: created.length, unverified: created.filter(c => overallState(c.evidence) === 'unknown').length, errors: errors.length }
      emit({ type: 'done', summary, runId: run.id })
      return { ...summary, runId: run.id, errors, skipped, caseIds: run.caseIds, assumptions }
    })
  } finally {
    generating.delete(requirement.id)
  }
}
