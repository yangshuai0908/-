import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { test } from 'node:test'
import express from 'express'
import { config, rootDir } from '../config.js'
import * as repo from '../store/fsRepo.js'
import type { RequirementVersion, RiskScan } from '../store/schema.js'
import { buildScanInput, resolveRisk, saveRiskScan } from '../modules/requirements/risks.js'
import { scanVulnerabilitiesTool } from '../modules/agent/tools/scanVulnerabilities.js'
import { analyzeRequirement, batchConfirmPoints, updateTestPoint } from '../modules/requirements/analysis.js'
import { requirementsRouter } from '../modules/requirements/routes.js'
import { AppError } from '../utils.js'

test('风险建议经核对进入澄清或候选测试点，保持持久化与人工确认边界', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testpilot-risk-'))
  const previous = { ...config }, originalFetch = globalThis.fetch
  Object.assign(config, { dataDir: directory, apiKey: 'isolated-fixture', baseUrl: 'http://risk-fixture.invalid', model: '隔离固定样本' })
  repo.resetAll(directory)
  const at = '2026-11-11T00:00:00.000Z'
  const requirement: RequirementVersion = {
    id: 'risk-requirement', projectId: 'risk-project', label: '风险流程验证', sourceType: 'paste', rawText: '隔离验证文档', apiList: [], createdAt: at,
    chunks: [
      { reqId: 'REQ-001', sectionPath: '背景与范围', text: '本模块支持用户登录，本期不含三方登录。', order: 0 },
      { reqId: 'REQ-002', sectionPath: '权限', text: '普通用户只能查询本人记录。', order: 1 },
    ],
  }
  repo.insert('projects', { id: requirement.projectId, name: '风险流程隔离验证', createdAt: at })
  repo.insert('requirements', requirement)
  const latest = () => repo.findById<RequirementVersion>('requirements', requirement.id)!
  const fixture = {
    summary: '背景说明不构成漏洞；权限规则可补充验证', issues: [
      { reqId: 'REQ-001', type: 'undefined_edge', findingKind: 'needs_clarification', severity: 'medium', location: '背景与范围', description: '需确认登录会话策略', riskImpact: '可能影响会话测试预期', evidence: [{ reqId: 'REQ-001', quote: requirement.chunks[0].text }], question: '同一账号是否允许多设备登录？' },
      { reqId: 'REQ-002', type: 'security_leak', findingKind: 'test_suggestion', severity: 'medium', location: '权限', description: '补充跨用户查询场景', riskImpact: '需要核对数据范围限制', evidence: [{ reqId: 'REQ-002', quote: requirement.chunks[1].text }], question: '' },
      { reqId: 'REQ-001', type: 'other', findingKind: 'needs_clarification', severity: 'low', location: '背景与范围', description: '第三方登录未来扩展建议', riskImpact: '本期不适用', evidence: [], question: '' },
      { reqId: 'REQ-002', type: 'other', findingKind: 'covered', severity: 'low', location: '权限', description: '数据范围已明确', riskImpact: '核对已有规则即可', evidence: [{ reqId: 'REQ-002', quote: requirement.chunks[1].text }], question: '' },
    ],
  }
  let requests: { messages: { role: string; content: string }[] }[] = []
  let modelResult: unknown = fixture
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('http://risk-fixture.invalid/')) return originalFetch(url, init)
    requests.push(JSON.parse(String(init?.body)))
    return Response.json({ choices: [{ message: { content: JSON.stringify(modelResult) }, finish_reason: 'stop' }] })
  }
  let scan!: RiskScan
  const app = express().use(express.json())
  app.get('/api/health', (_req, res) => res.json({ ok: true, model: config.model, llm: { ready: true } }))
  app.use('/api', requirementsRouter)
  app.use(express.static(path.join(rootDir, 'web/dist')))
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof AppError ? error.status : 500).json({ error: error.message }))
  const server = app.listen(0, '0.0.0.0')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}`
  try {
    await t.test('靶向扫描携带其他章节，结果保存且没有创建用例', async () => {
      const result = await scanVulnerabilitiesTool.execute({ reqId: 'REQ-001' }, { projectId: requirement.projectId, currentRequirementId: requirement.id })
      scan = latest().riskScans![0]
      assert.deepEqual(result.changes, ['requirements'])
      assert.equal((result.data as RiskScan).id, scan.id)
      const input = JSON.parse(requests[0].messages.find(m => m.role === 'user')!.content)
      assert.deepEqual(input.includedReqIds, ['REQ-001', 'REQ-002'])
      assert.match(requests[0].messages[0].content, /背景和范围说明不必包含所有业务规则/)
      assert.match(requests[0].messages[0].content, /不要要求为未来功能预留/)
      assert.equal(scan.issues[1].evidence[0].matched, true)
      assert.equal(latest().analysis, undefined)
      assert.equal(repo.all('cases').length, 0)
      const disk = JSON.parse(fs.readFileSync(path.join(directory, 'requirements.json'), 'utf8'))
      assert.equal(disk[0].riskScans[0].id, scan.id)
    })
    const pointInput = { action: 'point', point: { title: '拒绝查询其他用户记录', objective: '验证普通用户无法查询其他用户记录', category: 'permission', evidence: [{ reqId: 'REQ-002', quote: requirement.chunks[1].text }] } }
    await t.test('没有需求分析时不能跳过主流程，仍可保存待澄清问题', () => {
      assert.throws(() => resolveRisk(requirement.id, scan.id, scan.issues[1].id, pointInput), /先分析需求/)
      const updated = resolveRisk(requirement.id, scan.id, scan.issues[0].id, { action: 'question', question: '同一账号是否允许多设备登录？' })
      assert.equal(updated.riskScans![0].issues[0].resolution?.action, 'question')
      assert.equal(updated.analysis, undefined)
    })
    await t.test('补充测试点复用现有分析，不能伪造原文或人工确认', () => {
      repo.update<RequirementVersion>('requirements', requirement.id, { analysis: { id: 'analysis-risk', createdAt: at, updatedAt: at, sections: requirement.chunks.map(c => ({ reqId: c.reqId, points: [], questions: [], notTestableReason: '暂无测试点' })) } })
      assert.throws(() => resolveRisk(requirement.id, scan.id, scan.issues[1].id, { ...pointInput, point: { ...pointInput.point, evidence: [{ reqId: 'REQ-002', quote: '普通用户可以查询全部记录。' }] } }), /未匹配需求原文/)
      const updated = resolveRisk(requirement.id, scan.id, scan.issues[1].id, { ...pointInput, status: 'confirmed', review: { actor: 'human' } })
      const point = updated.analysis!.sections[1].points[0]
      assert.equal(point.status, 'pending'); assert.equal(point.review, undefined)
      assert.equal(updated.analysis!.sections[1].notTestableReason, '')
      assert.equal(updated.riskScans![0].issues[1].resolution?.pointId, point.id)
      const retried = resolveRisk(requirement.id, scan.id, scan.issues[1].id, pointInput)
      assert.equal(retried.analysis!.sections[1].points.length, 1)
      assert.equal(retried.analysis!.sections[1].points[0].id, point.id)
    })
    await t.test('澄清问题随候选测试点保留，批量确认不能用默认规则带过', async () => {
      const updated = resolveRisk(requirement.id, scan.id, scan.issues[0].id, { ...pointInput, point: { ...pointInput.point, title: '登录会话策略', objective: '待明确多设备登录时的会话行为', evidence: [{ reqId: 'REQ-001', quote: requirement.chunks[0].text }] } })
      const point = updated.analysis!.sections[0].points[0]
      assert.deepEqual(point.questions, ['同一账号是否允许多设备登录？'])
      const batch = await batchConfirmPoints(requirement.id, '隔离核对人', { onlyClear: false })
      assert.equal(batch.analysis.sections[0].points[0].status, 'pending')
      assert.equal(batch.analysis.sections[1].points[0].status, 'confirmed')
      await assert.rejects(updateTestPoint(requirement.id, point.id, { ...point, analysisId: batch.analysis.id, analysisUpdatedAt: batch.analysis.updatedAt, reviewer: '核对人', status: 'confirmed' }), /填写人工澄清结论/)
    })
    await t.test('忽略必须说明原因，已覆盖必须引用原文，完成的状态不可覆盖', () => {
      assert.throws(() => resolveRisk(requirement.id, scan.id, scan.issues[2].id, { action: 'ignored' }), /填写原因/)
      assert.throws(() => resolveRisk(requirement.id, scan.id, scan.issues[3].id, { action: 'covered', comment: '已明确' }), /引用已明确/)
      resolveRisk(requirement.id, scan.id, scan.issues[2].id, { action: 'ignored', comment: '明确排除的本期功能，不要求预留未来扩展' })
      resolveRisk(requirement.id, scan.id, scan.issues[3].id, { action: 'covered', comment: '权限章节已规定本人数据范围', evidence: pointInput.point.evidence })
      assert.throws(() => resolveRisk(requirement.id, scan.id, scan.issues[2].id, { action: 'question', question: '另一个问题' }), /已处理/)
      assert.equal(latest().riskScans![0].issues[3].resolution?.action, 'covered')
    })
    await t.test('无效条款不回退到全篇，截断上下文明示，扫描不覆盖较新的人工分析', () => {
      assert.throws(() => buildScanInput(requirement, 'REQ-999'), /条款不存在/)
      const large = { ...requirement, chunks: requirement.chunks.map(c => ({ ...c, text: c.text.repeat(2000) })) }
      const input = buildScanInput(large, 'REQ-002')
      assert.equal(input.chunks[0].reqId, 'REQ-002'); assert.equal(input.contextTruncated, true)
      assert(input.chunks.reduce((n, c) => n + c.text.length, 0) <= 24000)
      const analysis = latest().analysis
      saveRiskScan(requirement.id, buildScanInput(requirement), { summary: '没有可靠建议', issues: [] })
      assert.deepEqual(latest().analysis, analysis)
      assert.throws(() => saveRiskScan(requirement.id, buildScanInput(requirement), { ...fixture, issues: [{ ...fixture.issues[0], reqId: 'REQ-999' }] }), /上下文以外/)
    })
    await t.test('HTTP 路由返回持久化处理结果及明确失败，不生成用例', async () => {
      const missing = await originalFetch(`${url}/api/requirements/${requirement.id}/risk-scans/missing/issues/missing/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ignored', comment: '测试' }) })
      assert.equal(missing.status, 404)
      const response = await originalFetch(`${url}/api/requirements/${requirement.id}/risk-scans/${scan.id}/issues/${scan.issues[2].id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ignored', comment: '重试' }) })
      assert.equal(response.status, 200)
      const saved = await response.json() as RequirementVersion
      assert.equal(saved.riskScans![0].issues[2].resolution?.comment, '明确排除的本期功能，不要求预留未来扩展')
      assert.equal(repo.all('cases').length, 0)
    })
    await t.test('重新分析替换测试点后，原扫描建议可重新处理而不会指向失效测试点', async () => {
      modelResult = { sections: requirement.chunks.map(c => ({ reqId: c.reqId, points: [], questions: [], notTestableReason: '固定样本：需人工补充测试点' })) }
      await analyzeRequirement(requirement.id, latest().analysis!.id)
      const updated = resolveRisk(requirement.id, scan.id, scan.issues[1].id, pointInput)
      assert.equal(updated.analysis!.sections[1].points.length, 1)
      assert.equal(updated.analysis!.sections[1].points[0].status, 'pending')
      assert.equal(updated.riskScans![0].issues[1].resolution?.pointId, updated.analysis!.sections[1].points[0].id)
    })
    if (process.argv.includes('--preview')) {
      // 预览使用全新、未处理的固定建议，不连接模型或真实项目数据。
      repo.update<RequirementVersion>('requirements', requirement.id, { riskScans: [] })
      saveRiskScan(requirement.id, buildScanInput(requirement), fixture)
      console.log(`风险流程隔离预览 ${url}`)
      await new Promise<void>(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
    }
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    globalThis.fetch = originalFetch
    assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(directory, { recursive: true, force: true })
    Object.assign(config, previous)
  }
})
