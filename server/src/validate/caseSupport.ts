import { z } from 'zod'
import { chatJson } from '../llm/json.js'
import type { Chunk, Evidence, TestCase } from '../store/schema.js'
import { overallState, verifyEvidenceList } from './evidence.js'

const Support = z.enum(['explicit', 'inferred', 'unknown'])
const Result = z.object({ items: z.array(z.object({
  caseIndex: z.number().int(), evidenceIndex: z.number().int(),
  condition: Support, expected: Support, reason: z.string(), gap: z.string().optional(),
  target: Support.optional(),
})) })

function missingRule(c: TestCase, text: string): string | undefined {
  const claim = `${c.title} ${c.precondition} ${c.steps.join(' ')} ${c.expected.join(' ')}`
  if (/订单编号.{0,15}(长度|最大值|最小值|为空|不能为空)|(?:长度|最大值|最小值).{0,15}订单编号/.test(claim) && !/订单编号.{0,20}(长度|位数|字符数|不能为空)|(?:长度|位数|字符数).{0,20}订单编号/.test(text)) {
    return '需求未明确订单编号长度限制，待业务确认'
  }
  if (/pageSize.{0,15}(最大|最小|上限|下限|范围)|(?:最大|最小|上限|下限).{0,15}pageSize/i.test(claim) && !/pageSize.{0,20}(最大|最小|上限|下限|范围|可选)|每页.{0,15}(最多|最少|可选)/i.test(text)) {
    return '需求未明确 pageSize 取值范围，待业务确认'
  }
  if (/订单金额.{0,12}(最大|最小|上限|下限|为0|为 0|零)|(?:最大|最小|上限|下限).{0,12}订单金额/.test(claim) && !/订单金额.{0,20}(限制|最大|最小|上限|下限|不得|必须|范围)/.test(text)) {
    return '需求未明确订单金额限制，待业务确认'
  }
  return undefined
}

function gapKey(text: string): string {
  if (/订单编号/.test(text) && /(长度|最大值|最小值)/.test(text)) return 'order-id-length'
  if (/pagesize/i.test(text)) return 'page-size-range'
  if (/订单金额/.test(text)) return 'order-amount-range'
  return text.replace(/[\s，。；、]/g, '').toLowerCase()
}

