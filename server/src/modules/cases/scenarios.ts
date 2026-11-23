import { tailPath } from '../../docs/diff.js'
import {
  LlmScenarioResultSchema,
  blankAssessment,
  type Chunk,
  type ScenarioFill,
  type TestCase,
  type TestPoint,
} from '../../store/schema.js'
import { genId, nowIso, type Category } from '../../utils.js'
import { verifyEvidenceList } from '../../validate/evidence.js'

export type ScenarioKind =
  | 'main-flow' | 'state-transition' | 'reject-path'
  | 'at-lower' | 'below-lower' | 'at-upper' | 'above-upper'
  | 'count-before' | 'count-at' | 'count-after' | 'boundary-clarify'
  | 'authorized' | 'denied' | 'unauthenticated'

export interface ScenarioConstraint {
  lower?: number
  upper?: number
  count?: number
  unit: string
  expectedValue: number
}

export interface Scenario {
  /** 确定性 id：测试点不变则场景骨架不变 */
  id: string
  pointId: string
  category: Category
  kind: ScenarioKind
  label: string
  intent: string
  constraint?: ScenarioConstraint
}

const FLOW_KINDS = new Set<ScenarioKind>(['main-flow', 'state-transition', 'reject-path'])
const REJECT_KINDS = new Set<ScenarioKind>(['reject-path', 'below-lower', 'above-upper', 'count-after', 'denied', 'unauthenticated'])
const P0_KINDS = new Set<ScenarioKind>(['main-flow', 'at-lower', 'at-upper', 'count-at', 'authorized'])

const UNITS = '(位|个|字符|字|条|件|元|分钟|小时|天|秒|人|项)'

interface ExtractedConstraint { lower?: number; upper?: number; count?: number; unit: string }

/**
 * 只从人工确认过的原文引用里提取数值约束，不从模型写的 objective 里取，
 * 避免把模型转述的数字当成原文边界。范围必须带单位，防止把日期误判成区间。
 */
export function extractConstraint(text: string): ExtractedConstraint | null {
  const range = new RegExp(`(\\d+)\\s*[-~～—–到至]\\s*(\\d+)\\s*${UNITS}`).exec(text)
  if (range && Number(range[1]) <= Number(range[2])) {
    return { lower: Number(range[1]), upper: Number(range[2]), unit: range[3] }
  }
  const upper = new RegExp(`(?:<=|≤|不超过|不得超过|最多|上限(?:为|是)?|不大于)\\s*(\\d+)\\s*${UNITS}?`).exec(text)
    ?? new RegExp(`(\\d+)\\s*${UNITS}(?:以内|以下|之内)`).exec(text)
  const lower = new RegExp(`(?:>=|≥|不少于|至少|下限(?:为|是)?|不小于|不得低于)\\s*(\\d+)\\s*${UNITS}?`).exec(text)
  if (upper || lower) {
    return { lower: lower ? Number(lower[1]) : undefined, upper: upper ? Number(upper[1]) : undefined, unit: upper?.[2] || lower?.[2] || '' }
  }
  const count = /(?:连续|累计)[^，。；\n]{0,10}?(\d+)\s*次/.exec(text) ?? /(\d+)\s*次(?:锁定|上限|限制|以内|后)/.exec(text)
  if (count) return { count: Number(count[1]), unit: '次' }
  return null
}

