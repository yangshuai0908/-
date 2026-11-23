<script setup lang="ts">
import { VERDICT_COLOR, VERDICT_LABEL, type Verdict } from "../../../types";

interface ActionCase {
  id: string;
  title: string;
  verdict: Verdict;
}

const props = defineProps<{
  actionCases: ActionCase[];
}>();
</script>

<template>
  <div>
    <div class="hr-sub-title">
      待处理用例（{{ props.actionCases.length }}）
    </div>
    <div v-if="!props.actionCases.length" class="tiny-text text-dim">
      没有需修改或废弃的用例
    </div>
    <div
      v-for="a in props.actionCases.slice(0, 6)"
      :key="a.id"
      class="hr-line"
    >
      <span
        class="hr-dot"
        :style="{ background: VERDICT_COLOR[a.verdict] }"
      />
      <span class="hr-line-title">{{ a.title }}</span>
      <span
        class="tiny-text"
        :style="{ color: VERDICT_COLOR[a.verdict] }"
      >
        {{ VERDICT_LABEL[a.verdict] }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.tiny-text {
  font-size: 12px;
}

.hr-sub-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--tp-text-dim);
  margin-bottom: 8px;
}

.hr-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 3px 0;
}

.hr-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 6px;
}

.hr-line-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
