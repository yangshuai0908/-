<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NButton, NInput, NSpin, useDialog, useMessage } from "naive-ui";
import { api } from "../api/client";
import {
  cases,
  casesRevision,
  currentRequirement,
  currentRequirementId,
} from "../stores/workspace";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  COST_COLOR,
  COST_LABEL,
  GAP_STATUS_LABEL,
  VERDICT_COLOR,
  VERDICT_LABEL,
  blankAssessment,
  type AssessmentSummary,
  type Category,
  type GapReview,
  type GapStatus,
  type ReviewReport,
  type RevisionCost,
  type Verdict,
} from "../types";

interface GapRow {
  reqId: string;
  sectionPath: string;
  status: GapStatus;
  comment: string;
}

const message = useMessage();
const dialog = useDialog();

const loading = ref(false);
const report = ref<ReviewReport | null>(null);

const caseTitle = computed(() => {
  const map = new Map(cases.value.map((c) => [c.id, c.title]));
  return (id: string) => map.get(id) ?? id;
});

async function loadCases() {
  if (!currentRequirementId.value) return;
  try {
    cases.value = await api.listCases(currentRequirementId.value);
  } catch {
    /* 忽略：只影响标题展示 */
  }
}

async function loadExisting() {
  if (!currentRequirementId.value) {
    report.value = null;
    return;
  }
  try {
    report.value = await api.getReview(currentRequirementId.value);
  } catch {
    report.value = null;
  }
}

// ── 人工评审：与系统自动评分相互独立，没跑过系统评审也能看 ──
const summary = ref<AssessmentSummary | null>(null);
const gapReviews = ref<GapReview[]>([]);
// 必须是 ref 而非 computed：computed 返回缓存快照，行内编辑会被重算冲掉
const gapRows = ref<GapRow[]>([]);
const gapExpanded = ref(false);
const assessing = ref(false);
const reviewerName = ref(localStorage.getItem("tp.reviewer") ?? "");
watch(reviewerName, (v) => localStorage.setItem("tp.reviewer", v.trim()));

const gapStatusOptions = (
  ["unconfirmed", "confirmed_ok", "missing"] as GapStatus[]
).map((s) => ({
  label: GAP_STATUS_LABEL[s],
  value: s,
}));

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
    // 只刷汇总，不重建 gapRows，避免把用户还在输入的备注冲掉
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

const visibleGapRows = computed(() => (gapExpanded.value ? gapRows.value : []));

const pct = (v: number): string => `${Math.round(v * 100)}%`;

watch([currentRequirementId, casesRevision], async () => {
  report.value = null;
  await Promise.all([loadCases(), loadExisting(), loadAssessment()]);
});

onMounted(async () => {
  await Promise.all([loadCases(), loadExisting(), loadAssessment()]);
});

async function runReview() {
  if (!currentRequirementId.value) {
    message.warning("请先选择需求版本");
    return;
  }
  loading.value = true;
  try {
    report.value = await api.review({
      requirementId: currentRequirementId.value,
    });
    message.success(
      `评审完成：覆盖率 ${(report.value.coverageRate * 100).toFixed(0)}%，总分 ${report.value.scores.total}`,
    );
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}

const scoreItems = computed(() => {
  if (!report.value) return [];
  const s = report.value.scores;
  return [
    {
      label: "需求覆盖率",
      value: s.coverage,
      hint: `${(report.value.coverageRate * 100).toFixed(0)}% 条款被引用`,
    },
    { label: "场景完整性", value: s.completeness, hint: "四类场景是否齐全" },
    { label: "步骤可执行性", value: s.executability, hint: "照着能不能做" },
    { label: "预期可判定性", value: s.verifiability, hint: "结果能不能验证" },
    { label: "总分", value: s.total, hint: "四项均值", highlight: true },
  ];
});

const coveredRows = computed(() => report.value?.coverage ?? []);
// 背景说明、纯接口定义这类条款不计入分母，也不该算「未覆盖」
const testableRows = computed(() =>
  coveredRows.value.filter((r) => r.testable !== false),
);
const uncoveredCount = computed(
  () => testableRows.value.filter((r) => !r.caseIds.length).length,
);
const skippedCount = computed(
  () => coveredRows.value.length - testableRows.value.length,
);

const categoryRows = computed(() => {
  const stats = report.value?.categoryStats ?? {};
  return (["normal", "abnormal", "boundary", "permission"] as Category[]).map(
    (c) => ({
      key: c,
      label: CATEGORY_LABEL[c],
      color: CATEGORY_COLOR[c],
      count: stats[c] ?? 0,
    }),
  );
});

function scoreColor(v: number): string {
  if (v >= 4) return "var(--tp-green)";
  if (v >= 3) return "var(--tp-yellow)";
  return "var(--tp-red)";
}

const severityLabel: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};
const severityColor: Record<string, string> = {
  high: "var(--tp-red)",
  medium: "var(--tp-yellow)",
  low: "var(--tp-text-dim)",
};
</script>