/** 引用定位只是第一关；模型必须分别核对测试条件和预期结论。 */
export async function assessCaseBatch(cases: TestCase[], chunks: Chunk[], sanitizeUnknownExpected = false): Promise<TestCase[]> {
  if (!cases.length) return cases
  const byId = new Map(chunks.map((chunk) => [chunk.reqId, chunk]))
  const prepared = cases.map((c) => ({
    ...c,
    evidence: verifyEvidenceList(chunks, c.evidence.map(({ reqId, quote }) => ({ reqId, quote }))),
  }))
  if (prepared.every((c) => !c.evidence.length)) return prepared.map((c) => ({
    ...c,
    expected: sanitizeUnknownExpected ? ['需求未明确，待业务确认实际处理结果'] : c.expected,
    assumptions: [...new Set([...c.assumptions, '需求依据未提供，待业务确认'])],
  }))
  const payload = prepared.map((c, caseIndex) => ({
    caseIndex, title: c.title, precondition: c.precondition, steps: c.steps, expected: c.expected,
    confirmedTestPoint: c.source ? { title: c.source.title, objective: c.source.objective } : undefined,
    evidence: c.evidence.map((e, evidenceIndex) => ({
      evidenceIndex, reqId: e.reqId, quote: e.quote,
      original: byId.get(e.reqId)?.text ?? '',
    })),
  }))
  const result = await chatJson(Result, [
    { role: 'system', content: `你是严格的需求依据审查员。逐条判断引用条款是否支持测试条件和预期结果。只输出 JSON。\nexplicit=原文明确支持；inferred=可合理推导但需要人工确认；unknown=原文没有规则。\n只出现相同业务名词不算支持。必须核对核心测试目标、具体边界条件、拒绝/成功结论。某引用只支持步骤而不支持预期时，expected=unknown。缺少最大值、最小值、长度、次数、时间限制时不能把自造边界或拒绝结论判为 explicit。99 件上限可以推导 100 件超限，但不得推导订单编号长度或金额限制。每个 evidence 都返回一项；gap 写需业务确认的问题。` },
    { role: 'user', content: `审查以下用例与所引用的条款。若有 confirmedTestPoint，必须另外核对用例目标是否与该已确认测试点一致，target=explicit 表示目标一致，inferred 表示需要人工核对，unknown 表示偏离或无法判断。返回 {"items":[{"caseIndex":0,"evidenceIndex":0,"condition":"explicit|inferred|unknown","expected":"explicit|inferred|unknown","target":"explicit|inferred|unknown","reason":"具体理由","gap":"需求未明确...，待业务确认"}]}：\n${JSON.stringify(payload)}` },
  ], { label: '用例依据语义审查', maxTokens: 3000 })
  const assessments = new Map(result.items.map((item) => [`${item.caseIndex}:${item.evidenceIndex}`, item]))

  return prepared.map((c, caseIndex) => {
    const assumptions = new Set(c.origin === 'manual' || c.source ? c.assumptions : [])
    const detectedGaps = new Set<string>()
    const unsupportedPrompt = c.expected.some((s) => /提示/.test(s))
      && !c.evidence.some((e) => /提示/.test(e.quote))
    let missingBusinessRule = false
    const evidence: Evidence[] = c.evidence.map((e, evidenceIndex) => {
      const item = assessments.get(`${caseIndex}:${evidenceIndex}`)
      const guard = missingRule(c, byId.get(e.reqId)?.text ?? '')
      if (guard) missingBusinessRule = true
      const offTarget = Boolean(c.source && item?.target !== 'explicit')
      const conditionSupport = guard || offTarget ? 'unknown' : item?.condition ?? 'unknown'
      const expectedSupport = guard || unsupportedPrompt || offTarget ? 'unknown' : item?.expected ?? 'unknown'
      if (offTarget) detectedGaps.add('用例目标与已确认测试点的一致性未通过复核，需人工核对')
      if (guard) detectedGaps.add(guard)
      if (item?.gap && !guard && !unsupportedPrompt) detectedGaps.add(item.gap)
      if (unsupportedPrompt) detectedGaps.add('需求未明确该场景的具体提示内容，待业务确认')
      const state = e.quoteMatch === 'missing' || guard || unsupportedPrompt || !item
        ? 'unknown'
        : conditionSupport === 'explicit' && expectedSupport === 'explicit' && e.quoteMatch === 'exact'
          ? 'explicit'
          : conditionSupport === 'unknown' || expectedSupport === 'unknown' ? 'unknown' : 'inferred'
      return {
        ...e, state, conditionSupport, expectedSupport,
        reason: guard ?? (offTarget ? `测试点一致性待核对：${item?.reason ?? '模型未返回目标检查结果'}` : unsupportedPrompt ? '引用未规定该场景的具体提示内容' : e.quoteMatch === 'missing' ? e.reason : item?.reason ?? '语义审查未返回结果'),
      }
    })
    const state = overallState(evidence)
    if (state !== 'explicit') {
      const seen = new Set([...assumptions].map(gapKey))
      for (const gap of [...detectedGaps, ...(sanitizeUnknownExpected ? c.assumptions : [])]) {
        const key = gapKey(gap)
        if (seen.has(key)) continue
        assumptions.add(gap)
        seen.add(key)
      }
    }
    if (!evidence.length) assumptions.add('需求依据未提供，待业务确认')
    const expected = sanitizeUnknownExpected && state === 'unknown'
      ? unsupportedPrompt && !missingBusinessRule
        ? c.expected.map((s) => /提示/.test(s) ? '具体提示需求未明确，待业务确认' : s)
        : ['需求未明确，待业务确认实际处理结果']
      : c.expected
    return { ...c, evidence, expected, assumptions: [...assumptions] }
  })
}

export async function assessCases(cases: TestCase[], chunks: Chunk[], sanitizeUnknownExpected = false): Promise<TestCase[]> {
  const checked: TestCase[] = []
  for (let i = 0; i < cases.length; i += 3) checked.push(...await assessCaseBatch(cases.slice(i, i + 3), chunks, sanitizeUnknownExpected))
  return checked
}
