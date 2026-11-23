<script setup lang="ts">
import { computed, ref } from "vue";
import { NButton, NInput } from "naive-ui";
import { GAP_STATUS_LABEL, type GapStatus } from "../../../types";

interface GapRow {
  reqId: string;
  sectionPath: string;
  status: GapStatus;
  comment: string;
}

interface GapStat {
  confirmedOk: number;
  testable: number;
  missing: number;
}

const props = defineProps<{
  gapRows: GapRow[];
  gapStat: GapStat;
}>();

const emit = defineEmits<{
  saveGap: [row: GapRow];
}>();

const gapExpanded = ref(false);

const gapStatusOptions = (
  ["unconfirmed", "confirmed_ok", "missing"] as GapStatus[]
).map((s) => ({
  label: GAP_STATUS_LABEL[s],
  value: s,
}));

const visibleGapRows = computed(() => (gapExpanded.value ? props.gapRows : []));
</script>

<template>
  <div class="gap-review">
    <div class="gap-review-head">
      <span>
        <b>遗漏确认</b>
        <span class="text-dim tiny-text" style="margin-left: 8px">
          {{ props.gapStat.confirmedOk }}/{{
            props.gapStat.testable
          }}
          条已确认无遗漏， {{ props.gapStat.missing }} 条判为存在遗漏
        </span>
      </span>
      <n-button
        size="tiny"
        quaternary
        @click="gapExpanded = !gapExpanded"
      >
        {{
          gapExpanded
            ? "收起条款清单"
            : `展开条款清单（${props.gapRows.length} 条）`
        }}
      </n-button>
    </div>
    <div
      v-if="!gapExpanded"
      class="tiny-text text-dim"
      style="padding: 8px 0"
    >
      点右侧展开，逐条确认哪些条款缺用例
    </div>
    <div
      v-else-if="!visibleGapRows.length"
      class="tiny-text text-dim"
      style="padding: 8px 0"
    >
      该需求没有可测条款
    </div>
    <div
      v-for="row in visibleGapRows"
      :key="row.reqId"
      class="gap-review-row"
    >
      <span
        class="mono tiny-text"
        style="color: var(--tp-accent); width: 74px; flex: 0 0 74px"
      >
        {{ row.reqId }}
      </span>
      <span class="gap-review-name">{{
        row.sectionPath.split(" / ").slice(-1)[0]
      }}</span>
      <select
        v-model="row.status"
        class="gap-select"
        @change="emit('saveGap', row)"
      >
        <option
          v-for="o in gapStatusOptions"
          :key="o.value"
          :value="o.value"
        >
          {{ o.label }}
        </option>
      </select>
      <n-input
        v-model:value="row.comment"
        size="tiny"
        placeholder="遗漏说明，失焦保存"
        style="flex: 1"
        @blur="emit('saveGap', row)"
      />
    </div>
    <div class="tiny-text text-dim" style="margin-top: 8px">
      改结论立即保存，备注写完点空白处保存。发现缺用例请到「测试用例」页手动新增。
    </div>
  </div>
</template>

<style scoped>
.tiny-text {
  font-size: 12px;
}

.gap-review {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--tp-border);
}

.gap-review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  margin-bottom: 8px;
}

.gap-review-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.gap-review-name {
  flex: 0 0 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.gap-select {
  flex: 0 0 128px;
  font-size: 12px;
  font-family: inherit;
  color: var(--tp-text);
  background: var(--tp-panel-2);
  border: 1px solid var(--tp-border);
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
}
</style>