<template>
  <div class="page">
    <div v-if="!currentRequirementId" class="empty">请先选择一个需求版本</div>

    <template v-else>
      <div class="panel review-bar">
        <span class="section-title" style="margin: 0">用例评审</span>
        <span class="tiny-text text-dim"
          >{{ currentRequirement?.label }} · {{ cases.length }} 条用例</span
        >
        <span class="spacer" />
        <span v-if="report" class="tiny-text text-dim">
          评审于 {{ new Date(report.createdAt).toLocaleString("zh-CN") }}
        </span>
        <n-button
          size="small"
          type="primary"
          :loading="loading"
          @click="runReview"
        >
          {{ report ? "重新评审" : "开始评审" }}
        </n-button>
      </div>

      <n-spin v-if="loading" style="display: block; margin: 60px auto" />

      <!-- 人工评审：独立于系统评分，没跑过系统评审也能看 -->
      <div v-if="!loading && summary" class="panel">
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
            <div class="hr-sub-title">
              待处理用例（{{ summary.actionCases.length }}）
            </div>
            <div v-if="!summary.actionCases.length" class="tiny-text text-dim">
              没有需修改或废弃的用例
            </div>
            <div
              v-for="a in summary.actionCases.slice(0, 6)"
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
        </div>

        <div class="gap-review">
          <div class="gap-review-head">
            <span>
              <b>遗漏确认</b>
              <span class="text-dim tiny-text" style="margin-left: 8px">
                {{ summary.gap.confirmedOk }}/{{
                  summary.gap.testable
                }}
                条已确认无遗漏， {{ summary.gap.missing }} 条判为存在遗漏
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
                  : `展开条款清单（${gapRows.length} 条）`
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
              @change="saveGap(row)"
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
              @blur="saveGap(row)"
            />
          </div>
          <div class="tiny-text text-dim" style="margin-top: 8px">
            改结论立即保存，备注写完点空白处保存。发现缺用例请到「测试用例」页手动新增。
          </div>
        </div>
      </div>

      <template v-if="report && !loading">
        <!-- 评分卡 -->
        <div class="panel">
          <h3 class="section-title">评分</h3>
          <div class="score-grid">
            <div
              v-for="s in scoreItems"
              :key="s.label"
              class="score-card"
              :class="{ highlight: s.highlight }"
            >
              <div class="score-value" :style="{ color: scoreColor(s.value) }">
                {{ s.value.toFixed(1) }}
              </div>
              <div class="score-label">{{ s.label }}</div>
              <div class="score-hint">{{ s.hint }}</div>
            </div>
          </div>
        </div>

        <!-- 覆盖情况 -->
        <div class="panel">
          <h3 class="section-title">
            需求覆盖
            <span class="text-dim" style="font-weight: 400">
              （{{ testableRows.length - uncoveredCount }}/{{
                testableRows.length
              }}
              条被引用，未覆盖 {{ uncoveredCount }} 条<template
                v-if="skippedCount"
              >
                ，另有 {{ skippedCount }} 条无需用例</template
              >）
            </span>
          </h3>

          <div class="coverage-track">
            <div
              class="coverage-fill"
              :style="{ width: `${report.coverageRate * 100}%` }"
            />
          </div>

          <div class="coverage-grid">
            <div
              v-for="r in coveredRows"
              :key="r.reqId"
              class="coverage-cell"
              :class="{
                empty: r.testable !== false && !r.caseIds.length,
                skip: r.testable === false,
              }"
              :title="
                r.testable === false
                  ? `${r.reqId} ${r.sectionPath}：该条款无需用例（不计入覆盖率）`
                  : `${r.reqId} ${r.sectionPath}：${r.caseIds.length} 条用例`
              "
            >
              <span class="mono tiny-text">{{ r.reqId }}</span>
              <span class="coverage-name">{{
                r.sectionPath.split(" / ").slice(-1)[0]
              }}</span>
              <span
                class="coverage-count"
                :style="{
                  color:
                    r.testable === false
                      ? 'var(--tp-text-dim)'
                      : r.caseIds.length
                        ? 'var(--tp-green)'
                        : 'var(--tp-red)',
                }"
              >
                {{ r.testable === false ? "N/A" : r.caseIds.length }}
              </span>
            </div>
          </div>

          <div class="cat-row">
            <div v-for="c in categoryRows" :key="c.key" class="cat-item">
              <span class="cat-dot" :style="{ background: c.color }" />
              <span class="tiny-text">{{ c.label }}</span>
              <span
                class="cat-count"
                :style="{ color: c.count ? c.color : 'var(--tp-red)' }"
                >{{ c.count }}</span
              >
            </div>
          </div>
        </div>

        <!-- 重复 -->
        <div class="panel">
          <h3 class="section-title">
            疑似重复（{{ report.duplicates.length }} 组）
          </h3>
          <div
            v-if="!report.duplicates.length"
            class="empty"
            style="padding: 20px 0"
          >
            没有发现重复用例
          </div>
          <div v-for="(d, i) in report.duplicates" :key="i" class="dup-item">
            <div class="dup-title">{{ d.title }}</div>
            <div class="tiny-text text-dim">{{ d.reason }}</div>
            <div class="dup-cases">
              <span v-for="id in d.caseIds" :key="id" class="dup-case mono">{{
                caseTitle(id)
              }}</span>
            </div>
          </div>
        </div>

        <!-- 遗漏 -->
        <div class="panel">
          <h3 class="section-title">遗漏与缺口（{{ report.gaps.length }}）</h3>
          <div v-if="!report.gaps.length" class="empty" style="padding: 20px 0">
            所有条款都有用例覆盖
          </div>
          <div v-for="(g, i) in report.gaps" :key="i" class="gap-item">
            <span
              class="severity"
              :style="{
                color: severityColor[g.severity],
                borderColor: severityColor[g.severity],
              }"
            >
              {{ severityLabel[g.severity] }}
            </span>
            <span class="mono tiny-text" style="color: var(--tp-accent)">{{
              g.reqId
            }}</span>
            <span class="gap-name">{{
              g.sectionPath.split(" / ").slice(-1)[0]
            }}</span>
            <span class="tiny-text text-dim">{{ g.reason }}</span>
          </div>
        </div>

        <!-- 建议 -->
        <div class="panel">
          <h3 class="section-title">改进建议</h3>
          <ul class="advice-list">
            <li v-for="(a, i) in report.advice" :key="i">{{ a }}</li>
          </ul>
        </div>
      </template>

      <div v-if="!report && !loading" class="empty">
        还没有系统评审结果，点「开始评审」跑一次（人工评审面板不受影响）
      </div>
    </template>
  </div>
