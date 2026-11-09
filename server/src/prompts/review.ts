import type { ChatMessage } from '../llm/client.js'
import type { CoverageRow } from '../review/coverage.js'
import type { DupCandidate } from '../review/dedupe.js'
import type { TestCase } from '../store/schema.js'
import { SYSTEM_PROMPT } from './system.js'

export function buildReviewMessages(params: {
  coverage: CoverageRow[]
  cases: TestCase[]
  dupCandidates: DupCandidate[]
}): ChatMessage[] {
  const { coverage, cases, dupCandidates } = params

  const coverageText = coverage
    .map(
      (r) =>
        `[${r.reqId}] ${r.sectionPath}（被 ${r.caseIds.length} 条用例引用${r.testable ? '' : '，该条款无需用例'}）`,
    )
    .join('\n')

  const casesText = cases
    .slice(0, 120)
    .map(
      (c) =>
        `- ${c.id} | [${c.category}] ${c.title} | 引用 ${c.evidence.map((e) => e.reqId).join(',') || '无'}`,
    )
    .join('\n')

  const dupText = dupCandidates.length
    ? dupCandidates
        .map((d) => `- ${d.caseIds[0]} 与 ${d.caseIds[1]}：${d.reason}`)
        .join('\n')
    : '（无）'

  const uncovered = coverage.filter((r) => r.testable && !r.caseIds.length)
  const gapText = uncovered.length
    ? uncovered.map((r) => `- ${r.reqId} ${r.sectionPath}`).join('\n')
    : '（无）'

  const skipText = coverage
    .filter((r) => !r.testable)
    .map((r) => `${r.reqId} ${r.sectionPath}`)
    .join('、')

  const user = [
    '【需求条款与覆盖情况】',
    coverageText,
    ...(skipText ? ['', `标了「该条款无需用例」的条款（${skipText}）不计入覆盖率，也不要建议为它们补用例。`] : []),
    '',
    '【已有用例】',
    casesText || '（无）',
    '',
    '【系统预筛出的疑似重复对】',
    dupText,
    '',
    '【系统预筛出的未被任何用例覆盖的条款】',
    gapText,
    '',
    '【任务】',
    '1. duplicates：从预筛结果里确认哪些确实是重复（验证点相同或同义重复）。不确定的不要列入。caseIds 必须是上面给出的真实 id。',
    '   判定重复要求「验证点相同」：同一功能的同一检查点、只是措辞不同。',
    '   以下情况不算重复，不要列入：同一参数的相邻边界取值（如「20 位被接受」与「21 位被拒绝」、「第 4 次未锁定」与「第 5 次锁定」）；',
    '   不同角色的同一操作（如「管理员导出」与「超级管理员导出」）；正例与反例（成功与失败）；预期结果不同的用例。',
    '2. gaps：判断未被覆盖的条款里，哪些是真的需要补测试用例。背景说明、术语定义、范围声明、纯性能指标这类不需要用例，不要列为 gap。',
    '3. scores：给三项各打 1-5 分（整数）—— completeness 场景完整性（四类场景是否齐全）、executability 步骤可执行性、verifiability 预期结果可判定性。',
    '4. advice：给出 3-6 条具体的改进建议，要能直接指导修改，且只能针对上面列出的真实条款和用例。不要建议为接口定义章节补功能用例，也不要泛泛地提安全测试、性能测试、兼容性测试这类与本需求无关的方向。',
    '',
    '严格基于上面给出的内容判断，不要臆造需求里没有的规则。',
    '',
    '【输出 JSON 结构】',
    `{
  "duplicates": [ { "caseIds": ["case_xxx", "case_yyy"], "reason": "" } ],
  "gaps": [ { "reqId": "REQ-00X", "reason": "", "severity": "high|medium|low" } ],
  "scores": { "completeness": 1, "executability": 1, "verifiability": 1 },
  "advice": [""]
}`,
    '只输出这个 JSON，不要任何解释文字。',
  ].join('\n')

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ]
}