/** 规则矩阵：一个确认点 → 固定的场景骨架集合，不经过模型 */
export function expandScenarios(point: TestPoint): Scenario[] {
  const mk = (kind: ScenarioKind, label: string, intent: string, constraint?: ScenarioConstraint): Scenario =>
    ({ id: `${point.id}:${kind}`, pointId: point.id, category: point.category, kind, label, intent, constraint })

  switch (point.category) {
    case 'normal': {
      const out = [mk('main-flow', '主流程', `按需求规定的正常条件完成「${point.objective}」的完整业务链路`)]
      if ((point.methods ?? []).some((method) => /状态迁移|状态机/.test(method))) {
        out.push(mk('state-transition', '状态流转', '验证需求写明的状态之间按规则正常切换'))
      }
      return out
    }
    case 'abnormal':
      return [mk('reject-path', '业务拒绝', `构造违反「${point.objective}」所述规则的输入或状态，验证被拒绝`)]
    case 'boundary': {
      const extracted = extractConstraint(point.evidence.map((e) => e.quote).join('\n'))
      if (!extracted) return [mk('boundary-clarify', '边界待澄清', '原文未给出明确临界值，只提出待确认问题，不给确定结论')]
      const out: Scenario[] = []
      const withValue = (expectedValue: number): ScenarioConstraint => ({ ...extracted, expectedValue })
      const { lower, upper, count, unit } = extracted
      if (lower !== undefined) {
        out.push(mk('at-lower', `下界 ${lower}${unit}`, `取值恰为下界 ${lower}${unit}，验证需求规定的允许行为`, withValue(lower)))
        if (lower - 1 >= 0) out.push(mk('below-lower', `下界-1（${lower - 1}${unit}）`, `取值低于下界（${lower - 1}${unit}），验证需求规定的拒绝行为`, withValue(lower - 1)))
      }
      if (upper !== undefined) {
        out.push(mk('at-upper', `上界 ${upper}${unit}`, `取值恰为上界 ${upper}${unit}，验证需求规定的允许行为`, withValue(upper)))
        out.push(mk('above-upper', `上界+1（${upper + 1}${unit}）`, `取值超出上界（${upper + 1}${unit}），验证需求规定的拒绝行为`, withValue(upper + 1)))
      }
      if (count !== undefined) {
        if (count - 1 >= 1) out.push(mk('count-before', `第 ${count - 1} 次`, `第 ${count - 1} 次操作仍在限制内，验证需求规定的允许行为`, withValue(count - 1)))
        out.push(mk('count-at', `第 ${count} 次`, `第 ${count} 次操作到达限制临界，验证需求规定的临界行为`, withValue(count)))
        out.push(mk('count-after', `第 ${count + 1} 次`, `第 ${count + 1} 次操作超出限制，验证需求规定的拒绝行为`, withValue(count + 1)))
      }
      return out.slice(0, 8)
    }
    case 'permission': {
      // 按测试点目标意图派生场景，避免给「只验证有权」的点生成越权案、给「只验证被限制」的点生成有权案
      const deny = /越权|限制|拒绝|禁止|不能|不得|无权|非本人/.test(point.objective)
      const allow = /成功|允许|有权|可查询|可以|正常/.test(point.objective)
      const both = (deny && allow) || (!deny && !allow)
      const out: Scenario[] = []
      if (both || allow) out.push(mk('authorized', '有权访问', `按「${point.objective}」构造被允许的角色或数据范围操作，验证被允许`))
      if (both || deny) out.push(mk('denied', '越权拒绝', `按「${point.objective}」构造被禁止的角色或他人数据操作，验证被拒绝`))
      if (/未登录|登录态|token|令牌/i.test(point.objective + point.evidence.map((e) => e.quote).join('\n'))) {
        out.push(mk('unauthenticated', '未登录访问', '未登录或登录态失效时访问，验证需求规定的拦截行为'))
      }
      return out
    }
  }
}

/** 槽位校验：场景集合、给定取值、可判定预期、提示文案逐字来自原文，全部确定性检查 */
export function batchFillSchema(scenarios: Scenario[], chunks: Chunk[]) {
  return LlmScenarioResultSchema.superRefine((result, ctx) => {
    const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]))
    const seen = new Set<string>()
    result.scenarios.forEach((fill, index) => {
      const scenario = byId.get(fill.scenarioId)
      if (!scenario) {
        ctx.addIssue({ code: 'custom', path: ['scenarios', index, 'scenarioId'], message: `收到骨架外场景 ${fill.scenarioId}；只能填充给定场景，不得增删` })
        return
      }
      if (seen.has(fill.scenarioId)) {
        ctx.addIssue({ code: 'custom', path: ['scenarios', index, 'scenarioId'], message: `场景 ${fill.scenarioId} 重复；每个骨架只能填充一次` })
      }
      seen.add(fill.scenarioId)
      if (FLOW_KINDS.has(scenario.kind) && !fill.steps?.length) {
        ctx.addIssue({ code: 'custom', path: ['scenarios', index, 'steps'], message: `流程类场景 ${scenario.id} 必须给出按顺序执行的 steps` })
      }
      if (scenario.constraint) {
        const value = String(scenario.constraint.expectedValue)
        if (!new RegExp(`(?<!\\d)${value}(?!\\d)`).test(fill.input)) {
          ctx.addIssue({ code: 'custom', path: ['scenarios', index, 'input'], message: `场景 ${scenario.id} 的 input 必须包含骨架给定取值 ${value}，不得改用其他数值` })
        }
      }
      if (scenario.kind !== 'boundary-clarify' && /(显示正常|符合预期|体验良好|无异常|相应错误|或相应)/.test(fill.expected)) {
        ctx.addIssue({ code: 'custom', path: ['scenarios', index, 'expected'], message: `场景 ${scenario.id} 的 expected 必须可判定，禁止含糊兜底表述` })
      }
      if (fill.message && !chunks.some((chunk) => chunk.text.includes(fill.message))) {
        ctx.addIssue({ code: 'custom', path: ['scenarios', index, 'message'], message: `场景 ${scenario.id} 的 message 必须逐字来自条款原文；原文没有就留空` })
      }
    })
    for (const scenario of scenarios) {
      if (!seen.has(scenario.id)) ctx.addIssue({ code: 'custom', message: `遗漏场景 ${scenario.id}（${scenario.label}），每个骨架必须填充` })
    }
  })
}

