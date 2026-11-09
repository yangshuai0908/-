import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { test } from 'node:test'
import express from 'express'
import { config, rootDir } from '../config.js'
import { requirementsRouter } from '../modules/requirements/routes.js'
import { casesRouter, generateRouter, exportRouter } from '../modules/cases/index.js'
import { reviewRouter, compareRouter, assessmentRouter } from '../modules/review/index.js'
import { agentRouter } from '../modules/agent/index.js'
import { analysisTool } from '../modules/agent/tools/analysis.js'
import { AnalysisResultSchema, buildAnalysisMessages, buildAnalysisSections, locateAnalysisEvidence } from '../modules/requirements/analysis.js'
import { chatJson, extractJson } from '../llm/json.js'
import { AppError } from '../utils.js'
import type { Chunk, RequirementAnalysis, RequirementVersion } from '../store/schema.js'

const chunks: Chunk[] = [
  { reqId: 'REQ-001', sectionPath: '查询', text: '查询数量必须 <= 20，超过上限时拒绝查询。', order: 0 },
  { reqId: 'REQ-002', sectionPath: '权限', text: '普通用户只能查询本人记录。', order: 1 },
]
const sectionOf = (chunk: Chunk) => ({
  reqId: chunk.reqId,
  points: [{
    title: `${chunk.sectionPath}规则`, category: 'normal', objective: '验证原文规定的行为和适用条件',
    evidence: [{ reqId: chunk.reqId, quote: chunk.text }], questions: [],
  }],
  questions: [], notTestableReason: '',
})
const fixture = { sections: chunks.map(sectionOf) }
const document = '# 查询需求\n\n## 数量\n查询数量必须 <= 20，超过上限时拒绝查询。\n\n## 权限\n普通用户只能查询本人记录。\n\n## 页面\n查询结果按创建时间降序排列。\n\n## 背景\n系统支持内部业务人员查询已归档的记录。'

type ModelRequest = { messages: { role: string; content: string }[]; response_format?: { type: string } }
type ModelOutput = (chunks: Chunk[], request: ModelRequest) => { content: string; finish_reason?: string }

