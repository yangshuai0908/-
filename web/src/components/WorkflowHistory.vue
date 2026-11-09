<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NDrawer, NDrawerContent, NSelect, NSpin, NTag } from 'naive-ui'
import { api } from '../api/client'
import type { WorkflowTrace } from '../types'
import TraceAnalysisResult from './TraceAnalysisResult.vue'
import { traceSectionTitles } from './traceAnalysis'

const props = defineProps<{ show: boolean; requirementId: string; runId?: string; caseId?: string }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()
const runs = ref<WorkflowTrace[]>([])
const selected = ref<string | null>(null)
const detail = ref<WorkflowTrace | null>(null)
const loading = ref(false)
const error = ref('')
let requestId = 0
const kinds = { analysis: '需求分析', generation: '生成用例', point_edit: '测试点修改 / 确认', case_edit: '用例修改', assessment: '人工评审', recheck: '重新校验依据' }
const statuses = { running: '进行中', succeeded: '成功', partial: '部分成功', failed: '失败', interrupted: '已中断' }
function time(value: string) { return new Date(value).toLocaleString('zh-CN') }
function json(value: unknown) { return JSON.stringify(value, null, 2) }
const options = computed(() => runs.value.map(run => ({ label: `${time(run.startedAt)} · ${kinds[run.kind]} · ${statuses[run.status]}`, value: run.id })))
const downloadUrl = computed(() => detail.value ? `/api/requirements/${props.requirementId}/traces/${detail.value.id}` : '')
const sectionTitles = computed(() => traceSectionTitles(detail.value?.input))

async function loadDetail() {
  const id = ++requestId
  detail.value = null
  error.value = ''
  if (!selected.value) { loading.value = false; return }
  loading.value = true
  try {
    const value = await api.getWorkflowTrace(props.requirementId, selected.value)
    if (id === requestId) detail.value = value
  } catch (e) { if (id === requestId) error.value = (e as Error).message }
  finally { if (id === requestId) loading.value = false }
}

async function refresh() {
  const requirementId = props.requirementId
  const id = ++requestId
  loading.value = true
  error.value = ''
  detail.value = null
  try {
    const values = await api.listWorkflowTraces(requirementId, props.caseId)
    if (id !== requestId || requirementId !== props.requirementId) return
    runs.value = values
    const candidate = props.runId || selected.value
    selected.value = values.some(run => run.id === candidate) ? candidate! : values[0]?.id ?? null
    await loadDetail()
  } catch (e) { if (id === requestId) error.value = (e as Error).message }
  finally { if (id === requestId) loading.value = false }
}

watch(() => [props.show, props.requirementId, props.runId, props.caseId], () => {
  if (props.show) { selected.value = null; void refresh() }
  else { requestId++; loading.value = false }
}, { immediate: true })
</script>

<template>
  <n-drawer :show="show" :width="800" style="max-width: 100vw" @update:show="emit('update:show', $event)">
    <n-drawer-content title="流程追溯" closable>
      <p class="trace-note">查看当时的输入、模型返回、校验和保存结果。成功表示步骤执行完成，内容是否合理仍需结合原文核对。历史数据不会补造记录。</p>
      <div class="trace-toolbar">
        <n-select v-model:value="selected" :options="options" placeholder="选择执行记录" :disabled="loading" @update:value="loadDetail" />
        <n-button :loading="loading" @click="refresh">刷新</n-button>
      </div>
      <div v-if="error" class="trace-error" role="alert">{{ error }}</div>
      <n-spin v-if="loading" />
      <div v-else-if="!runs.length" class="empty">当前范围暂无追溯记录。新增分析、确认测试点或生成用例后会保留记录。</div>
      <template v-if="detail">
        <div class="trace-meta">
          <strong>{{ kinds[detail.kind] }}</strong>
          <n-tag size="small" :type="detail.status === 'succeeded' ? 'success' : detail.status === 'running' ? 'info' : 'warning'">{{ statuses[detail.status] }}</n-tag>
          <span>{{ time(detail.startedAt) }}<template v-if="detail.finishedAt"> → {{ time(detail.finishedAt) }}</template></span>
          <span v-if="detail.model">模型：{{ detail.model }}</span>
          <span class="mono">{{ detail.id }}</span>
          <a :href="downloadUrl" target="_blank" rel="noopener">打开完整 JSON 记录</a>
        </div>
        <div v-if="detail.error" class="trace-error">{{ detail.error }}</div>
        <details class="trace-data"><summary>执行前输入快照</summary><pre>{{ json(detail.input) }}</pre></details>
        <article v-for="(step, index) in detail.steps" :key="step.id" class="trace-step">
          <div class="trace-step-head"><strong>{{ index + 1 }}. {{ step.name }}</strong><n-tag size="tiny" :type="step.status === 'failed' ? 'error' : step.status === 'succeeded' ? 'success' : 'info'">{{ statuses[step.status] }}</n-tag></div>
          <div class="trace-note">{{ time(step.startedAt) }}<template v-if="step.finishedAt"> → {{ time(step.finishedAt) }}</template></div>
          <div v-if="step.error" class="trace-error">{{ step.error }}</div>
          <details class="trace-data"><summary>本步输入 / 实际提示词</summary><pre>{{ json(step.input) }}</pre></details>
          <details v-if="step.output !== undefined" class="trace-data"><summary>本步结果 / 模型返回</summary><trace-analysis-result :value="step.output" :section-titles="sectionTitles" /></details>
        </article>
        <details v-if="detail.output !== undefined" class="trace-data"><summary>执行后结果快照</summary><trace-analysis-result :value="detail.output" :section-titles="sectionTitles" /></details>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.trace-note { color: var(--tp-text-dim); font-size: 12px; line-height: 1.7; }
.trace-toolbar, .trace-step-head, .trace-meta { display: flex; gap: 10px; align-items: center; }
.trace-toolbar { margin-bottom: 14px; }
.trace-meta { flex-wrap: wrap; margin-bottom: 16px; font-size: 12px; overflow-wrap: anywhere; }
.trace-step { padding: 12px; margin: 12px 0; border: 1px solid var(--tp-border); border-radius: 6px; }
.trace-step-head { justify-content: space-between; font-size: 13px; }
.trace-error { margin: 8px 0; padding: 10px; color: var(--tp-red); background: var(--tp-panel-2); overflow-wrap: anywhere; }
.trace-data { margin-top: 10px; font-size: 12px; }
.trace-data summary { cursor: pointer; color: var(--tp-accent); }
.trace-data pre { max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px; background: var(--tp-panel-2); }
</style>
