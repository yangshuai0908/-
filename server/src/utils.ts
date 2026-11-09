import crypto from 'node:crypto'

export const genId = (prefix: string): string => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`

export const nowIso = (): string => new Date().toISOString()

export const CATEGORIES = ['normal', 'abnormal', 'boundary', 'permission'] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  normal: '正常场景',
  abnormal: '异常场景',
  boundary: '边界场景',
  permission: '权限场景',
}

export class AppError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/** 去重但保留首次出现的顺序 */
export function uniqBy<T>(arr: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of arr) {
    const k = key(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}
