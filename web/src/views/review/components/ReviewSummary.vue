<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NButton, NInput, useDialog, useMessage } from "naive-ui";
import { api } from "../../../api/client";
import {
  cases,
  reviewsRevision,
  currentRequirementId,
} from "../../../stores/workspace";
import {
  COST_COLOR,
  COST_LABEL,
  VERDICT_COLOR,
  VERDICT_LABEL,
  blankAssessment,
  type AssessmentSummary,
  type GapReview,
  type GapStatus,
  type RevisionCost,
  type Verdict,
} from "../../../types";
import PendingCaseList from "./PendingCaseList.vue";
import GapClauseList from "./GapClauseList.vue";

interface GapRow {
  reqId: string;
  sectionPath: string;
  status: GapStatus;
  comment: string;
}

const message = useMessage();
const dialog = useDialog();

const summary = ref<AssessmentSummary | null>(null);
const gapReviews = ref<GapReview[]>([]);
const gapRows = ref<GapRow[]>([]);
const assessing = ref(false);
const reviewerName = ref(localStorage.getItem("tp.reviewer") ?? "");
watch(reviewerName, (v) => localStorage.setItem("tp.reviewer", v.trim()));

async function loadSummary() {
  if (!currentRequirementId.value) {
    summary.value = null;
    return;
  }
  summary.value = await api
    .getAssessmentSummary(currentRequirementId.value)
    .catch(() => null);
}

function rebuildGapRows() {
  const byReq = new Map(gapReviews.value.map((g) => [g.reqId, g]));
  gapRows.value = (summary.value?.testableChunks ?? []).map((ch) => {
    const g = byReq.get(ch.reqId);
    return {
      reqId: ch.reqId,
      sectionPath: ch.sectionPath,
      status: g?.status ?? ("unconfirmed" as GapStatus),
      comment: g?.comment ?? "",
    };
  });
}

async function loadAssessment() {
  const rid = currentRequirementId.value;
  if (!rid) {
    assessing.value = false;
    summary.value = null;
    gapReviews.value = [];
    gapRows.value = [];
    return;
  }
  assessing.value = true;
  const [s, g] = await Promise.all([
    api.getAssessmentSummary(rid).catch(() => null),
    api.listGapReviews(rid).catch(() => [] as GapReview[]),
  ]);
  if (currentRequirementId.value !== rid) return;
  summary.value = s;
  gapReviews.value = g;
  rebuildGapRows();
  assessing.value = false;
}

async function saveGap(row: GapRow) {
  if (!currentRequirementId.value) return;
  try {
    const saved = await api.saveGapReview(currentRequirementId.value, {
      reqId: row.reqId,
      status: row.status,
      reviewer: reviewerName.value.trim(),
      comment: row.comment,
    });
    const idx = gapReviews.value.findIndex((g) => g.reqId === row.reqId);
    if (idx >= 0) gapReviews.value[idx] = saved;
    else gapReviews.value.push(saved);
    await loadSummary();
    message.success(`${row.reqId} 已记录`);
  } catch (e) {
    message.error((e as Error).message);
  }
}

function resetAssessments() {
  const rid = currentRequirementId.value;
  if (!rid) return;
  dialog.warning({
    title: "清空人工评审",
    content:
      "会清空当前需求版本下所有用例的人工结论、评审人、批注与条款遗漏确认，用例本身不受影响。确认继续？",
    positiveText: "清空",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await api.resetAssessments(rid);
        cases.value = cases.value.map((c) => ({
          ...c,
          assessment: blankAssessment(),
        }));
        await loadAssessment();
        message.success("人工评审已清空");
      } catch (e) {
        message.error((e as Error).message);
      }
    },
  });
}

const verdictRows = computed(() =>
  (["unreviewed", "effective", "needs_revision", "invalid"] as Verdict[]).map(
    (v) => ({
      key: v,
      label: VERDICT_LABEL[v],
      color: VERDICT_COLOR[v],
      count: summary.value?.byVerdict[v] ?? 0,
    }),
  ),
);

const costRows = computed(() =>
  (["none", "low", "medium", "high"] as RevisionCost[]).map((c) => ({
    key: c,
    label: COST_LABEL[c],
    color: COST_COLOR[c],
    count: summary.value?.byCost[c] ?? 0,
  })),
);

const pct = (v: number): string => `${Math.round(v * 100)}%`;

watch([currentRequirementId, reviewsRevision], async () => {
  await loadAssessment();
});

onMounted(async () => {
  await loadAssessment();
});

defineExpose({
  loadAssessment,
});
</script>

