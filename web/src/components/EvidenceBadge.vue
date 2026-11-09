<script setup lang="ts">
import { computed } from "vue";
import type { Evidence, EvidenceState } from "../types";
import {
  STATE_COLOR,
  STATE_LABEL,
  evidenceNeedsRecheck,
  evidenceStateOf,
} from "../types";

const props = defineProps<{ evidence: Evidence[]; compact?: boolean }>();

const overall = computed<EvidenceState>(() => evidenceStateOf(props.evidence));
const needsRecheck = computed(() => evidenceNeedsRecheck(props.evidence));

const tooltip = computed(() => {
  if (needsRecheck.value)
    return "旧版依据结果尚未进行语义校验，请点击重新校验依据";
  if (!props.evidence.length)
    return "这条用例没有引用任何需求条款，无法追溯依据";
  return props.evidence
    .map(
      (e) => `${e.reqId} · ${STATE_LABEL[e.state] ?? "待重校验"}：${e.reason}`,
    )
    .join("\n");
});
</script>

<template>
  <span class="badge" :title="tooltip" :style="{ color: STATE_COLOR[overall] }">
    <i class="dot" :style="{ background: STATE_COLOR[overall] }" />
    <template v-if="!compact">
      {{ needsRecheck ? "待重新校验" : STATE_LABEL[overall] }}
      <span v-if="evidence.length > 1" class="count"
        >×{{ evidence.length }}</span
      >
    </template>
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  white-space: nowrap;
  cursor: help;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.count {
  opacity: 0.7;
  font-size: 11px;
}
</style>
