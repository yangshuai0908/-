import path from 'node:path'
import mammoth from 'mammoth'
import { AppError } from '../utils.js'
import type { SourceType } from '../store/schema.js'

const TEXT_EXT: Record<string, SourceType> = {
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'txt',
}

export function detectSourceType(fileName: string): SourceType {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.docx') return 'docx'
  return TEXT_EXT[ext] ?? 'txt'
}

/** 从 base64 解析上传文件为纯文本 */
export async function parseUploadedFile(base64: string, fileName: string): Promise<{ text: string; sourceType: SourceType }> {
  const sourceType = detectSourceType(fileName)
  const buf = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64')

  if (buf.length === 0) throw new AppError('文件内容为空')
  if (buf.length > 20 * 1024 * 1024) throw new AppError('文件超过 20MB，请拆分后再上传')

  if (sourceType === 'docx') {
    try {
      const { value } = await mammoth.extractRawText({ buffer: buf })
      const text = normalizeText(value)
      if (!text) throw new Error('未解析出文本')
      return { text, sourceType }
    } catch (e) {
      throw new AppError(
        `docx 解析失败（${(e as Error).message}）。请在 Word 中另存为 .md/.txt，或直接粘贴纯文本`,
      )
    }
  }

  // md / txt：按 UTF-8 解码，去掉 BOM
  const text = normalizeText(buf.toString('utf8').replace(/^\uFEFF/, ''))
  if (!text) throw new AppError('文件内容为空')
  return { text, sourceType }
}

/** 统一换行、去掉多余空行（连续 3 个以上空行压成 2 个） */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
