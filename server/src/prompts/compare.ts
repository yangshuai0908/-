import type { ChatMessage } from '../llm/client.js'
import type { ChangeItem, TestCase } from '../store/schema.js'
import { SYSTEM_PROMPT } from './system.js'

const CHANGE_LABEL: Record<ChangeItem['type'], string> = {
  added: '新增',
  removed: '删除',
  modified: '修改',
  unchanged: '未变',
}

function formatChanges(changes: ChangeItem[]): string {
  const relevant = changes.filter((c) => c.type !== 'unchanged')
  return relevant
    .map((c, i) => {
      const lines = [`${i + 1}. [${CHANGE_LABEL[c.type]}] ${c.sectionPath}（${c.toReqId ?? c.fromReqId}）`]
      if (c.before) lines.push(`   改前：${c.before.slice(0, 500)}`)
      if (c.after) lines.push(`   改后：${c.after.slice(0, 500)}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

function formatCases(cases: TestCase[]): string {
  return cases
    .map(
      (c) =>
        `- ${c.id} | [${c.category}] ${c.title}\n` +
        `  依据：${c.evidence.map((e) => e.reqId).join(', ') || '无'}\n` +
        `  步骤：${c.steps.join(' → ').slice(0, 200)}\n` +
        `  预期：${c.expected.join('；').slice(0, 200)}`,
    )
    .join('\n')
}

export function buildCompareMessages(params: {
  changes: ChangeItem[]
  impactedCases: TestCase[]
  removedCaseIds: string[]
}): ChatMessage[] {
  const { changes, impactedCases, removedCaseIds } = params

  const user = [
    '【需求变更清单】',
    formatChanges(changes),
    '',
    '【受这些变更影响的已有用例】',
    impactedCases.length ? formatCases(impactedCases) : '（无）',
    removedCaseIds.length ? `\n【引用了被删除条款的用例】\n${removedCaseIds.join(', ')}` : '',
    '',
    '【任务】针对上面的变更，判断已有用例该怎么处理：',
    '1. newCases：针对新增条款、或修改后出现的新规则，需要新增的用例（格式与生成用例一致，evidence 必须引用改后条款的 reqId 和改后原文）',
    '2. adjustedCases：已有用例需要调整的，caseId 用上面给出的 id，写清 reason（为什么改）、change（改什么），patch 里给出修改后的字段',
    '3. deprecatedCases：因为条款被删除而不再成立的用例，写清 reason',
    '4. notes：其他需要提醒测试同学注意的点',
    '',
    '严格约束：只依据上面的变更内容判断，不要引入需求里没有的新规则。调整建议里出现的数值和字段必须来自改后的条款原文。',
    '',
    '【输出 JSON 结构】',
    `{
  "newCases": [ { "title": "", "category": "normal|abnormal|boundary|permission", "priority": "P0|P1|P2", "module": "", "precondition": "", "steps": [""], "expected": [""], "evidence": [{ "reqId": "REQ-00X", "quote": "改后条款的原文片段" }], "assumptions": [] } ],
  "adjustedCases": [ { "caseId": "case_xxx", "caseTitle": "", "reason": "", "change": "", "patch": { "title": "", "precondition": "", "steps": [""], "expected": [""] } } ],
  "deprecatedCases": [ { "caseId": "case_xxx", "caseTitle": "", "reason": "" } ],
  "notes": [""]
}`,
    '只输出这个 JSON，不要任何解释文字。',
  ]
    .filter((s) => s !== undefined)
    .join('\n')

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ]
}

export const COMPARE_RESULT_SCHEMA_HINT = `{
  "newCases": [],
  "adjustedCases": [],
  "deprecatedCases": [],
  "notes": []
}`
