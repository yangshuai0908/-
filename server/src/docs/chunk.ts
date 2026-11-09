import type { Chunk } from '../store/schema.js'

/** 单块目标上限（字）。超过就按段落聚合二次切分 */
const MAX_CHARS = 1200
/** 单块硬上限，单段超长时按句子/字符硬切 */
const HARD_MAX = 1800
/** 小于这个长度的块尝试与同路径相邻块合并 */
const MIN_CHARS = 80
/** 顶层且短于这个长度的块视为文档元信息（版本号、状态等），直接丢弃 */
const META_MAX_CHARS = 25

interface Section {
  level: number
  title: string
  path: string
  body: string[]
}

/** 识别标题行；代码块内的 # 注释不算标题（调用方负责 fence 状态） */
function detectHeading(line: string): { level: number; title: string } | null {
  const t = line.trim()
  if (!t) return null

  const md = /^(#{1,6})\s+(.+)$/.exec(t)
  if (md) return { level: md[1].length, title: md[2].trim() }

  // 数字编号：3 / 3.1 / 3.1.2（限制长度和结尾标点，避免把正文里 "1. 点击按钮" 误判成标题）
  const num = /^(\d+(?:\.\d+)*)[.、)）]?\s+\S/.exec(t)
  if (num) {
    const depth = num[1].split('.').length
    if (depth <= 4 && t.length <= 50 && !/[。；;，,]$/.test(t)) {
      return { level: depth + 1, title: t }
    }
  }

  // 中文序号：一、 二、
  const cn = /^[一二三四五六七八九十]+[、.]\s*\S/.exec(t)
  if (cn && t.length <= 40 && !/[。；;，,]$/.test(t)) {
    return { level: 2, title: t }
  }

  return null
}

/** 按标题层级把正文切成 section 序列（父标题自身的内容也是一段独立 section） */
export function splitIntoSections(rawText: string): Section[] {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n')
  const out: Section[] = []
  const stack: { level: number; title: string }[] = []
  let cur: Section | null = null
  let inFence = false

  const flush = () => {
    if (cur) {
      out.push(cur)
      cur = null
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // 代码块切换（``` 或 ~~~），块内不做标题识别
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence
      if (!cur) cur = { level: 0, title: '文档内容', path: '文档内容', body: [] }
      cur.body.push(line)
      continue
    }

    if (!inFence) {
      const h = detectHeading(line)
      if (h) {
        flush()
        while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
        stack.push({ level: h.level, title: h.title })
        cur = {
          level: h.level,
          title: h.title,
          path: stack.map((s) => s.title).join(' / '),
          body: [],
        }
        continue
      }
    }

    if (!cur) cur = { level: 0, title: '文档内容', path: '文档内容', body: [] }
    cur.body.push(line)
  }

  flush()
  return out
}

/** 按空行分段后聚合到 max 字以内；单段超长再按句子/字符硬切 */
function packParagraphs(text: string, max: number): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  const packed: string[] = []
  let buf = ''
  for (const p of paras) {
    if (!buf) {
      buf = p
      continue
    }
    if (buf.length + 2 + p.length <= max) {
      buf += '\n\n' + p
      continue
    }
    packed.push(buf)
    buf = p
  }
  if (buf) packed.push(buf)

  const out: string[] = []
  for (const block of packed) {
    if (block.length <= HARD_MAX) {
      out.push(block)
      continue
    }
    // 先按中文句末切，仍超长再按字符切
    const sentences = block.split(/(?<=[。！？；\n])/).filter((s) => s.trim())
    let b = ''
    for (const s of sentences) {
      if (b.length + s.length > max && b) {
        out.push(b.trim())
        b = ''
      }
      b += s
      while (b.length > HARD_MAX) {
        out.push(b.slice(0, HARD_MAX).trim())
        b = b.slice(HARD_MAX)
      }
    }
    if (b.trim()) out.push(b.trim())
  }
  return out.filter(Boolean)
}

/**
 * 需求文档 → 带 REQ 编号的条款块
 * - 按标题层级切 section，每个 section 是一条条款
 * - 只有标题没有正文的 section 直接跳过（它只是结构标签，不是需求内容）
 * - 超长 section 按段落二次切分
 * - 同路径的过短 section 与相邻块合并（不同路径绝不合并，避免把独立条款并进父节点）
 */
export function chunkRequirement(rawText: string): Chunk[] {
  const sections = splitIntoSections(rawText)

  const blocks: { path: string; text: string }[] = []
  for (const sec of sections) {
    const bodyText = sec.body.join('\n').trim()
    if (!bodyText) continue
    for (const part of packParagraphs(bodyText, MAX_CHARS)) {
      blocks.push({ path: sec.path, text: part })
    }
  }

  // 合并同路径的过短块
  const merged: { path: string; text: string }[] = []
  for (const b of blocks) {
    const last = merged[merged.length - 1]
    if (
      last &&
      last.path === b.path &&
      last.text.length < MIN_CHARS &&
      last.text.length + 2 + b.text.length <= MAX_CHARS
    ) {
      last.text += '\n\n' + b.text
      continue
    }
    merged.push({ ...b })
  }

  // 丢掉文档头部的元信息块（版本号、状态、修订记录这类顶层短文本）
  const filtered = merged.filter(
    (b) => !(b.text.length < META_MAX_CHARS && !b.path.includes(' / ')),
  )

  const final = filtered.length ? filtered : merged.length ? merged : [{ path: '文档内容', text: rawText.trim() }]

  return final.map((b, i) => ({
    reqId: `REQ-${String(i + 1).padStart(3, '0')}`,
    sectionPath: b.path,
    text: b.text,
    order: i,
  }))
}

/** 从需求里提取 HTTP 接口定义，作为生成时的附加输入 */
export function extractApis(rawText: string): string[] {
  const found = new Set<string>()
  const re = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9/_{}:.\-]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(rawText))) {
    found.add(`${m[1]} ${m[2]}`)
  }
  return [...found]
}
