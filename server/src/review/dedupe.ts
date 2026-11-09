import type { TestCase } from '../store/schema.js'
import { normalize } from '../validate/evidence.js'

export interface DupCandidate {
  caseIds: string[]
  title: string
  reason: string
  score: number
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const g of a) if (b.has(g)) inter++
  return inter / (a.size + b.size - inter)
}

function titleKey(c: TestCase): string {
  return normalize(c.title).replace(/-/g, '')
    .replace(/^订单管理/, '')
    .replace(/^(查询|权限|正常|异常|边界)/, '')
    .replace(/(查询|查看|访问|获取)/g, '查看')
    .replace(/(只能查看|可查看|能够查看)/g, '查看')
    .replace(/(自己的|自己|自身|本人)/g, '自己')
    .replace(/(订单信息|订单详情)/g, '订单')
    .replace(/(被允许|成功)$/, '')
}

function outcomeClass(c: TestCase): string {
  const s = normalize(c.expected.join(' '))
  if (/(拒绝|失败|不允许|不能)/.test(s)) return 'reject'
  if (/(成功|显示|查看|返回|允许|更新)/.test(s)) return 'allow'
  return s
}

function stepsKey(c: TestCase): Set<string> {
  return bigrams(normalize(c.steps.join('')))
}

function expectedKey(c: TestCase): Set<string> {
  return bigrams(normalize(c.expected.join('')).replace(/(成功|正常|允许)/g, '成功').replace(/(拒绝|失败|不允许)/g, '拒绝'))
}

/** 抽出文本里所有数值 token */
function numeralsOf(s: string): Set<string> {
  return new Set(s.match(/\d+(?:\.\d+)?/g) ?? [])
}

/**
 * 权限角色词表（按长度降序匹配，避免「管理员」把「超级管理员」吃掉）。
 * 两条用例只是角色不同 → 验证点不同，不算重复。
 * 提示词里也写了这条，但模型经常照判，所以预筛阶段先拦掉。
 */
const ROLE_WORDS = ['超级管理员', '管理员', '客服', '普通用户', '未登录用户', '访客']

function rolesOf(title: string): Set<string> {
  let t = normalize(title)
  const found = new Set<string>()
  for (const role of ROLE_WORDS) {
    const key = normalize(role)
    if (t.includes(key)) {
      found.add(role)
      t = t.split(key).join('#')
    }
  }
  return found
}

/** 「按账号筛选」与「按手机号筛选」是不同用例，把筛选维度抠出来比 */
function filterFieldOf(title: string): string | null {
  return /按(.+?)(筛选|查询|搜索|排序|过滤)/.exec(normalize(title))?.[1] ?? null
}

/**
 * 两条用例的数值集合是否不同。
 * 边界用例天生是一对：标题只差一个数字（20 位被接受 / 21 位被拒绝），
 * 步骤和预期又是同一套模板，字符相似度必然很高，光看相似度会把每一对边界都判成重复。
 * 只要标题或预期里的数值不一样，就说明验证点不同，直接排除。
 */
function numeralsDiffer(a: TestCase, b: TestCase): boolean {
  const pick = (c: TestCase) => numeralsOf(normalize(`${c.title} ${c.expected.join(' ')}`))
  const A = pick(a)
  const B = pick(b)
  if (A.size !== B.size) return true
  for (const n of A) if (!B.has(n)) return true
  return false
}

/** 角色不同、筛选维度不同的两组用例，验证点必然不同 */
function semanticDiffers(a: TestCase, b: TestCase): boolean {
  const opposite = (x: string, y: string) => x.includes(y)
  const A = normalize(`${a.title} ${a.steps.join(' ')} ${a.expected.join(' ')}`)
  const B = normalize(`${b.title} ${b.steps.join(' ')} ${b.expected.join(' ')}`)
  if (opposite(A, '最大值') !== opposite(B, '最大值') || opposite(A, '最小值') !== opposite(B, '最小值')) return true
  if (/(自己|本人)/.test(A) !== /(自己|本人)/.test(B) && /(其他用户|他人)/.test(A) !== /(其他用户|他人)/.test(B)) return true
  const ra = rolesOf(a.title)
  const rb = rolesOf(b.title)
  if (ra.size && rb.size && (ra.size !== rb.size || [...ra].some((r) => !rb.has(r)))) return true

  const fa = filterFieldOf(a.title)
  const fb = filterFieldOf(b.title)
  if (fa && fb && fa !== fb) return true

  return false
}

/**
 * 重复用例预筛（确定性），只产出候选对交给模型确认，避免 O(n²) 全量喂模型
 * - 标题归一化后完全相同 → 强候选
 * - 引用了同一条款 且 步骤高度相似 且 标题也有一定相似 → 候选
 *   （只卡步骤相似度会误伤：模板化写法下不同用例的步骤骨架本来就长得很像）
 */
export function prescreenDuplicates(cases: TestCase[]): DupCandidate[] {
  const out: DupCandidate[] = []
  const seenPair = new Set<string>()

  const push = (a: TestCase, b: TestCase, score: number, reason: string) => {
    const key = [a.id, b.id].sort().join('|')
    if (seenPair.has(key)) return
    seenPair.add(key)
    out.push({ caseIds: [a.id, b.id], title: a.title, reason, score })
  }

  for (let i = 0; i < cases.length; i++) {
    for (let j = i + 1; j < cases.length; j++) {
      const a = cases[i]
      const b = cases[j]

      const ka = titleKey(a)
      const kb = titleKey(b)
      const refsA = new Set(a.evidence.map((e) => e.reqId))
      const sameRef = b.evidence.some((e) => refsA.has(e.reqId))
      if (numeralsDiffer(a, b)) continue
      if (semanticDiffers(a, b)) continue
      const expectedSim = jaccard(expectedKey(a), expectedKey(b))
      const preconditionSim = !a.precondition && !b.precondition ? 1
        : jaccard(bigrams(normalize(a.precondition)), bigrams(normalize(b.precondition)))
      if (ka === kb && ka.length > 0
        && normalize(a.precondition) === normalize(b.precondition)
        && normalize(a.expected.join('')) === normalize(b.expected.join(''))) {
        push(a, b, 1, '测试目标、前置条件和预期结论相同，建议人工合并')
        continue
      }
      if (ka === kb && sameRef && outcomeClass(a) === outcomeClass(b)
        && !(/未登录/.test(a.precondition) !== /未登录/.test(b.precondition))) {
        push(a, b, 0.96, '测试目标和预期结论同义，建议人工比较前置条件与步骤后合并')
        continue
      }
      if (!sameRef) continue
      const stepSim = jaccard(stepsKey(a), stepsKey(b))
      const titleSim = jaccard(bigrams(ka), bigrams(kb))
      if (expectedSim < 0.72 || preconditionSim < 0.4 || titleSim < 0.48 || stepSim < 0.55) continue
      const score = (expectedSim + preconditionSim + titleSim + stepSim) / 4
      push(a, b, score, `目标、前置条件、步骤和预期相近（${(score * 100).toFixed(0)}%），建议人工核对是否合并`)
    }
  }

  return out.sort((x, y) => y.score - x.score)
}