</template>

<style scoped>
.review-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  flex-wrap: wrap;
}

.spacer {
  flex: 1;
}

.tiny-text {
  font-size: 12px;
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}

.score-card {
  background: var(--tp-panel-2);
  border-radius: 8px;
  padding: 14px 16px;
}

.score-card.highlight {
  border: 1px solid rgba(69, 107, 145, 0.28);
}

.score-value {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.1;
}

.score-label {
  font-size: 12px;
  margin-top: 6px;
}

.score-hint {
  font-size: 11px;
  color: var(--tp-text-dim);
  margin-top: 2px;
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

.coverage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 6px;
  margin-bottom: 16px;
}

.coverage-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--tp-panel-2);
  border-left: 2px solid var(--tp-green);
  font-size: 12px;
}

.coverage-cell.empty {
  border-left-color: var(--tp-red);
  opacity: 0.75;
}

/* 背景说明 / 纯接口定义这类条款不需要用例，用弱化的视觉和 N/A 区分，
   避免和「真的漏了」混在一起看 */
.coverage-cell.skip {
  border-left-color: var(--tp-border);
  opacity: 0.45;
}

.coverage-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coverage-count {
  font-weight: 700;
  font-size: 12px;
}

.cat-row {
  display: flex;
  gap: 24px;
  padding-top: 14px;
  border-top: 1px solid var(--tp-border);
}

.cat-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cat-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.cat-count {
  font-weight: 700;
  font-size: 13px;
}

.dup-item {
  padding: 10px 0;
  border-bottom: 1px dashed var(--tp-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dup-item:last-child {
  border-bottom: none;
}

.dup-title {
  font-size: 13px;
  font-weight: 500;
}

.dup-cases {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dup-case {
  font-size: 11px;
  background: var(--tp-panel-2);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--tp-text-dim);
}

.gap-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  font-size: 13px;
}

.severity {
  font-size: 11px;
  border: 1px solid;
  border-radius: 4px;
  padding: 0 5px;
}

.gap-name {
  min-width: 140px;
}

.advice-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.9;
}

/* 人工评审面板 */
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

@media (max-width: 900px) {
  .hr-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .hr-cols {
    grid-template-columns: 1fr;
  }
}
</style>