<template>
  <div v-if="summary" class="panel">
    <h3 class="section-title">
      人工评审
      <span class="text-dim" style="font-weight: 400">
        （测试 / 业务人员判断，与下方系统评分相互独立）
      </span>
    </h3>
    <div class="hr-head">
      <div>
        <span class="hr-big"
          >{{ summary.reviewed }}/{{ summary.total }}</span
        >
        <span class="tiny-text text-dim">
          条已人工评审 · 有效率 {{ pct(summary.effectiveRate) }} · 待评
          {{ summary.pending }} 条
        </span>
      </div>
      <div class="hr-head-right">
        <n-input
          v-model:value="reviewerName"
          size="tiny"
          placeholder="评审人姓名"
          style="width: 128px"
        />
        <n-button
          size="tiny"
          quaternary
          :loading="assessing"
          @click="loadAssessment"
          >刷新</n-button
        >
        <n-button
          size="tiny"
          quaternary
          type="error"
          @click="resetAssessments"
          >清空评审</n-button
        >
      </div>
    </div>

    <div class="coverage-track">
      <div
        class="coverage-fill"
        :style="{ width: pct(summary.reviewRate) }"
      />
    </div>

    <div class="hr-grid">
      <div
        v-for="v in verdictRows"
        :key="v.key"
        class="hr-card"
        :style="{ borderLeftColor: v.color }"
      >
        <div class="hr-num" :style="{ color: v.color }">{{ v.count }}</div>
        <div class="hr-label">{{ v.label }}</div>
      </div>
    </div>

    <div class="hr-cost">
      <b>修改成本</b>
      <span class="text-dim">
        待修改 {{ summary.byVerdict.needs_revision }} 条 · 相对工作量
        <b style="color: var(--tp-yellow)">{{
          summary.revisionEffortPoints
        }}</b>
        点 · 高成本 {{ summary.highCostCount }} 条
      </span>
      <span class="tiny-text text-dim"
        >刻度 低 1 / 中 3 / 高 6 点，非工时估算</span
      >
    </div>
    <div class="cost-row">
      <span v-for="c in costRows" :key="c.key" class="cost-chip">
        <span class="cat-dot" :style="{ background: c.color }" />{{
          c.label
        }}
        <b :style="{ color: c.color }">{{ c.count }}</b>
      </span>
    </div>

    <div class="hr-cols">
      <div class="hr-col">
        <div class="hr-sub-title">评审人分布</div>
        <div v-if="!summary.byReviewer.length" class="tiny-text text-dim">
          还没有人提交评审
        </div>
        <span
          v-for="r in summary.byReviewer"
          :key="r.reviewer"
          class="hr-chip"
        >
          {{ r.reviewer }} <b>{{ r.count }}</b>
        </span>
      </div>
      <div class="hr-col">
        <PendingCaseList :action-cases="summary.actionCases" />
      </div>
    </div>

    <GapClauseList
      :gap-rows="gapRows"
      :gap-stat="summary.gap"
      @save-gap="saveGap"
    />
  </div>
</template>

<style scoped>
.tiny-text {
  font-size: 12px;
}

.coverage-track {
  height: 6px;
  background: var(--tp-panel-2);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 16px;
}

.coverage-fill {
  height: 100%;
  background: var(--tp-accent);
}

.cat-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.hr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.hr-big {
  font-size: 22px;
  font-weight: 700;
  margin-right: 8px;
}

.hr-head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hr-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin: 16px 0;
}

.hr-card {
  background: var(--tp-panel-2);
  border-left: 3px solid var(--tp-border);
  border-radius: 5px;
  padding: 10px 14px;
}

.hr-num {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
}

.hr-label {
  font-size: 12px;
  color: var(--tp-text-dim);
  margin-top: 4px;
}

.hr-cost {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
  padding-top: 6px;
  border-top: 1px solid var(--tp-border);
}

.cost-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.cost-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  background: var(--tp-panel-2);
  border-radius: 4px;
  padding: 4px 10px;
}

.hr-cols {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 18px;
  margin-top: 18px;
}

.hr-col {
  min-width: 0;
}

.hr-sub-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--tp-text-dim);
  margin-bottom: 8px;
}

.hr-chip {
  display: inline-block;
  font-size: 12px;
  background: var(--tp-panel-2);
  border-radius: 4px;
  padding: 3px 9px;
  margin: 0 6px 6px 0;
}

@media (max-width: 900px) {
  .hr-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .hr-cols {
    grid-template-columns: 1fr;
  }
}
</style>
