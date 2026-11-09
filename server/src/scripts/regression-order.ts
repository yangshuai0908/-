/** 订单需求只读回归：使用现有需求/用例，不写入 data。 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import type { RequirementVersion, TestCase } from '../store/schema.js'
import { assessCases } from '../validate/caseSupport.js'
import { overallState } from '../validate/evidence.js'
import { prescreenDuplicates } from '../review/dedupe.js'

const requirements = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'requirements.json'), 'utf8')) as RequirementVersion[]
const cases = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'cases.json'), 'utf8')) as TestCase[]
const requirement = requirements.find((r) => r.chunks.some((c) => c.text.includes('单笔订单最多允许购买 99 件商品')))
if (!requirement) throw new Error('找不到现有订单管理需求')
if (!config.apiKey) throw new Error('缺少模型配置，无法完成真实语义回归')
const own = cases.filter((c) => c.requirementId === requirement.id)
const pick = (fragment: string) => {
  const found = own.find((c) => c.title.includes(fragment))
  if (!found) throw new Error(`找不到用例：${fragment}`)
  return found
}
const unique: TestCase = {
  ...pick('订单编号长度为最大值+1被拒绝'),
  id: 'regression-unique', title: '订单编号唯一性',
  steps: ['创建两个订单，检查系统生成的订单编号'],
  expected: ['两个订单的订单编号不能相同'],
  evidence: [{ reqId: 'REQ-010', quote: '同一订单编号必须唯一。' } as TestCase['evidence'][number]],
  assumptions: [],
}
const otherOrder: TestCase = {
  ...pick('普通用户查询自己的订单被允许'),
  id: 'regression-other', title: '普通用户查看其他用户订单被拒绝',
  steps: ['普通用户直接请求其他用户的订单数据'],
  expected: ['普通用户不能查看其他用户的订单'],
  evidence: [{ reqId: 'REQ-007', quote: '普通用户只能访问自己的订单数据。' } as TestCase['evidence'][number]],
  assumptions: [],
}
const checked = await assessCases([
  unique,
  pick('购买数量为99件成功'),
  pick('购买数量为100件被拒绝'),
  pick('订单编号长度为最大值+1被拒绝'),
  pick('分页查询pageSize为最大值+1'),
  pick('订单金额为最大值+1'),
  pick('普通用户修改其他用户订单'),
  pick('普通用户查询自己的订单被允许'),
  otherOrder,
], requirement.chunks, true)

const states = checked.map((c) => ({ title: c.title, state: overallState(c.evidence), gaps: c.assumptions }))
for (const row of states) console.log(`${row.state.padEnd(8)} ${row.title} ${row.gaps.join('；')}`)
const fails: string[] = []
const requireState = (fragment: string, expected: string) => {
  const row = states.find((s) => s.title.includes(fragment))
  if (row?.state !== expected) fails.push(`${fragment}: expected ${expected}, got ${row?.state}`)
}
requireState('购买数量为99件成功', 'explicit')
requireState('订单编号唯一性', 'explicit')
requireState('购买数量为100件被拒绝', 'unknown')
requireState('订单编号长度为最大值+1被拒绝', 'unknown')
requireState('分页查询pageSize为最大值+1', 'unknown')
requireState('订单金额为最大值+1', 'unknown')
requireState('普通用户修改其他用户订单', 'explicit')
requireState('普通用户查询自己的订单被允许', 'explicit')
requireState('普通用户查看其他用户订单被拒绝', 'explicit')
for (const fragment of ['订单编号长度为最大值+1被拒绝', '分页查询pageSize为最大值+1', '订单金额为最大值+1']) {
  const found = checked.find((c) => c.title.includes(fragment))
  if (!found?.expected.join('').includes('待业务确认')) fails.push(`${fragment}: 未将无依据预期改为待确认`)
}
const hundred = checked.find((c) => c.title.includes('购买数量为100件被拒绝'))
if (!hundred?.expected.some((s) => s.includes('订单创建失败')) || !hundred.expected.some((s) => s.includes('提示需求未明确'))) {
  fails.push('100件用例未保留超限结论并标明提示待确认')
}
const duplicatePairs = prescreenDuplicates(own)
console.log(`近似重复候选：${duplicatePairs.length} 组`)
if (!duplicatePairs.some((d) => d.caseIds.every((id) => own.find((c) => c.id === id)?.title.includes('普通用户')))) {
  fails.push('未识别普通用户查询自己订单的近似重复')
}
if (fails.length) throw new Error(`回归失败：\n${fails.join('\n')}`)
console.log('订单需求回归通过')