/**
 * 渲染证据：测试点窄引用之外，确定性补入「被预期引用的拒绝/提示原句」。
 * 补入内容逐字来自条款、可被原文定位校验，避免窄引用（如只引阈值）把本可判定的预期误报为依据不足。
 */
function renderEvidence(scenario: Scenario, fill: ScenarioFill, point: TestPoint, chunks: Chunk[]): { reqId: string; quote: string }[] {
  const base = point.evidence.map(({ reqId, quote }) => ({ reqId, quote }))
  const reqIds = new Set(base.map((e) => e.reqId))
  const expectedText = `${fill.expected} ${fill.message ?? ''}`
  const wantPrompt = /提示/.test(expectedText)
  const wantReject = REJECT_KINDS.has(scenario.kind)
  const extra: { reqId: string; quote: string }[] = []
  const seen = (reqId: string, quote: string) =>
    base.some((e) => e.reqId === reqId && e.quote === quote) || extra.some((e) => e.reqId === reqId && e.quote === quote)
  for (const chunk of chunks) {
    if (!reqIds.has(chunk.reqId)) continue
    for (const raw of chunk.text.split(/(?<=[。！？；\n])/)) {
      const sentence = raw.trim()
      if (!sentence) continue
      const hit = (fill.message && sentence.includes(fill.message))
        || (wantPrompt && /提示/.test(sentence))
        || (wantReject && /拒绝|不予受理|驳回/.test(sentence))
      if (hit && !seen(chunk.reqId, sentence)) extra.push({ reqId: chunk.reqId, quote: sentence })
    }
  }
  return [...base, ...extra]
}

/** 模板渲染：步骤与预期的结构由骨架决定，模型只提供槽位数据 */
export function renderScenarioCase(
  scenario: Scenario,
  fill: ScenarioFill,
  point: TestPoint,
  ctx: { projectId: string; requirementId: string; chunks: Chunk[]; titleSuffix?: string },
): TestCase {
  const flow = FLOW_KINDS.has(scenario.kind)
  const clarify = scenario.kind === 'boundary-clarify'
  const steps = flow ? fill.steps! : [`构造${fill.subject}：${fill.input}`, fill.action]
  const expected = clarify
    ? ['需求未明确，待业务确认实际处理结果']
    : [fill.expected, ...(fill.message ? [`提示/返回：${fill.message}`] : [])]
  const assumptions = [...fill.assumptions]
  if (clarify) assumptions.push(`「${point.title}」缺少明确临界值，待业务确认后补充边界用例`)
  else if (!fill.message && REJECT_KINDS.has(scenario.kind)) assumptions.push('需求未明确该场景的具体提示内容，待业务确认')
  const evidence = verifyEvidenceList(ctx.chunks, renderEvidence(scenario, fill, point, ctx.chunks))
  const module = tailPath(ctx.chunks.find((chunk) => chunk.reqId === point.evidence[0]?.reqId)?.sectionPath ?? '')
  return {
    id: genId('case'),
    projectId: ctx.projectId,
    requirementId: ctx.requirementId,
    title: ctx.titleSuffix ? `${point.title}（${ctx.titleSuffix}）` : point.title,
    category: point.category,
    priority: clarify ? 'P2' : P0_KINDS.has(scenario.kind) ? 'P0' : 'P1',
    module,
    precondition: fill.precondition || '无',
    steps,
    expected,
    evidence,
    assumptions,
    businessConfirmation: '',
    businessConfirmer: '',
    assessment: blankAssessment(),
    origin: 'generated',
    updatedAt: nowIso(),
  }
}