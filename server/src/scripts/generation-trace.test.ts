import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { once } from 'node:events'
import express, { type Request, type Response, type NextFunction } from 'express'
import { config } from '../config.js'
import * as repo from '../store/fsRepo.js'
import { buildCase } from '../modules/cases/buildCase.js'
import { generateConfirmedCases, generationPlan } from '../modules/cases/generation.js'
import type { RequirementVersion, TestCase, TestPoint } from '../store/schema.js'
import { tracesOf, type WorkflowTrace } from '../trace.js'
import { requirementsRouter } from '../modules/requirements/routes.js'
import { casesRouter } from '../routes/cases.js'
import { generateRouter } from '../routes/generate.js'
import { assessmentRouter } from '../routes/assessment.js'
import { exportRouter } from '../routes/export.js'
import { AppError } from '../utils.js'

test('confirmed-point generation and persisted failure tracing', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testpilot-trace-'))
  const previous = { ...config }
  const originalFetch = globalThis.fetch
  Object.assign(config, { dataDir: directory, apiKey: 'test-secret-never-record', model: 'fixture-model', baseUrl: 'http://fixture.invalid' })
  let mode = 'success'
  let calls = 0
  const prompts: string[] = []
  const quote = '查询数量必须 <= 20，超过上限时拒绝查询。'
  const point = (id: string, status: TestPoint['status'], category: TestPoint['category'] = 'normal'): TestPoint => ({
    id, status, category, title: id + '查询规则', objective: '验证超过 20 条时拒绝查询',
    evidence: [{ reqId: 'REQ-001', quote, matched: true }], questions: [],
  })
  const requirement: RequirementVersion = {
    id: 'req-fixture', projectId: 'project-fixture', label: 'v1', rawText: quote, sourceType: 'paste', apiList: [],
    chunks: [{ reqId: 'REQ-001', sectionPath: '查询规则', text: quote, order: 0 }], createdAt: '2026-11-06T00:00:00Z',
    analysis: { id: 'analysis-fixture', createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z', sections: [{ reqId: 'REQ-001', points: [point('confirmed', 'confirmed'), point('pending', 'pending'), point('excluded', 'excluded')], questions: [], notTestableReason: '' }] },
  }
  const old = buildCase({ title: '已有用例应保留', steps: ['已有步骤'], expected: ['已有结果'] }, { projectId: requirement.projectId, requirementId: requirement.id, category: 'normal', chunks: requirement.chunks })
  function reset() {
    repo.resetAll()
    repo.insert('requirements', structuredClone(requirement))
    repo.insert('cases', structuredClone(old))
    calls = 0
    prompts.length = 0
    mode = 'success'
  }
  const current = () => repo.findById<RequirementVersion>('requirements', requirement.id)!
  globalThis.fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    const prompt = body.messages.map((m: { content: string }) => m.content).join('\n')
    prompts.push(prompt)
    if (mode === 'invalid-json') return Response.json({ choices: [{ message: { content: '{invalid test-secret-never-record' } }] })
    if (prompt.includes('你是严格的需求依据审查员')) {
      if (mode === 'validation-failure') return new Response('复核失败 test-secret-never-record', { status: 400 })
      if (mode === 'changed-input') current().analysis!.updatedAt = 'changed-during-generation'
      const payload = JSON.parse(body.messages[1].content.split('：\n').at(-1))
      const items = payload.flatMap((c: any) => c.evidence.map((_: unknown, evidenceIndex: number) => ({
        caseIndex: c.caseIndex, evidenceIndex, condition: 'explicit', expected: 'explicit', target: mode === 'off-target' ? 'unknown' : 'explicit', reason: '固定样本复核结果',
      })))
      return Response.json({ choices: [{ message: { content: JSON.stringify({ items }) } }] })
    }
    const points = JSON.parse(prompt.match(/【本批已确认测试点[^\n]*\n([^\n]+)/)![1]) as TestPoint[]
    if (mode === 'partial' && points[0].category === 'boundary') return new Response('边界批次模拟失败', { status: 400 })
    const raw = { testPointId: mode === 'invalid-point' ? 'excluded' : points[0].id, title: points[0].id + '查询超过上限被拒绝', steps: ['提交 21 条查询'], expected: ['拒绝查询'], evidence: [{ reqId: 'REQ-001', quote }] }
    return Response.json({ choices: [{ message: { content: JSON.stringify({ cases: [raw], assumptions: [], uncovered: [] }) } }] })
  }
  try {
    await t.test('no confirmed points blocks generation without changing old cases', async () => {
      reset()
      current().analysis!.sections[0].points[0].status = 'pending'
      await assert.rejects(generateConfirmedCases(current(), ['normal'], true), /没有已确认测试点/)
      assert.equal(calls, 0)
      assert.deepEqual(repo.all<TestCase>('cases'), [old])
      assert.equal(tracesOf(requirement.id)[0].status, 'failed')
    })
    await t.test('confirmed sources must still match actual original text', async () => {
      reset()
      current().analysis!.sections[0].points[0].evidence[0].quote = quote.replace('<=', '>=')
      await assert.rejects(generateConfirmedCases(current(), ['normal']), /引用不匹配原文/)
      assert.equal(calls, 0)
    })
    await t.test('only confirmed points enter prompts and saved cases keep source snapshots', async () => {
      reset()
      assert.equal(generationPlan(current(), ['normal']).points.length, 1)
      const result = await generateConfirmedCases(current(), ['normal'])
      assert.equal(result.total, 1)
      const generated = repo.all<TestCase>('cases').find(c => c.source)!
      assert.equal(generated.source!.pointId, 'confirmed')
      assert.equal(generated.source!.runId, result.runId)
      assert(!prompts[0].includes('pending查询规则'))
      assert(!prompts[0].includes('excluded查询规则'))
      const trace = tracesOf(requirement.id)[0]
      assert.equal(trace.status, 'succeeded')
      assert(trace.caseIds.includes(generated.id))
      assert(trace.steps.some(step => step.name.includes('模型请求') && typeof step.output === 'string'))
      assert(trace.steps.some(step => step.name.includes('保存用例')))
    })
    for (const failure of ['invalid-point', 'validation-failure', 'invalid-json', 'changed-input']) {
      await t.test(`${failure} preserves old cases and records the failed stage`, async () => {
        reset()
        mode = failure
        await assert.rejects(generateConfirmedCases(current(), ['normal'], true))
        assert.deepEqual(repo.all<TestCase>('cases'), [old])
        const trace = tracesOf(requirement.id)[0]
        assert.equal(trace.status, 'failed')
        assert(trace.steps.some(step => step.status === 'failed'))
        const saved = fs.readFileSync(path.join(directory, 'traces.json'), 'utf8')
        assert(!saved.includes('test-secret-never-record'))
        if (failure === 'invalid-json') assert(trace.steps.some(step => step.name.includes('修复重试')))
      })
    }
    await t.test('off-target conclusions are marked unsupported rather than accepted', async () => {
      reset()
      mode = 'off-target'
      const result = await generateConfirmedCases(current(), ['normal'])
      assert.equal(result.unverified, 1)
      const generated = repo.all<TestCase>('cases').find(c => c.source)!
      assert.deepEqual(generated.expected, ['需求未明确，待业务确认实际处理结果'])
      assert(generated.assumptions.some(text => text.includes('一致性未通过')))
    })
    await t.test('confirmation does not silently erase unresolved business questions', async () => {
      reset()
      current().analysis!.sections[0].points[0].questions = ['待业务确认具体提示内容']
      await generateConfirmedCases(current(), ['normal'])
      assert(repo.all<TestCase>('cases').find(c => c.source)!.assumptions.includes('待业务确认具体提示内容'))
    })
    await t.test('append reports partial success while overwrite keeps originals on partial failure', async () => {
      for (const overwrite of [false, true]) {
        reset()
        current().analysis!.sections[0].points.push(point('boundary', 'confirmed', 'boundary'))
        mode = 'partial'
        if (overwrite) {
          await assert.rejects(generateConfirmedCases(current(), ['normal', 'boundary'], true))
          assert.deepEqual(repo.all<TestCase>('cases'), [old])
        } else {
          const result = await generateConfirmedCases(current(), ['normal', 'boundary'])
          assert.equal(result.total, 1)
          assert.equal(result.errors.length, 1)
          assert.equal(tracesOf(requirement.id)[0].status, 'partial')
        }
      }
    })
    await t.test('unfinished persisted runs are identified after interruption', () => {
      reset()
      const trace: WorkflowTrace = { id: 'orphan-run', requirementId: requirement.id, projectId: requirement.projectId, kind: 'generation', status: 'running', startedAt: '2026-11-06T00:00:00Z', model: 'fixture', input: {}, caseIds: [], steps: [] }
      repo.insert('traces', trace)
      assert.equal(tracesOf(requirement.id)[0].status, 'interrupted')
    })
    const app = express()
    app.use(express.json())
    app.get('/api/health', (_req, res) => res.json({ ok: true, model: '隔离测试样本', llm: { ready: true } }))
    app.use('/api', requirementsRouter, casesRouter, generateRouter, assessmentRouter, exportRouter)
    app.use(express.static(path.resolve('web/dist')))
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => res.status(error instanceof AppError ? error.status : 500).json({ error: error.message }))
    const server = app.listen(process.argv.includes('--preview') ? 3082 : 0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert(address && typeof address !== 'string')
    const request = async (route: string, method = 'GET', body?: unknown) => {
      const response = await originalFetch(`http://127.0.0.1:${address.port}/api${route}`, {
        method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: response.status, body: await response.json() as any }
    }
    try {
      await t.test('trace APIs isolate versions and keep manual changes and review snapshots', async () => {
        reset()
        const generated = await generateConfirmedCases(current(), ['normal'])
        const id = generated.caseIds[0]
        assert.equal((await request(`/requirements/wrong/traces/${generated.runId}`)).status, 404)
        assert.equal((await request(`/requirements/${requirement.id}/traces/${generated.runId}`)).body.id, generated.runId)
        const exported = await originalFetch(`http://127.0.0.1:${address.port}/api/requirements/${requirement.id}/export?format=csv`)
        const csv = await exported.text()
        assert(csv.includes('来源测试点 ID') && csv.includes(generated.runId) && csv.includes(id))
        const patched = await request(`/cases/${id}`, 'PATCH', { priority: 'P2' })
        assert.equal(patched.status, 200)
        assert.equal(patched.body.source.runId, generated.runId)
        assert.equal((await request(`/cases/${id}/assessment`, 'PATCH', { verdict: 'effective', reviewer: '隔离测试' })).status, 200)
        const history = (await request(`/requirements/${requirement.id}/traces?caseId=${id}`)).body
        assert(history.some((run: WorkflowTrace) => run.kind === 'generation'))
        assert(history.some((run: WorkflowTrace) => run.kind === 'case_edit'))
        assert(history.some((run: WorkflowTrace) => run.kind === 'assessment'))
        const other = (await request(`/requirements/${requirement.id}/traces?caseId=unknown`)).body
        assert.equal(other.length, 0)
        mode = 'validation-failure'
        const failed = await request(`/cases/${id}`, 'PATCH', { title: '修改内容触发复核' })
        assert.equal(failed.status, 400)
        assert.equal(repo.findById<TestCase>('cases', id)!.title, patched.body.title)
        assert(tracesOf(requirement.id).some(run => run.kind === 'case_edit' && run.status === 'failed' && run.caseIds.includes(id)))
        mode = 'success'
      })
      if (process.argv.includes('--preview')) {
        reset()
        repo.insert('projects', { id: requirement.projectId, name: '流程追溯 · 隔离验证', createdAt: requirement.createdAt })
        await generateConfirmedCases(current(), ['normal'])
        mode = 'validation-failure'
        await assert.rejects(generateConfirmedCases(current(), ['normal'], true))
        mode = 'success'
        console.log('隔离验证页面：http://127.0.0.1:3082（全部模型输出为测试样本，不使用实际项目数据）')
        await once(server, 'close')
      }
    } finally {
      if (server.listening) {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    }
  } finally {
    globalThis.fetch = originalFetch
    Object.assign(config, previous)
    assert(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'testpilot-trace-')))
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
