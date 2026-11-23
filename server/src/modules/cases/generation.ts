import { config } from '../../config.js'
import { chatJson } from '../../llm/json.js'
import { isInsufficientBalanceError } from '../../llm/client.js'
import { buildScenarioMessages } from '../../prompts/scenario.js'
import { prescreenDuplicates, mergeTwoCases } from '../review/index.js'
import * as repo from '../../store/fsRepo.js'
import type { RequirementVersion, TestCase } from '../../store/schema.js'
import { traceStep, traceWorkflow } from '../../trace.js'
import { AppError, CATEGORIES, type Category } from '../../utils.js'
import { assessCases } from '../../validate/caseSupport.js'
import { overallState, isEvidenceMatchingChunk } from '../../validate/evidence.js'
import { batchFillSchema, expandScenarios, renderScenarioCase, type Scenario } from './scenarios.js'

const generating = new Set<string>()
const BATCH_SIZE = 4
const CONCURRENCY = 2
export const GENERATION_VERSION = 'scenario-matrix-v1'

class SimpleMutex {
  private queue = Promise.resolve()
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const res = this.queue.then(fn)
    this.queue = res.then(() => {}, () => {})
    return res
  }
}

export function generationPlan(requirement: RequirementVersion, categories: Category[]) {
  const all = requirement.analysis?.sections.flatMap(section => section.points) ?? []
  const points = all.filter(point => point.status === 'confirmed' && point.review?.actor === 'human' && point.review.reviewer.trim() && categories.includes(point.category))
  const scenariosByPoint = new Map(points.map(point => [point.id, expandScenarios(point)]))
  // 同一测试点的场景骨架不进不同批次，保证一个点的用例在同一上下文里填充
  const batches: Scenario[][] = []
  for (const category of CATEGORIES.filter(category => categories.includes(category))) {
    let current: Scenario[] = []
    for (const point of points.filter(point => point.category === category)) {
      const group = scenariosByPoint.get(point.id)!
      if (current.length && current.length + group.length > BATCH_SIZE) {
        batches.push(current)
        current = []
      }
      current.push(...group)
      if (current.length >= BATCH_SIZE) {
        batches.push(current)
        current = []
      }
    }
    if (current.length) batches.push(current)
  }
  return { points, scenariosByPoint, scenarios: batches.flat(), batches, pending: all.filter(point => point.status === 'pending' || (point.status === 'confirmed' && (point.review?.actor !== 'human' || !point.review.reviewer.trim()))).length, excluded: all.filter(point => point.status === 'excluded').length }
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
          if (point.questions.length && !point.review?.comment.trim()) throw new AppError(`测试点「${point.title}」尚有未澄清问题，请先补充人工结论`)
          if (!point.evidence.length || point.evidence.some(evidence => !snapshot.chunks.some(chunk => chunk.reqId === evidence.reqId && isEvidenceMatchingChunk(chunk, evidence.quote)))) {
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
      const mutex = new SimpleMutex()
      let completedBatches = 0
      const totalBatches = plan.batches.length
      let stopScheduling = false

      emit({
        type: 'progress',
        done: 0,
        total: totalBatches,
        message: `已确认测试点展开为 ${plan.scenarios.length} 个场景骨架，共 ${totalBatches} 批填充（并发加速）…`,
      })

      const pointById = new Map(plan.points.map(point => [point.id, point]))
      const processBatch = async (index: number, batch: Scenario[]) => {
        try {
          const points = [...new Set(batch.map(scenario => scenario.pointId))].map(id => pointById.get(id)!)
          const ids = new Set(points.flatMap(point => point.evidence.map(e => e.reqId)))
          const chunks = snapshot.chunks.filter(chunk => ids.has(chunk.reqId))

          const result = await traceStep(`第 ${index + 1} 批：场景槽位填充`, { scenarios: batch }, async () => {
            return await chatJson(batchFillSchema(batch, chunks), buildScenarioMessages({
              chunks, points, scenarios: batch, apiList: snapshot.apiList,
            }), { label: `场景填充-${index + 1}`, jsonMode: true })
          })

          const built = await traceStep(`第 ${index + 1} 批：按骨架确定性渲染用例`, result, () => {
            return batch.map(scenario => {
              const fill = result.scenarios.find(item => item.scenarioId === scenario.id)!
              const point = pointById.get(scenario.pointId)!
              const siblings = plan.scenariosByPoint.get(point.id)!
              const testCase = renderScenarioCase(scenario, fill, point, {
                projectId: snapshot.projectId, requirementId: snapshot.id, chunks: snapshot.chunks,
                titleSuffix: siblings.length > 1 ? scenario.label : '',
              })
              testCase.businessConfirmation = point.review?.clarification || (point.questions.length ? point.review?.comment || '' : '')
              testCase.businessConfirmer = testCase.businessConfirmation ? point.review!.reviewer : ''
              testCase.assumptions = [...new Set([...testCase.assumptions, ...point.questions])]
              testCase.source = {
                runId: run.id, analysisId: snapshot.analysis!.id, analysisUpdatedAt: snapshot.analysis!.updatedAt,
                pointId: point.id, title: point.title, objective: point.objective,
                reqIds: point.evidence.map(e => e.reqId),
                scenarioId: scenario.id, scenarioKind: scenario.kind,
              }
              return testCase
            })
          })

          const checked = await traceStep(`第 ${index + 1} 批：语义复核测试条件与预期`, built, () => assessCases(built, snapshot.chunks, true))

          const batchToEmit: TestCase[] = []
          await mutex.runExclusive(async () => {
            await traceStep(`第 ${index + 1} 批：重复检查与智能合并`, { cases: checked }, () => {
              for (const testCase of checked) {
                const existing = overwrite ? created : [...baseline, ...created]
                const dups = prescreenDuplicates([...existing, testCase]).filter(d => d.caseIds.includes(testCase.id))

                // 1. 智能合并：若与已有用例高度同质（score >= 0.85），直接合并条款依据与验证步骤
                const highDup = dups.find(d => d.score >= 0.85)
                if (highDup) {
                  const otherId = highDup.caseIds.find(id => id !== testCase.id)
                  const targetCase = created.find(c => c.id === otherId)
                  if (targetCase) {
                    const merged = mergeTwoCases(targetCase, testCase)
                    Object.assign(targetCase, merged)
                    skipped.push({
                      title: testCase.title,
                      pointId: testCase.source!.pointId,
                      reason: `与「${targetCase.title}」高度重合（相似度 ${Math.round(highDup.score * 100)}%），已直接合并其条款依据与验证点`,
                    })
                    emit({ type: 'case', data: targetCase, runId: run.id })
                    continue
                  }
                }

                // 2. 完全重复（score === 1）：去重
                if (dups.some(d => d.score === 1)) {
                  skipped.push({ title: testCase.title, pointId: testCase.source!.pointId, reason: '与已有用例验证点完全相同，已自动去重' })
                  continue
                }

                // 3. 正常加入候选
                created.push(testCase)
                batchToEmit.push(testCase)
              }
              return { candidates: created.length, skipped }
            })
          })

          // 即时流式吐出本批新生成的用例，让前端实时渲染展示
          for (const data of batchToEmit) {
            emit({ type: 'case', data, runId: run.id })
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          errors.push(`第 ${index + 1} 批：${reason}`)
          if (isInsufficientBalanceError(error)) stopScheduling = true
          emit({ type: 'error', message: errors.at(-1), runId: run.id })
        } finally {
          completedBatches++
          emit({
            type: 'progress',
            done: completedBatches,
            total: totalBatches,
            message: `已完成 ${completedBatches}/${totalBatches} 批，已生成 ${created.length} 条用例`,
          })
        }
      }

      // 按受控并发执行各批次
      const pool = new Set<Promise<void>>()
      let nextBatch = 0
      while (nextBatch < plan.batches.length || pool.size) {
        while (!stopScheduling && nextBatch < plan.batches.length && pool.size < CONCURRENCY) {
          const index = nextBatch++
          const p: Promise<void> = processBatch(index, plan.batches[index]).finally(() => pool.delete(p))
          pool.add(p)
        }
        if (pool.size) await Promise.race(pool)
        else break
      }
      if (stopScheduling && nextBatch < totalBatches) {
        const reason = '模型余额不足，未请求此批次；补充余额后可重新生成'
        for (const batch of plan.batches.slice(nextBatch)) {
          for (const scenario of batch) {
            const point = pointById.get(scenario.pointId)!
            const siblings = plan.scenariosByPoint.get(point.id)!
            skipped.push({
              title: siblings.length > 1 ? `${point.title}（${scenario.label}）` : point.title,
              pointId: point.id,
              reason,
            })
          }
        }
        const message = `模型余额不足，已停止后续 ${totalBatches - nextBatch} 批；成功批次结果已保留`
        errors.push(message)
        emit({ type: 'error', message, runId: run.id })
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
      const assumptions = [...new Set(created.flatMap(c => c.assumptions))]
      emit({ type: 'assumption', items: assumptions })
      const summary = { total: created.length, unverified: created.filter(c => overallState(c.evidence) === 'unknown').length, errors: errors.length }
      emit({ type: 'done', summary, runId: run.id })
      return { ...summary, runId: run.id, errors, skipped, caseIds: run.caseIds, assumptions, cases: created }
    })
  } finally {
    generating.delete(requirement.id)
  }
}