async function startHarness(port = 0) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testpilot-analysis-'))
  const originalConfig = { ...config }
  Object.assign(config, { dataDir: directory, apiKey: 'local-fixture-only', baseUrl: 'http://127.0.0.1:1', model: 'local-analysis-fixture' })
  const originalFetch = globalThis.fetch
  let modelCalls = 0
  let failModel = false
  let modelOutput: ModelOutput | undefined
  const modelRequests: ModelRequest[] = []
  let hold: Promise<void> | undefined
  let release: (() => void) | undefined
  globalThis.fetch = async (_input, init) => {
    modelCalls++
    if (hold) await hold
    const body = JSON.parse(String(init?.body)) as ModelRequest
    modelRequests.push(body)
    const prompt = body.messages.find((message) => message.role === 'user')!.content
    const payload = JSON.parse(prompt)
    if (failModel || payload.chunks.some((chunk: Chunk) => chunk.text.includes('[模拟模型失败]'))) {
      return new Response('模拟模型暂时不可用，未保存本次分析', { status: 400 })
    }
    const output = modelOutput?.(payload.chunks, body) ?? { content: JSON.stringify({ sections: payload.chunks.map(sectionOf) }) }
    return Response.json({ choices: [{ message: { content: output.content }, finish_reason: output.finish_reason ?? 'stop' }] })
  }

  const app = express()
  app.use(express.json())
  app.get('/api/health', (_req, res) => res.json({ ok: true, model: config.model, llm: { ready: true, reason: '隔离验证：模型输出为固定测试样本' } }))
  app.use('/api', requirementsRouter, casesRouter, generateRouter, exportRouter, reviewRouter, compareRouter, assessmentRouter, agentRouter)
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof AppError ? error.status : 500).json({ error: error.message })
  })
  const server = app.listen(port, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api`
  const request = async (route: string, method = 'GET', body?: unknown) => {
    const response = await originalFetch(url + route, {
      method, headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() as any }
  }
  return {
    request, directory,
    calls: () => modelCalls,
    modelRequests,
    setOutput: (value?: ModelOutput) => { modelOutput = value },
    setFailure: (value: boolean) => { failModel = value },
    hold: () => { hold = new Promise<void>((resolve) => { release = resolve }) },
    release: () => { release?.(); hold = undefined },
    close: async () => {
      release?.()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      globalThis.fetch = originalFetch
      Object.assign(config, originalConfig)
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

if (process.argv.includes('--preview')) {
  const harness = await startHarness(3101)
  const project = await harness.request('/projects', 'POST', { name: '需求分析 UI 验证（模拟模型）' })
  await harness.request(`/projects/${project.data.id}/requirements`, 'POST', { label: 'v1 正常分析', rawText: document })
  await harness.request(`/projects/${project.data.id}/requirements`, 'POST', { label: 'v2 模型失败', rawText: document + '\n[模拟模型失败]' })
  const { createServer } = await import('vite')
  const vite = await createServer({
    root: path.join(rootDir, 'web'),
    configFile: path.join(rootDir, 'web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 5175, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3101' } } },
  })
  await vite.listen()
  console.log('隔离 UI 预览：http://127.0.0.1:5175（固定模型样本，临时数据，不调用真实模型）')
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
    await vite.close()
    await harness.close()
    process.exit(0)
  })
} else {
  test('正确解码引用中的引号、反斜杠和换行，不擅自修补错误JSON', () => {
    const value = { quote: '状态为“已预约”，title 包含 "会议"，路径 C:\\meeting。\n保留换行。' }
    assert.deepEqual(extractJson(JSON.stringify(value)), value)
    assert.deepEqual(extractJson('```json\n' + JSON.stringify(value) + '\n```'), value)
    assert.equal(extractJson('{"objective":"验证"自然日"和"08:00～20:00"采用的业务时区"}'), null)
  })

  test('测试点逐条对应输入，全部默认待确认，来源必须保留比较符号', () => {
    const sections = buildAnalysisSections(fixture, chunks)
    assert.equal(sections.length, 2)
    assert.equal(sections[0].points[0].status, 'pending')
    assert.equal(sections[0].points[0].evidence[0].matched, true)
    assert.notEqual(sections[0].points[0].id, sections[1].points[0].id)
    for (const quote of ['查询数量必须 >= 20', '查询数量必须 <= 30', '查询数量必须 <= 2.0']) {
      assert.equal(locateAnalysisEvidence(chunks, [{ reqId: 'REQ-001', quote }])[0].matched, false)
    }
    assert.equal(locateAnalysisEvidence(chunks, [{ reqId: 'REQ-999', quote: chunks[0].text }])[0].matched, false)
  })

  test('分批分析只提供本批编号与正文，不暴露其他批次目录', () => {
    const messages = buildAnalysisMessages(chunks.slice(0, 1))
    const payload = JSON.parse(messages[1].content)
    assert.deepEqual(payload.allowedReqIds, ['REQ-001'])
    assert.equal(payload.expectedSectionCount, 1)
    assert.equal(payload.chunks.length, 1)
    assert.equal('sectionIndex' in payload, false)
    assert(!messages.map(message => message.content).join('\n').includes('REQ-002'))
    assert.match(messages[0].content, /不得添加其他章节的结果或占位说明/)
  })

  test('不允许遗漏、重复、捏造条款或无解释地返回空测试点', () => {
    assert.throws(() => buildAnalysisSections({ sections: [fixture.sections[0]] }, chunks))
    assert.throws(() => buildAnalysisSections({ sections: [fixture.sections[0], fixture.sections[0]] }, chunks))
    assert.throws(() => buildAnalysisSections({ sections: [{ ...fixture.sections[0], reqId: 'REQ-999' }, fixture.sections[1]] }, chunks))
    assert.throws(() => buildAnalysisSections({ sections: [{ ...fixture.sections[0], points: [] }, fixture.sections[1]] }, chunks))
    const background = buildAnalysisSections({ sections: [{ ...fixture.sections[0], points: [], notTestableReason: '仅为背景说明' }, fixture.sections[1]] }, chunks)
    assert.equal(background[0].notTestableReason, '仅为背景说明')
    assert.throws(() => buildAnalysisSections({ sections: [{ ...fixture.sections[0], notTestableReason: '已有测试点不能标为不适用' }, fixture.sections[1]] }, chunks))
  })

  test('保留未匹配引用及待确认问题，模型不能代替人工确认', () => {
    const point = { ...fixture.sections[0].points[0], status: 'confirmed', evidence: [{ reqId: 'REQ-001', quote: '原文不存在的业务规则' }], questions: ['边界条件需业务确认'] }
    const result = buildAnalysisSections({ sections: [{ ...fixture.sections[0], points: [point] }, fixture.sections[1]] }, chunks)
    assert.equal(result[0].points[0].status, 'pending')
    assert.equal(result[0].points[0].evidence[0].matched, false)
    assert.deepEqual(result[0].points[0].questions, ['边界条件需业务确认'])
  })

  test('需求分析 API、Agent复用、人工确认、失败保护与版本隔离', async (t) => {
    const harness = await startHarness()
    const { request } = harness
    t.after(harness.close)
    const project = await request('/projects', 'POST', { name: '自动化隔离测试' })
    const created = await request(`/projects/${project.data.id}/requirements`, 'POST', { label: 'v1', rawText: document })
    const requirement = created.data as RequirementVersion
    const route = `/requirements/${requirement.id}/analysis`
    let analysis: RequirementAnalysis
    let pointId: string
    let patch: Record<string, unknown>

    await t.test('初始为空、错误参数和未知版本被拒绝', async () => {
      assert.equal((await request(route)).data, null)
      assert.equal((await request('/requirements/unknown/analysis')).status, 404)
      assert.equal((await request(route, 'POST', { replaceAnalysisId: 1 })).status, 400)
    })
    await t.test('分批分析完整保存，重复请求不覆盖已有分析', async () => {
      const response = await request(route, 'POST', {})
      assert.equal(response.status, 200)
      analysis = response.data
      assert.equal(analysis.sections.length, requirement.chunks.length)
      assert.equal(harness.calls(), 2)
      assert.equal((await request(route, 'POST', {})).data.id, analysis.id)
      assert.equal(harness.calls(), 2)
      const saved = JSON.parse(fs.readFileSync(path.join(harness.directory, 'requirements.json'), 'utf8'))
      assert.equal(saved[0].analysis.id, analysis.id)
      const point = analysis.sections[0].points[0]
      pointId = point.id
      patch = { analysisId: analysis.id, analysisUpdatedAt: analysis.updatedAt, title: point.title, category: point.category, objective: point.objective, evidence: point.evidence, questions: [], status: 'confirmed' }
    })
    await t.test('允许编辑确认，未知引用或空目标不能被确认', async () => {
      const pointRoute = `${route}/points/${pointId}`
      const response = await request(pointRoute, 'PATCH', { ...patch, title: '人工核对后的测试点' })
      assert.equal(response.status, 200)
      assert.equal(response.data.sections[0].points[0].status, 'confirmed')
      assert.equal((await request(pointRoute, 'PATCH', patch)).status, 409)
      assert.equal((await request(route)).data.sections[0].points[0].title, '人工核对后的测试点')
      patch.analysisUpdatedAt = response.data.updatedAt
      assert.equal((await request(pointRoute, 'PATCH', { ...patch, objective: '' })).status, 400)
      assert.equal((await request(pointRoute, 'PATCH', { ...patch, evidence: [] })).status, 400)
      assert.equal((await request(pointRoute, 'PATCH', { ...patch, evidence: [{ reqId: 'REQ-999', quote: '无依据' }] })).status, 400)
      assert.equal((await request(pointRoute, 'PATCH', { ...patch, analysisId: 'old' })).status, 409)
      const pending = await request(pointRoute, 'PATCH', { ...patch, evidence: [{ reqId: 'REQ-999', quote: '待纠正依据' }], status: 'pending' })
      assert.equal(pending.status, 200)
      assert.equal(pending.data.sections[0].points[0].evidence[0].matched, false)
      patch.analysisUpdatedAt = pending.data.updatedAt
    })
    await t.test('Agent读取已有清单，不重复调用模型或跨项目读取', async () => {
      const calls = harness.calls()
      const response = await analysisTool.execute({}, { projectId: project.data.id, currentRequirementId: requirement.id })
      assert.equal((response.data as { reused: boolean }).reused, true)
      assert.equal(harness.calls(), calls)
      await assert.rejects(() => analysisTool.execute({ requirementId: requirement.id }, { projectId: 'other-project' }))
    })
    await t.test('重新分析失败不丢失人工修改', async () => {
      const before = (await request(route)).data
      harness.setFailure(true)
      const failed = await request(route, 'POST', { replaceAnalysisId: analysis.id })
      assert.equal(failed.status, 400)
      assert.deepEqual((await request(route)).data, before)
      harness.setFailure(false)
    })
    await t.test('分析期间拒绝重复分析和编辑，成功后旧id失效', async () => {
      harness.hold()
      const pending = request(route, 'POST', { replaceAnalysisId: analysis.id })
      let conflict
      for (let i = 0; i < 10; i++) {
        conflict = await request(`${route}/points/${pointId}`, 'PATCH', patch)
        if (conflict.status === 409) break
      }
      assert.equal(conflict?.status, 409)
      assert.equal((await request(route, 'POST', { replaceAnalysisId: analysis.id })).status, 409)
      harness.release()
      const refreshed = await pending
      assert.equal(refreshed.status, 200)
      assert.notEqual(refreshed.data.id, analysis.id)
      assert.equal((await request(`${route}/points/${pointId}`, 'PATCH', patch)).status, 409)
    })
    await t.test('引号错误修复成功，首次和修复请求均启用JSON模式', async (t) => {
      t.after(() => harness.setOutput())
      harness.setOutput((input, body) => {
        const malformed = JSON.stringify({ sections: input.map(sectionOf), padding: 'x'.repeat(6200) })
          .replace('验证原文规定的行为和适用条件', '验证"自然日"采用的业务时区')
        if (body.messages.length === 2) return { content: malformed }
        assert.equal(body.messages[2].content, malformed)
        assert.match(body.messages[3].content, /JSON 语法错误/)
        assert.match(body.messages[3].content, /正确转义示例/)
        return { content: JSON.stringify({ sections: input.map(sectionOf) }) }
      })
      const created = await request(`/projects/${project.data.id}/requirements`, 'POST', { label: 'JSON修复', rawText: document })
      const calls = harness.calls()
      const response = await request(`/requirements/${created.data.id}/analysis`, 'POST', {})
      assert.equal(response.status, 200)
      assert.equal(response.data.sections.length, created.data.chunks.length)
      assert.equal(harness.calls() - calls, 4)
      assert(harness.modelRequests.slice(calls).every((body) => body.response_format?.type === 'json_object'))
    })
    await t.test('未启用JSON模式的既有调用者保留原请求与一次修复行为', async (t) => {
      t.after(() => harness.setOutput())
      harness.setOutput((input, body) => ({ content: body.messages.length === 2 ? '不是JSON' : JSON.stringify({ sections: input.map(sectionOf) }) }))
      const calls = harness.calls()
      const result = await chatJson(AnalysisResultSchema, buildAnalysisMessages(chunks))
      assert.equal(result.sections.length, chunks.length)
      assert.equal(harness.calls() - calls, 2)
      assert(harness.modelRequests.slice(calls).every((body) => !('response_format' in body)))
    })
    await t.test('批次外占位结果和重复编号按范围错误修复，不被当成语法错误保留', async (t) => {
      t.after(() => harness.setOutput())
      for (const duplicate of [false, true]) {
        harness.setOutput((input, body) => {
          const payload = JSON.parse(body.messages[1].content)
          assert.deepEqual(payload.allowedReqIds, input.map(chunk => chunk.reqId))
          assert.equal('sectionIndex' in payload, false)
          if (body.messages.length === 2) {
            const extra = duplicate ? sectionOf(input[0]) : { reqId: 'REQ-999', points: [], questions: ['本批不应返回的条款'], notTestableReason: '' }
            return { content: JSON.stringify({ sections: [...input.map(sectionOf), extra] }) }
          }
          const repair = body.messages.at(-1)!.content
          assert.match(repair, /当前 JSON 已能解析/)
          assert.match(repair, duplicate ? /重复/ : /本批仅允许/)
          assert(!repair.includes('保留所有条款'))
          return { content: JSON.stringify({ sections: input.map(sectionOf) }) }
        })
        const created = await request(`/projects/${project.data.id}/requirements`, 'POST', { label: duplicate ? '重复编号修复' : '批次范围修复', rawText: document })
        const calls = harness.calls()
        const response = await request(`/requirements/${created.data.id}/analysis`, 'POST', {})
        assert.equal(response.status, 200)
        assert.deepEqual(response.data.sections.map((section: { reqId: string }) => section.reqId), created.data.chunks.map((chunk: Chunk) => chunk.reqId))
        assert.equal(harness.calls() - calls, 4)
        assert(response.data.sections.every((section: { points: { status: string }[] }) => section.points.every(point => point.status === 'pending')))
      }
    })
    await t.test('范围修复仍不合格时保留失败记录，不静默过滤或覆盖已有分析', async (t) => {
      t.after(() => harness.setOutput())
      const before = (await request(route)).data
      harness.setOutput(input => ({ content: JSON.stringify({ sections: [...input.map(sectionOf), { reqId: 'REQ-999', points: [], questions: ['越界占位'], notTestableReason: '' }] }) }))
      const failed = await request(route, 'POST', { replaceAnalysisId: before.id })
      assert.equal(failed.status, 500)
      assert.match(failed.data.error, /收到批次外条款 REQ-999/)
      assert.deepEqual((await request(route)).data, before)
      const history = (await request(`/requirements/${requirement.id}/traces`)).data
      assert(history.some((run: { kind: string; status: string }) => run.kind === 'analysis' && run.status === 'failed'))
    })
    await t.test('后批引号错误且修复失败，不保存半成品或覆盖已有人工结果', async (t) => {
      t.after(() => harness.setOutput())
      harness.setOutput((input) => ({ content: input.length > 1 ? JSON.stringify({ sections: input.map(sectionOf) }) : '{"objective":"验证"自然日""}' }))
      const fresh = await request(`/projects/${project.data.id}/requirements`, 'POST', { label: '后批失败', rawText: document })
      const freshRoute = `/requirements/${fresh.data.id}/analysis`
      for (const target of [freshRoute, route]) {
        const before = (await request(target)).data
        const calls = harness.calls()
        const failed = await request(target, 'POST', before ? { replaceAnalysisId: before.id } : {})
        assert.equal(failed.status, 500)
        assert.match(failed.data.error, /修复后仍未返回合法 JSON/)
        assert.equal(harness.calls() - calls, 3)
        assert.deepEqual((await request(target)).data, before)
      }
      harness.setOutput()
      assert.equal((await request(freshRoute, 'POST', {})).status, 200)
    })
    await t.test('JSON模式仍严格校验条款完整性，并保留截断错误', async (t) => {
      t.after(() => harness.setOutput())
      const before = (await request(route)).data
      harness.setOutput(() => ({ content: '{"sections":[]}' }))
      let calls = harness.calls()
      const invalid = await request(route, 'POST', { replaceAnalysisId: before.id })
      assert.equal(invalid.status, 500)
      assert.match(invalid.data.error, /遗漏条款/)
      assert.equal(harness.calls() - calls, 2)
      harness.setOutput(() => ({ content: '{"sections":[', finish_reason: 'length' }))
      calls = harness.calls()
      const truncated = await request(route, 'POST', { replaceAnalysisId: before.id })
      assert.equal(truncated.status, 502)
      assert.match(truncated.data.error, /截断/)
      assert.equal(harness.calls() - calls, 1)
      assert.deepEqual((await request(route)).data, before)
    })
    await t.test('另一个版本保持未分析，测试用例不被修改', async () => {
      const second = await request(`/projects/${project.data.id}/requirements`, 'POST', { label: 'v2', rawText: document })
      assert.equal((await request(`/requirements/${second.data.id}/analysis`)).data, null)
      assert.equal((await request(`/requirements/${second.data.id}/analysis/points/${pointId}`, 'PATCH', patch)).status, 409)
      assert.equal(fs.existsSync(path.join(harness.directory, 'cases.json')), false)
      await request(`/requirements/${second.data.id}`, 'DELETE')
      assert.equal((await request(`/requirements/${second.data.id}/analysis`)).status, 404)
    })
  })
}
