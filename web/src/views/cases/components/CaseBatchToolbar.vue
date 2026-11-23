<script setup lang="ts">
import { computed } from "vue";
import { NButton, NCheckbox, NCheckboxGroup } from "naive-ui";
import {
  AGENT_ROLES,
  CATEGORY_LABEL,
  isHumanConfirmed,
  type Category,
} from "../../../types";
import {
  cases,
  currentRequirement,
  currentRequirementId,
} from "../../../stores/workspace";

// ── props / emits ─────────────────────────────────────────────────────────────
const props = defineProps<{
  selected: Category[];
  generating: boolean;
  recheckingAll: boolean;
  progress: { done: number; total: number; message: string };
  estimate: {
    chunks: number;
    points: number;
    scenarios: number;
    pending: number;
    excluded: number;
    batches: number;
    calls: number;
  } | null;
}>();

const emit = defineEmits<{
  (e: "update:selected", v: Category[]): void;
  (e: "generateWithAgent"): void;
  (e: "generate", overwrite: boolean): void;
  (e: "open-editor", c: any): void;
}>();

// ── computed ──────────────────────────────────────────────────────────────────
const ALL: Category[] = ["normal", "abnormal", "boundary", "permission"];

const confirmedPoints = computed(() =>
  (currentRequirement.value?.analysis?.sections ?? [])
    .flatMap((section) => section.points)
    .filter(
      (point) =>
        isHumanConfirmed(point) && props.selected.includes(point.category),
    ),
);

const linkedPointCount = computed(
  () =>
    confirmedPoints.value.filter((point) =>
      cases.value.some(
        (c) =>
          c.source?.pointId === point.id &&
          c.source.analysisId === currentRequirement.value?.analysis?.id,
      ),
    ).length,
);

const pointLinks = computed(() =>
  confirmedPoints.value.map((point) => ({
    point,
    cases: cases.value.filter(
      (c) =>
        c.source?.pointId === point.id &&
        c.source.analysisId === currentRequirement.value?.analysis?.id,
    ),
  })),
);

const canGenerate = computed(
  () =>
    Boolean(currentRequirementId.value) &&
    confirmedPoints.value.length > 0 &&
    !props.generating &&
    !props.recheckingAll,
);
</script>

<template>
  <section class="panel generation-panel">
    <div class="gen-bar">
      <div class="gen-left"><strong>用例生成</strong><span class="owner">{{ AGENT_ROLES.qa_expert.label }} · {{ confirmedPoints.length }} 个已确认测试点</span></div>
      <n-button size="small" :disabled="!canGenerate" :loading="generating" type="primary" @click="emit('generateWithAgent')">生成用例</n-button>
    </div>
    <details class="generation-settings">
      <summary>生成设置与来源</summary>
      <div class="settings-content">
        <n-checkbox-group :value="props.selected" @update:value="emit('update:selected', $event as Category[])"><n-checkbox v-for="c in ALL" :key="c" :value="c" :label="CATEGORY_LABEL[c]" /></n-checkbox-group>
        <p>仅使用人工确认的测试点。{{ linkedPointCount }}/{{ confirmedPoints.length }} 个已有用例来源关联；来源关联不代表验证通过或完整覆盖。<span v-if="estimate">确认点将展开为 {{ estimate.scenarios }} 个场景骨架，预计请求模型 {{ estimate.calls }} 次（未计缓存命中、格式修复和限流重试）。待确认 {{ estimate.pending }} 个、已排除 {{ estimate.excluded }} 个，不参与生成。</span></p>
        <p v-if="!confirmedPoints.length">请先在测试点页确认生成范围。</p>
        <details v-if="pointLinks.length" class="point-matrix">
          <summary>查看测试点与用例对应</summary>
          <div v-for="link in pointLinks" :key="link.point.id" class="point-link">
            <div><strong>{{ link.point.title }}</strong><div>{{ link.point.objective }}</div><details><summary>引用原文</summary><blockquote v-for="(e, index) in link.point.evidence" :key="index">{{ e.reqId }}：{{ e.quote }}</blockquote></details></div>
            <div class="point-cases"><span v-if="!link.cases.length">尚无来源关联的用例</span><n-button v-for="c in link.cases" :key="c.id" size="tiny" text type="primary" @click="emit('open-editor', c)">{{ c.title }}</n-button></div>
          </div>
        </details>
        <n-button size="small" :disabled="!canGenerate" @click="emit('generate', true)">重新生成并替换已有用例</n-button>
      </div>
    </details>
    <div v-if="generating" class="progress-panel" role="status">
      <div class="progress-head"><span>{{ progress.message || '生成中…' }}</span><span>{{ progress.total ? progress.done + '/' + progress.total + ' 批完成' : '准备中' }}</span></div>
      <div class="progress-track"><div class="progress-fill" :style="{ width: progress.total ? (progress.done / progress.total) * 100 + '%' : '8%' }" /></div>
    </div>
  </section>
</template>

<style scoped>
.gen-bar, .gen-left, .progress-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.gen-left { justify-content: flex-start; }
.owner, .generation-settings, .progress-panel { font-size: 12px; color: var(--tp-text-dim); }
.generation-settings { margin-top: 8px; }
summary { cursor: pointer; color: var(--tp-accent); }
.settings-content { display: grid; gap: 12px; padding-top: 12px; }
.settings-content p { margin: 0; line-height: 1.7; }
.settings-content > .n-button { justify-self: start; }
.point-link { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; border-top: 1px solid var(--tp-border); padding: 12px 0; margin-top: 8px; overflow-wrap: anywhere; }
blockquote { margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--tp-border); }
.point-cases { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
.point-cases :deep(.n-button) { max-width: 100%; height: auto; white-space: normal; text-align: left; }
.progress-panel { margin-top: 12px; }
.progress-head { margin-bottom: 8px; }
.progress-track { height: 4px; background: var(--tp-panel-2); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--tp-accent); transition: width .3s; }
@media (max-width: 700px) { .point-link { grid-template-columns: minmax(0, 1fr); } }
</style>
