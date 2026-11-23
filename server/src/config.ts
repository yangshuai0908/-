import fs from 'node:fs'
import path from 'node:path'

/** 定位项目根目录（web/ 与 server/ 的父目录），支持从根目录或 server/ 启动 */
function resolveRootDir(): string {
  const cwd = process.cwd()
  if (path.basename(cwd) === 'server' && fs.existsSync(path.join(path.dirname(cwd), 'package.json'))) {
    return path.dirname(cwd)
  }
  return cwd
}

export const rootDir = resolveRootDir()

/** 加载根目录 .env（Node 20.12+ 内置 loadEnvFile，无需 dotenv 依赖） */
function loadEnvFile(): string | null {
  const candidates = [path.join(rootDir, '.env'), path.join(rootDir, '.env.example')]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    try {
      process.loadEnvFile(file)
      return file
    } catch {
      // 忽略解析失败，走默认值
    }
  }
  return null
}

export const envFileLoaded = loadEnvFile()

function num(v: string | undefined, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && v !== '' && v !== undefined ? n : fallback
}

export const config = {
  port: num(process.env.PORT, 3001),
  dataDir: path.join(rootDir, 'data'),
  demoDataDir: path.join(rootDir, 'demo-data'),
  baseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: process.env.OPENAI_MODEL ?? 'deepseek-chat',
  temperature: num(process.env.LLM_TEMPERATURE, 0.2),
  /** 单次输出上限；不显式设置会把长度交给服务端默认值，长需求场景有截断风险 */
  maxTokens: num(process.env.LLM_MAX_TOKENS, 4096),
  /**
   * 思考模式开关。
   * DeepSeek Flash、glm-4.5-air 等模型默认开思考，会占用输出额度并显著拖慢响应，
   * 而"根据条款设计用例"不需要长链推理，所以默认关掉。
   */
  thinking: ((process.env.LLM_THINKING ?? 'disabled').toLowerCase() === 'enabled'
    ? 'enabled'
    : 'disabled') as 'enabled' | 'disabled',
  maxLlmCalls: num(process.env.MAX_LLM_CALLS, 24),
  /** 相同模型+相同输入直接复用上次合格输出，不再发起网络请求 */
  llmCache: (process.env.LLM_CACHE ?? 'on').toLowerCase() !== 'off',
  /** 上传新版本时继承上一版本未变条款的分析结果（含人工确认） */
  inheritAnalysis: (process.env.ANALYSIS_INHERIT ?? 'on').toLowerCase() !== 'off',
} as const

/** 模型配置是否完整 */
export function llmReady(): { ready: boolean; reason: string } {
  if (!config.apiKey) return { ready: false, reason: '缺少 OPENAI_API_KEY' }
  if (!config.baseUrl) return { ready: false, reason: '缺少 OPENAI_BASE_URL' }
  return { ready: true, reason: '已就绪' }
}
