<script setup lang="ts">
import { NButton } from "naive-ui";
import type { EvidenceState, TestCase } from "../../../types";
import { AGENT_ROLES } from "../../../types";
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
}>();

const emit = defineEmits<{
  (e: "open-editor", c: TestCase): void;
  (e: "merge-group", caseIds: string[]): void;
  (e: "merge-all"): void;
}>();


function findAndOpenCase(id: string) {
  const target = cases.value.find((c) => c.id === id);
  if (target) {
    emit("open-editor", target);
  }
}
</script>

<template>
  <details class="quality-summary">
    <summary>质量提示<span>待人工评审 {{ stats.pending }}</span><span v-if="stats.byState.unknown">依据不足 {{ stats.byState.unknown }}</span><span v-if="stats.byState.inferred">推导待确认 {{ stats.byState.inferred }}</span><span v-if="gapRows.length">待澄清 {{ gapRows.length }}</span><span v-if="duplicates.length">近似重复 {{ duplicates.length }} 组</span></summary>
    <div class="quality-details">
      <p>模型检查由{{ AGENT_ROLES.reviewer.label }}负责，最终结论由人工评审。</p>
      <p v-if="stats.pendingValidation">{{ stats.pendingValidation }} 条依据需要重新校验，可在列表的“更多操作”中执行。</p>
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
      <p v-if="!gapRows.length && !duplicates.length">当前没有待澄清项或近似重复提示，仍需核对具体步骤与预期。</p>
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
</style>
