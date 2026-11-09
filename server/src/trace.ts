import { AsyncLocalStorage } from 'node:async_hooks'
import { config } from './config.js'
import * as repo from './store/fsRepo.js'
import type { RequirementVersion } from './store/schema.js'
import { genId, nowIso } from './utils.js'

export interface TraceStep {
  id: string
  name: string
  status: 'running' | 'succeeded' | 'failed'
  startedAt: string
  finishedAt?: string
  input: unknown
  output?: unknown
  error?: string
}

export interface WorkflowTrace {
  id: string
  requirementId: string
  projectId: string
  kind: 'analysis' | 'generation' | 'point_edit' | 'case_edit' | 'assessment' | 'recheck'
  status: 'running' | 'succeeded' | 'partial' | 'failed' | 'interrupted'
  startedAt: string
  finishedAt?: string
  model: string
  input: unknown
  output?: unknown
  error?: string
  caseIds: string[]
  steps: TraceStep[]
}

const context = new AsyncLocalStorage<WorkflowTrace>()
const active = new Set<string>()

// 保存实际输入输出，不记录密钥或模型内部思考过程。
function snapshot(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null, (_key, value) =>
    typeof value === 'string' && config.apiKey ? value.split(config.apiKey).join('[REDACTED]') : value))
}

function persist(run: WorkflowTrace) {
  repo.update<WorkflowTrace>('traces', run.id, snapshot(run))
}

export function currentTrace() {
  return context.getStore()
}

export async function traceStep<T>(name: string, input: unknown, work: () => T | Promise<T>): Promise<T> {
  const run = currentTrace()
  if (!run) return work()
  const step: TraceStep = { id: genId('step'), name, status: 'running', startedAt: nowIso(), input: snapshot(input) }
  run.steps.push(step)
  persist(run)
  try {
    const result = await work()
    step.status = 'succeeded'
    step.output = snapshot(result)
    return result
  } catch (error) {
    step.status = 'failed'
    step.error = snapshot(error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    step.finishedAt = nowIso()
    persist(run)
  }
}

export async function traceWorkflow<T>(kind: WorkflowTrace['kind'], requirement: RequirementVersion, input: unknown, work: (run: WorkflowTrace) => Promise<T>): Promise<T> {
  const run: WorkflowTrace = {
    id: genId('run'), requirementId: requirement.id, projectId: requirement.projectId,
    kind, status: 'running', startedAt: nowIso(), model: config.model,
    input: snapshot(input), caseIds: [], steps: [],
  }
  repo.insert('traces', snapshot(run))
  active.add(run.id)
  return context.run(run, async () => {
    try {
      const result = await work(run)
      run.output = snapshot(result)
      if (run.status === 'running') run.status = 'succeeded'
      return result
    } catch (error) {
      run.status = 'failed'
      run.error = snapshot(error instanceof Error ? error.message : String(error))
      if (error instanceof Error) error.message = `${run.error}（追溯记录：${run.id}）`
      throw error
    } finally {
      run.finishedAt = nowIso()
      active.delete(run.id)
      persist(run)
    }
  })
}

export function recordChange(kind: WorkflowTrace['kind'], requirement: RequirementVersion, before: unknown, after: unknown, caseIds: string[] = []) {
  const timestamp = nowIso()
  const run: WorkflowTrace = {
    id: genId('run'), requirementId: requirement.id, projectId: requirement.projectId,
    kind, status: 'succeeded', startedAt: timestamp, finishedAt: timestamp,
    model: '', input: snapshot(before), output: snapshot(after), caseIds, steps: [],
  }
  repo.insert('traces', run)
  return run.id
}

export function tracesOf(requirementId: string) {
  const runs = repo.all<WorkflowTrace>('traces').filter(run => run.requirementId === requirementId)
  for (const run of runs) {
    if (run.status === 'running' && !active.has(run.id)) {
      run.status = 'interrupted'
      run.error = '服务已重启，任务未记录完成；请核对结果后重试。'
      for (const step of run.steps) if (step.status === 'running') {
        step.status = 'failed'
        step.error = '服务中断，未获得完成结果。'
      }
      persist(run)
    }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
