<script setup lang="ts">
import { NButton, NInput, NSelect } from "naive-ui";
import {
  CATEGORY_LABEL,
  VERDICT_LABEL,
  type Category,
  type EvidenceState,
  type Verdict,
} from "../../../types";

// ── props / emits ──────────────────────────────────────────────────────────────
const props = defineProps<{
  filterCategory: "all" | Category;
  filterState: "all" | EvidenceState;
  filterVerdict: "all" | Verdict;
  keyword: string;
  filteredCount: number;
  totalCount: number;
}>();

const emit = defineEmits<{
  (e: "update:filterCategory", v: "all" | Category): void;
  (e: "update:filterState", v: "all" | EvidenceState): void;
  (e: "update:filterVerdict", v: "all" | Verdict): void;
  (e: "update:keyword", v: string): void;
  (e: "clear"): void;
}>();

// ── options ───────────────────────────────────────────────────────────────────
const ALL: Category[] = ["normal", "abnormal", "boundary", "permission"];

const categoryOptions = [
  { label: "全部", value: "all" },
  ...ALL.map((c) => ({ label: CATEGORY_LABEL[c], value: c })),
];

const stateOptions = [
  { label: "全部依据", value: "all" },
  { label: "明确支持", value: "explicit" },
  { label: "推导待确认", value: "inferred" },
  { label: "依据不足", value: "unknown" },
];

const VERDICTS: Verdict[] = ["unreviewed", "effective", "needs_revision", "invalid"];
const verdictOptions = [
  { label: "全部评审状态", value: "all" },
  ...VERDICTS.map((v) => ({ label: VERDICT_LABEL[v], value: v })),
];
</script>

<template>
  <div class="filters">
    <n-select
      :value="props.filterCategory"
      :options="categoryOptions"
      aria-label="按用例分类筛选"
      size="small"
      @update:value="emit('update:filterCategory', $event)"
    />
    <n-select
      :value="props.filterState"
      :options="stateOptions"
      aria-label="按需求依据筛选"
      size="small"
      @update:value="emit('update:filterState', $event)"
    />
    <n-select
      :value="props.filterVerdict"
      :options="verdictOptions"
      aria-label="按人工结论筛选"
      size="small"
      @update:value="emit('update:filterVerdict', $event)"
    />
    <n-input
      :value="props.keyword"
      size="small"
      placeholder="搜索标题或模块"
      clearable
      @update:value="emit('update:keyword', $event)"
    />
    <n-button size="small" quaternary @click="emit('clear')">重置</n-button>
    <span class="tiny-text text-dim filter-count" role="status">
      显示 {{ props.filteredCount }} / {{ props.totalCount }} 条
    </span>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: 120px 140px 150px minmax(180px, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.filter-count {
  white-space: nowrap;
}

.tiny-text {
  font-size: 12px;
}
</style>
