/**
 * 核心算法自检脚本
 *   npx tsx src/scripts/selftest.ts
 *
 * 覆盖两件事：
 * 1. 证据溯源校验（防编造）—— 精确引用、正常改写、数值篡改、整句编造
 * 2. 需求切块 —— 条款边界是否落在标题上
 */
import { chunkRequirement } from '../docs/chunk.js'
import type { Chunk } from '../store/schema.js'
import { normalize, verifyEvidence } from '../validate/evidence.js'

interface Check {
  quote: string
  expect: 'exact' | 'fuzzy' | 'unverified'
  note: string
}

const SAMPLE_TEXT = `3.2 账号规则：账号长度 6-20 位，仅允许字母、数字和下划线；密码 8-32 位，必须包含大小写字母和数字。连续输错 5 次锁定 30 分钟。`

const SAMPLE_CHUNK: Chunk = {
  reqId: 'REQ-TEST',
  sectionPath: '账号规则',
  text: SAMPLE_TEXT,
  order: 0,
}

const CHECKS: Check[] = [
  { quote: '账号长度 6-20 位', expect: 'exact', note: '精确引用' },
  { quote: '密码 8-32 位，必须包含大小写字母和数字', expect: 'exact', note: '精确引用（含标点）' },
  { quote: '连续输错 5 次锁定 30 分钟', expect: 'exact', note: '精确引用' },
  { quote: '账号长度应为6至20位', expect: 'fuzzy', note: '正常改写：区间符号变化' },
  { quote: '密码必须8-32位并含大小写字母和数字', expect: 'fuzzy', note: '正常改写：措辞调整' },
  { quote: '账号长度 6-20 位且仅允许字母、数字和下划线', expect: 'fuzzy', note: '正常改写：合并两处表述' },
  { quote: '账号长度 8-32 位', expect: 'unverified', note: '数值张冠李戴（把密码区间安到账号上）' },
  { quote: '连续输错 3 次锁定 10 分钟', expect: 'unverified', note: '篡改关键阈值' },
  { quote: '账号可以绑定手机号', expect: 'unverified', note: '整句编造，需求里没有' },
  { quote: '锁定时间可配置', expect: 'unverified', note: '编造不存在的配置项' },
]

function runEvidenceChecks(): { pass: number; total: number } {
  console.log('\n【1】证据溯源校验')
  console.log('─'.repeat(96))
  let pass = 0
  for (const c of CHECKS) {
    const r = verifyEvidence(SAMPLE_CHUNK, { reqId: 'REQ-TEST', quote: c.quote })
    const actual = r.quoteMatch === 'missing' ? 'unverified' : r.quoteMatch
    const ok = actual === c.expect
    if (ok) pass++
    const mark = ok ? 'PASS' : 'MISS'
    console.log(
      `${mark}  ${actual.padEnd(11)} ${c.expect.padEnd(11)} ${String(r.score.toFixed(2)).padEnd(5)} ${c.note}`,
    )
    console.log(`      quote: ${c.quote}`)
    console.log(`      reason: ${r.reason}${r.relocated ? ` | 建议替换: ${r.relocated.slice(0, 30)}` : ''}`)
  }
  return { pass, total: CHECKS.length }
}

function runNormalizeChecks(): void {
  console.log('\n【2】归一化一致性')
  console.log('─'.repeat(96))
  const pairs: [string, string][] = [
    ['6-20位', '6至20位'],
    ['6-20位', '6~20位'],
    ['账号长度', '账号 长度'],
    ['ABC123', 'abc123'],
  ]
  for (const [a, b] of pairs) {
    const same = normalize(a) === normalize(b)
    console.log(`${same ? 'PASS' : 'MISS'}  ${a.padEnd(12)} vs ${b.padEnd(12)} → ${normalize(a)} / ${normalize(b)}`)
  }
}

function runChunkChecks(): void {
  console.log('\n【3】需求切块')
  console.log('─'.repeat(96))
  const doc = `# 模块说明

## 1 概述

这是概述内容，描述模块背景和范围，不涉及具体规则说明。

## 2 账号

### 2.1 账号规则

- 账号长度 6-20 位，仅允许字母、数字和下划线。
- 密码 8-32 位，必须包含大小写字母和数字。

### 2.2 账号状态

- 正常：可正常登录。
- 锁定：连续失败触发。
- 停用：管理员设置。
`
  const chunks = chunkRequirement(doc)
  for (const c of chunks) {
    console.log(`  ${c.reqId}  ${c.sectionPath.split(' / ').slice(-1)[0].padEnd(14)} ${c.text.slice(0, 40).replace(/\n/g, ' ')}`)
  }
  const hasRule = chunks.some((c) => c.sectionPath.endsWith('2.1 账号规则'))
  const hasStatus = chunks.some((c) => c.sectionPath.endsWith('2.2 账号状态'))
  console.log(`${hasRule ? 'PASS' : 'MISS'}  2.1 账号规则 独立成条（不应被并进父节点）`)
  console.log(`${hasStatus ? 'PASS' : 'MISS'}  2.2 账号状态 独立成条`)
}

const ev = runEvidenceChecks()
runNormalizeChecks()
runChunkChecks()

console.log('\n' + '═'.repeat(96))
console.log(`证据校验通过率：${ev.pass}/${ev.total}`)
process.exit(ev.pass === ev.total ? 0 : 1)
