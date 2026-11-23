<script setup lang="ts">
import { NButton } from "naive-ui";
import { computed } from "vue";
import type { CoverageReport, EvidenceState, TestCase } from "../../../types";
import { AGENT_ROLES, CATEGORY_LABEL } from "../../../types";
import { cases } from "../../../stores/workspace";

const props = defineProps<{
  stats: {
    total: number;
    byState: Record<EvidenceState, number>;
    pending: number;
    pendingValidation: number;
  };
  gapRows: { text: string; caseIds: string[]; reqIds: string[] }[];
  duplicates: { caseIds: string[]; title: string; reason: string; score: number }[];
  coverage: CoverageReport | null;
}>();

const emit = defineEmits<{
  (e: "open-editor", c: TestCase): void;
  (e: "merge-group", caseIds: string[]): void;
  (e: "merge-all"): void;
}>();

const coverageGaps = computed(() => {
  const report = props.coverage;
  if (!report || !report.summary.scenarios) return [];
  return report.points
    .map((point) => ({
      ...point,
      gaps: point.scenarios.filter(
        (s) => s.status === "missing" || s.status === "stale",
      ),
    }))
    .filter((point) => point.gaps.length > 0);
});


function findAndOpenCase(id: string) {
  const target = cases.value.find((c) => c.id === id);
  if (target) {
    emit("open-editor", target);
  }
}
</script>

<template>
  <details class="quality-summary">
    <summary>质量提示<span>待人工评审 {{ stats.pending }}</span><span v-if="stats.byState.unknown">依据不足 {{ stats.byState.unknown }}</span><span v-if="stats.byState.inferred">推导待确认 {{ stats.byState.inferred }}</span><span v-if="gapRows.length">待澄清 {{ gapRows.length }}</span><span v-if="duplicates.length">近似重复 {{ duplicates.length }} 组</span><span v-if="coverage && coverage.summary.scenarios">场景覆盖 {{ coverage.summary.covered }}/{{ coverage.summary.scenarios }}</span><span v-if="coverage && coverage.summary.stale">分析已更新 {{ coverage.summary.stale }}</span></summary>
    <div class="quality-details">
      <p>模型检查由{{ AGENT_ROLES.reviewer.label }}负责，最终结论由人工评审。</p>
      <p v-if="stats.pendingValidation">{{ stats.pendingValidation }} 条依据需要重新校验，可在列表的“更多操作”中执行。</p>
      <details v-if="coverageGaps.length">
        <summary>场景覆盖缺口（{{ coverageGaps.length }} 个测试点未覆盖完整，含被合并/去重的场景）</summary>
        <ul>
          <li v-for="point in coverageGaps" :key="point.pointId" class="coverage-point">
            <div class="coverage-title">{{ point.title }}<span class="coverage-cat">{{ CATEGORY_LABEL[point.category] }}</span></div>
            <ul class="coverage-scenarios">
              <li v-for="s in point.gaps" :key="s.scenarioId">
                <span :class="['coverage-state', `is-${s.status}`]">{{ s.status === 'stale' ? '待重生成' : '缺失' }}</span>
                {{ s.label }}<span v-if="s.reason" class="coverage-reason">· {{ s.reason }}</span>
              </li>
            </ul>
          </li>
        </ul>
        <p class="coverage-hint">缺口可按场景类型重新生成补齐；生成时的自动合并与去重也会在此说明原因。</p>
      </details>
      <details v-if="gapRows.length"><summary>需求待澄清（{{ gapRows.length }}）</summary><ul><li v-for="(gap, i) in gapRows" :key="i">{{ gap.text }} <span v-if="gap.reqIds.length">· {{ gap.reqIds.join('、') }}</span><n-button v-for="id in gap.caseIds.slice(0, 3)" :key="id" size="tiny" text @click="findAndOpenCase(id)">查看用例</n-button></li></ul></details>
      <details v-if="duplicates.length">
        <summary class="dup-summary">
          <span>近似重复（{{ duplicates.length }} 组，可一键合并或人工核对）</span>
          <n-button size="tiny" type="warning" secondary @click.stop="emit('merge-all')">一键合并所有重复</n-button>
        </summary>
        <ul>
          <li v-for="(dup, i) in duplicates" :key="i" class="dup-item">
            <div class="dup-info">
              <span>{{ dup.reason }}</span>
              <n-button size="tiny" type="primary" secondary @click="emit('merge-group', dup.caseIds)">合并该组</n-button>
            </div>
            <div class="dup-cases">
              <n-button v-for="id in dup.caseIds" :key="id" size="tiny" text @click="findAndOpenCase(id)">
                {{ cases.find(c => c.id === id)?.title ?? id }}
              </n-button>
            </div>
          </li>
        </ul>
      </details>
      <p v-if="!gapRows.length && !duplicates.length && !coverageGaps.length">当前没有待澄清项、近似重复或场景覆盖缺口，仍需核对具体步骤与预期。</p>
    </div>
  </details>
</template>

<style scoped>
.quality-summary { margin: 12px 0; padding: 8px 12px; border: 1px solid var(--tp-border); border-radius: 5px; font-size: 12px; color: var(--tp-text-dim); }
summary { cursor: pointer; }
.quality-summary > summary { line-height: 1.8; }
.quality-summary > summary span { margin-left: 16px; }
.quality-details { border-top: 1px solid var(--tp-border); margin-top: 8px; padding-top: 8px; }
.quality-details p { margin: 4px 0 8px; }
.quality-details details { padding: 6px 0; }
ul { max-height: 220px; overflow-y: auto; padding-left: 18px; line-height: 1.8; overflow-wrap: anywhere; }
li .n-button { margin-left: 8px; }
.dup-summary { display: flex; align-items: center; justify-content: space-between; padding-right: 12px; }
.dup-item { margin: 6px 0; list-style-type: none; }
.dup-info { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 500; }
.dup-cases { margin-top: 2px; }
.coverage-point { margin: 6px 0; list-style-type: none; }
.coverage-title { font-weight: 500; }
.coverage-cat { margin-left: 8px; font-size: 11px; color: var(--tp-text-dim); border: 1px solid var(--tp-border); border-radius: 3px; padding: 0 4px; }
.coverage-scenarios { padding-left: 18px; }
.coverage-state { display: inline-block; margin-right: 6px; font-size: 11px; border-radius: 3px; padding: 0 4px; }
.coverage-state.is-missing { color: #b85858; border: 1px solid #b85858; }
.coverage-state.is-stale { color: #a7792f; border: 1px solid #a7792f; }
.coverage-reason { color: var(--tp-text-dim); }
.coverage-hint { color: var(--tp-text-dim); }
</style>
