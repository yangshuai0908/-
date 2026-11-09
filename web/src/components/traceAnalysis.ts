export interface TracePoint {
  title: string
  category: string
  objective: string
  evidence: { reqId: string; quote: string; matched?: boolean }[]
  questions: string[]
  status?: string
}

export interface TraceSection {
  reqId: string
  points: TracePoint[]
  questions: string[]
  notTestableReason?: string
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function decode(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

/** 仅识别已有分析结果，不修复原始返回，也不丢弃不认识的条款。 */
export function traceSections(value: unknown): TraceSection[] | null {
  let result = decode(value)
  if (!object(result)) return null
  if ('content' in result && !('sections' in result)) result = decode(result.content)
  if (!object(result)) return null
  if ('analysis' in result && !('sections' in result)) result = result.analysis
  if (!object(result) || !Array.isArray(result.sections)) return null
  for (const section of result.sections) {
    if (!object(section) || typeof section.reqId !== 'string' || !Array.isArray(section.points)
      || !strings(section.questions) || (section.notTestableReason !== undefined && typeof section.notTestableReason !== 'string')) return null
    for (const point of section.points) {
      if (!object(point) || typeof point.title !== 'string' || typeof point.category !== 'string'
        || typeof point.objective !== 'string' || !strings(point.questions) || !Array.isArray(point.evidence)
        || (point.status !== undefined && typeof point.status !== 'string')) return null
      if (!point.evidence.every(e => object(e) && typeof e.reqId === 'string' && typeof e.quote === 'string'
        && (e.matched === undefined || typeof e.matched === 'boolean'))) return null
    }
  }
  return result.sections as unknown as TraceSection[]
}

export function traceSectionTitles(input: unknown): Record<string, string> {
  if (!object(input) || !object(input.requirement) || !Array.isArray(input.requirement.chunks)) return {}
  return Object.fromEntries(input.requirement.chunks.filter(chunk => object(chunk)
    && typeof chunk.reqId === 'string' && typeof chunk.sectionPath === 'string').map(chunk => [chunk.reqId, chunk.sectionPath]))
}
