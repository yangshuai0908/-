<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NButton, NSpin, useMessage } from "naive-ui";
import { api } from "../api/client";
import {
  cases,
  casesRevision,
  reviewsRevision,
  selectedReviewId,
  currentRequirement,
  currentRequirementId,
  sendToAgent,
} from "../stores/workspace";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  type Category,
  type ReviewReport,
} from "../types";
import ReviewSummary from "./review/components/ReviewSummary.vue";
import DuplicateGroup from "./review/components/DuplicateGroup.vue";

const message = useMessage();

const loading = ref(false);
const report = ref<ReviewReport | null>(null);

const caseTitle = computed(() => {
  const map = new Map(cases.value.map((c) => [c.id, c.title]));
  return (id: string) => map.get(id) ?? id;
});

async function loadCases() {
  const rid = currentRequirementId.value;
  if (!rid) return;
  try {
    const items = await api.listCases(rid);
    if (currentRequirementId.value === rid) cases.value = items;
  } catch {
    /* 忽略：只影响标题展示 */
  }
}

async function loadExisting() {
  const rid = currentRequirementId.value;
  if (!rid) {
    report.value = null;
    return;
  }
  try {
    const reportId = selectedReviewId.value;
    const result = reportId ? await api.getReviewReport(rid, reportId) : await api.getReview(rid);
    if (currentRequirementId.value === rid && selectedReviewId.value === reportId) report.value = result;
  } catch (e) {
    if (currentRequirementId.value === rid) {
      report.value = null;
      message.error((e as Error).message);
    }
  }
}

watch([currentRequirementId, casesRevision, reviewsRevision, selectedReviewId], async () => {
  report.value = null;
  await Promise.all([loadCases(), loadExisting()]);
});

onMounted(async () => {
  await Promise.all([loadCases(), loadExisting()]);
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
    selectedReviewId.value = report.value.id;
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

function askAgentForRemediation() {
  if (!report.value) return;
  const gapList = report.value.gaps
    .slice(0, 5)
    .map(
      (g) =>
        `- [${severityLabel[g.severity] || "中"}] 条款 ${g.reqId}: ${g.sectionPath} (${g.reason})`,
    )
    .join("\n");
  const dupList = report.value.duplicates
    .slice(0, 3)
    .map((d) => `- ${d.title}: ${d.reason}`)
    .join("\n");
  const prompt = `当前需求【${currentRequirement.value?.label}】质量评审报告如下：\n- 综合评分：${report.value.scores.total}/5 分\n- 条款覆盖率：${(report.value.coverageRate * 100).toFixed(1)}%\n- 覆盖缺口：${report.value.gaps.length} 处\n- 疑似重复用例：${report.value.duplicates.length} 组\n\n缺口示例：\n${gapList || "无"}\n\n疑似重复示例：\n${dupList || "无"}\n\n请给出审查建议，不新增或修改用例：\n1. 分析导致覆盖缺口的核心成因，并给出针对未覆盖条款的用例设计；\n2. 针对重复用例组提出合并去重建议；\n3. 列出需要澄清、用例修改和人工评审确认的事项，不保证评分或覆盖结果。`;
  sendToAgent({
    prompt,
    autoSend: true,
    role: "team",
    source: "review-remediation",
  });
}

function askAgentForDuplicateFix(d: { title: string; reason: string; caseIds: string[] }) {
  const casesList = d.caseIds
    .map((id: string) => `- 【${caseTitle.value(id)}】`)
    .join("\n");
  const prompt = `在质量评审中检测到疑似重复用例组【${d.title}】：\n${casesList}\n检测理由：${d.reason}\n\n请深度分析：\n1. 这几条用例的测试目的与断言是否存在实质重叠？\n2. 建议保留哪一条，或者如何将这几条合并为一条更具代表性的等价类测试用例？`;
  sendToAgent({
    prompt,
    autoSend: true,
    role: "team",
    source: "duplicate-fix",
  });
}

async function handleMergeDuplicateGroup(caseIds: string[]) {
  if (!currentRequirementId.value) return;
  try {
    const res = await api.mergeDuplicates(currentRequirementId.value, caseIds);
    message.success(`已合并该组用例，整合了依据与步骤（去重清理 ${res.removedCount} 条）`);
    await loadExisting();
    await loadCases();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '合并失败');
  }
}

async function handleMergeAllDuplicates() {
  if (!currentRequirementId.value) return;
  try {
    const res = await api.mergeDuplicates(currentRequirementId.value);
    if (res.removedCount > 0) {
      message.success(`已一键合并所有疑似重复用例（共合并 ${res.mergedCount} 条，去重清理 ${res.removedCount} 条）`);
      await loadExisting();
      await loadCases();
    } else {
      message.info('未发现需要自动合并的重复用例');
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : '一键合并失败');
  }
}

function askAgentForGapFix(g: any) {
  const prompt = `条款【${g.reqId} · ${g.sectionPath}】目前处于未覆盖状态（严重级别：${severityLabel[g.severity] || "中"}，原因：${g.reason}）。\n请结合完整需求核对缺失的测试点和待澄清规则，只给出候选测试点建议，不直接生成用例。`;
  sendToAgent({
    prompt,
    autoSend: true,
    role: "team",
    source: "gap-fix",
  });
}
</script>

<template>
  <div class="page">
    <div v-if="!currentRequirementId" class="empty">请先选择一个需求版本</div>

    <template v-else>
      <div class="panel review-bar">
        <span class="section-title" style="margin: 0">用例评审</span>
        <span class="tiny-text text-dim">
          {{ currentRequirement?.label }} · {{ cases.length }} 条用例
        </span>
        <span class="spacer" />
        <span v-if="report" class="tiny-text text-dim">
          评审于 {{ new Date(report.createdAt).toLocaleString("zh-CN") }}
        </span>
        <button
          v-if="report"
          type="button"
          class="review-agent-action-btn"
          title="整理问题和修改建议，不改写用例"
          @click="askAgentForRemediation"
        >
          查看审查建议
        </button>
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

      <!-- 人工评审汇总 -->
      <ReviewSummary v-if="!loading" />

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

        <!-- 需求覆盖 -->
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

        <!-- 疑似重复 -->
        <DuplicateGroup
          :duplicates="report.duplicates"
          :case-title="caseTitle"
          @ask-agent-for-duplicate-fix="askAgentForDuplicateFix"
          @merge-duplicate-group="handleMergeDuplicateGroup"
          @merge-all-duplicates="handleMergeAllDuplicates"
        />

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
            <span class="tiny-text text-dim gap-reason-text">{{ g.reason }}</span>
            <button
              type="button"
              class="gap-agent-btn"
              title="核对遗漏测试点"
              @click="askAgentForGapFix(g)"
            >
              ✦ AI 补齐用例
            </button>
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

.review-agent-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #1e40af;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.review-agent-action-btn:hover {
  background: #dbeafe;
  border-color: #93c5fd;
}

.gap-agent-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 500;
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
}
.gap-agent-btn:hover {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1e40af;
}

.gap-reason-text {
  flex: 1;
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
</style>
