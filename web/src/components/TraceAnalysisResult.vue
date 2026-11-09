<script setup lang="ts">
import { computed } from 'vue'
import { CATEGORY_LABEL, type Category } from '../types'
import { traceSections } from './traceAnalysis'

const props = defineProps<{ value: unknown; sectionTitles?: Record<string, string> }>()
const sections = computed(() => traceSections(props.value))
const pointCount = computed(() => sections.value?.reduce((total, section) => total + section.points.length, 0) ?? 0)
const questionCount = computed(() => sections.value?.reduce((total, section) => total + section.questions.length + section.points.reduce((count, point) => count + point.questions.length, 0), 0) ?? 0)
const raw = computed(() => typeof props.value === 'string' ? props.value : JSON.stringify(props.value, null, 2))
function category(value: string) { return Object.hasOwn(CATEGORY_LABEL, value) ? CATEGORY_LABEL[value as Category] : value }
function status(value?: string) {
  if (value === 'confirmed') return '已确认'
  if (value === 'pending') return '待确认'
  if (value === 'excluded') return '已排除'
  return value ? `未识别状态：${value}` : '模型候选'
}
</script>

<template>
  <div v-if="sections" class="analysis-result">
    <div class="result-summary">
      <strong>{{ sections.length }} 条条款 · {{ pointCount }} 个测试点</strong>
      <span v-if="questionCount" class="question-count">{{ questionCount }} 项待确认问题</span>
    </div>
    <p v-if="!sections.length" class="result-empty">本次返回的条款清单为空</p>
    <details v-for="(section, index) in sections" :key="`${section.reqId}:${index}`" class="result-section" :open="index === 0">
      <summary class="section-summary">
        <span class="mono req-label">{{ section.reqId }}</span>
        <span v-if="sectionTitles?.[section.reqId]">{{ sectionTitles[section.reqId] }}</span>
        <span class="point-count">{{ section.points.length }} 个测试点</span>
      </summary>
      <div v-if="section.questions.length" class="result-questions">
        <strong>条款待确认问题</strong><ul><li v-for="(question, i) in section.questions" :key="i">{{ question }}</li></ul>
      </div>
      <p v-if="section.notTestableReason" class="result-empty">不适用说明：{{ section.notTestableReason }}</p>
      <p v-if="!section.points.length && !section.notTestableReason" class="result-empty">本条款未返回测试点</p>
      <article v-for="(point, pointIndex) in section.points" :key="pointIndex" class="result-point">
        <div class="point-heading">
          <strong>{{ pointIndex + 1 }}. {{ point.title }}</strong>
          <span class="result-tag">{{ category(point.category) }}</span>
          <span class="result-tag" :class="{ confirmed: point.status === 'confirmed', pending: point.status === 'pending' }">{{ status(point.status) }}</span>
        </div>
        <p class="point-objective"><span class="field-label">验证目标</span>{{ point.objective }}</p>
        <div class="field-label">原文依据</div>
        <p v-if="!point.evidence.length" class="result-empty">未提供原文引用</p>
        <blockquote v-for="(evidence, i) in point.evidence" :key="i" class="result-evidence">
          <div class="evidence-meta"><span class="mono">{{ evidence.reqId }}</span><span :class="{ unmatched: evidence.matched === false }">{{ evidence.matched === true ? '已定位原文' : evidence.matched === false ? '未匹配原文' : '未记录原文校验结果' }}</span></div>
          <div>{{ evidence.quote }}</div>
        </blockquote>
        <div v-if="point.questions.length" class="result-questions">
          <strong>待确认问题</strong><ul><li v-for="(question, i) in point.questions" :key="i">{{ question }}</li></ul>
        </div>
      </article>
    </details>
    <details class="result-raw"><summary>查看原始 JSON / 返回内容</summary><pre>{{ raw }}</pre></details>
  </div>
  <pre v-else class="raw-content">{{ raw }}</pre>
</template>

<style scoped>
.analysis-result { margin-top: 10px; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.result-summary, .point-heading, .evidence-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.result-summary { justify-content: space-between; padding: 10px 12px; border-radius: 5px; background: var(--tp-panel-2); }
.question-count { color: var(--tp-yellow); }
.result-section { margin-top: 12px; border: 1px solid var(--tp-border); border-radius: 6px; }
.section-summary { padding: 10px 12px; cursor: pointer; background: var(--tp-panel-2); color: var(--tp-text); }
.req-label { color: var(--tp-accent); margin-right: 8px; }
.point-count { color: var(--tp-text-dim); margin-left: 8px; white-space: nowrap; }
.result-point { padding: 12px; border-top: 1px solid var(--tp-border); }
.point-heading strong { flex: 1 1 200px; font-size: 13px; }
.result-tag { padding: 1px 6px; border-radius: 4px; background: var(--tp-panel-2); color: var(--tp-text-dim); }
.result-tag.confirmed { color: var(--tp-green); }
.result-tag.pending { color: var(--tp-yellow); }
.point-objective { margin: 10px 0; white-space: pre-wrap; }
.field-label { color: var(--tp-text-dim); margin-right: 8px; }
.result-evidence { margin: 6px 0 0; padding: 8px 10px; border-left: 2px solid var(--tp-border); background: var(--tp-panel-2); white-space: pre-wrap; }
.evidence-meta { justify-content: space-between; color: var(--tp-text-dim); margin-bottom: 4px; font-size: 11px; }
.unmatched { color: var(--tp-red); }
.result-questions { margin: 10px 12px; padding: 8px 10px; border: 1px solid #e9d9ad; border-radius: 4px; background: #fffbef; color: var(--tp-yellow); }
.result-point .result-questions { margin-inline: 0; }
.result-questions ul { margin: 4px 0 0; padding-left: 18px; }
.result-empty { margin: 10px 12px; color: var(--tp-text-dim); }
.result-point .result-empty { margin-inline: 0; }
.result-raw { margin-top: 12px; }
.result-raw summary { cursor: pointer; color: var(--tp-accent); }
.raw-content, .result-raw pre { max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px; background: var(--tp-panel-2); font-size: 12px; }
</style>
