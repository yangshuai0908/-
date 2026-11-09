<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NButton, NSpin, NTag, useMessage } from "naive-ui";
import { api } from "../api/client";
import { currentProjectId, requirements } from "../stores/workspace";
import type { CompareReport } from "../types";

const message = useMessage();

const fromId = ref<string | null>(null);
const toId = ref<string | null>(null);
const loading = ref(false);
const report = ref<CompareReport | null>(null);
const history = ref<CompareReport[]>([]);

const options = computed(() =>
  requirements.value.map((r) => ({
    label: `${r.label}（${r.chunks.length} 条）`,
    value: r.id,
  })),
);

const labelOf = computed(() => {
  const map = new Map(requirements.value.map((r) => [r.id, r.label]));
  return (id: string) => map.get(id) ?? id;
});

function syncDefault() {
  if (requirements.value.length >= 2) {
    if (
      !fromId.value ||
      !requirements.value.some((r) => r.id === fromId.value)
    ) {
      fromId.value = requirements.value[0].id;
    }
    if (!toId.value || !requirements.value.some((r) => r.id === toId.value)) {
      toId.value = requirements.value[requirements.value.length - 1].id;
    }
  }
}

watch(requirements, syncDefault, { deep: false });

async function loadHistory() {
  if (!currentProjectId.value) {
    history.value = [];
    return;
  }
  try {
    history.value = await api.listCompares(currentProjectId.value);
  } catch {
    history.value = [];
  }
}

onMounted(async () => {
  syncDefault();
  await loadHistory();
  // 有历史报告就先打开最近一份，避免页面一进来是空白，还得再点一次「开始对比」重跑一遍
  if (!report.value && history.value.length) openHistory(history.value[0]);
});

async function runCompare() {
  if (!currentProjectId.value || !fromId.value || !toId.value) {
    message.warning("请先选择两个需求版本");
    return;
  }
  loading.value = true;
  try {
    report.value = await api.compare({
      projectId: currentProjectId.value,
      fromReqId: fromId.value,
      toReqId: toId.value,
    });
    await loadHistory();
    const changed = report.value.changes.filter(
      (c) => c.type !== "unchanged",
    ).length;
    message.success(
      `对比完成：${changed} 处条款变化，${report.value.impactedCaseIds.length} 条受影响的已有用例`,
    );
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}

const stats = computed(() => {
  const s = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const c of report.value?.changes ?? []) s[c.type]++;
  return s;
});

const visibleChanges = computed(() =>
  (report.value?.changes ?? []).filter((c) => c.type !== "unchanged"),
);

const TYPE_LABEL: Record<string, string> = {
  added: "新增",
  removed: "删除",
  modified: "修改",
  unchanged: "未变",
};
const TYPE_COLOR: Record<string, string> = {
  added: "#4d8b6c",
  removed: "#b85858",
  modified: "#a7792f",
  unchanged: "#87919b",
};

const applyingIndex = ref<number | null>(null);

async function applyNewCase(index: number) {
  if (!report.value) return;
  applyingIndex.value = index;
  try {
    const created = await api.applyCompareNewCase(report.value.id, index);
    message.success(`已加入用例表：${created.title}`);
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    applyingIndex.value = null;
  }
}

const applyingAdjust = ref<number | null>(null);

/** 只有带了具体字段改动才给「应用」按钮，纯文字建议应用了也没东西可写 */
function hasPatch(
  a: CompareReport["results"]["adjustedCases"][number],
): boolean {
  const p = a.patch;
  if (!p) return false;
  return Boolean(
    p.title || p.precondition || p.steps?.length || p.expected?.length,
  );
}

async function applyAdjustCase(index: number) {
  if (!report.value) return;
  applyingAdjust.value = index;
  try {
    const updated = await api.applyCompareAdjust(report.value.id, index);
    message.success(`已按建议更新用例：${updated.title}`);
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    applyingAdjust.value = null;
  }
}

function openHistory(h: CompareReport) {
  report.value = h;
  fromId.value = h.fromReqId;
  toId.value = h.toReqId;
}
</script>

<template>
  <div class="page">
    <div v-if="requirements.length < 2" class="empty">
      变更对比需要同一项目下至少两个需求版本，请先在「需求」页导入新版本
    </div>

    <template v-else>
      <div class="panel compare-bar">
        <span class="section-title" style="margin: 0">版本对比</span>
        <span class="text-dim tiny-text">从</span>
        <select v-model="fromId" class="vselect">
          <option v-for="o in options" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
        <span class="text-dim tiny-text">到</span>
        <select v-model="toId" class="vselect">
          <option v-for="o in options" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
        <n-button
          size="small"
          type="primary"
          :loading="loading"
          @click="runCompare"
          >开始对比</n-button
        >
        <span class="spacer" />
        <span class="tiny-text text-dim">历史 {{ history.length }} 份</span>
      </div>

      <n-spin v-if="loading" style="display: block; margin: 60px auto" />

      <template v-else-if="report">
        <!-- 变更统计 -->
        <div class="panel">
          <div class="stats-row">
            <div class="stat">
              <span class="stat-num" :style="{ color: TYPE_COLOR.added }">{{
                stats.added
              }}</span>
              <span class="stat-label">新增条款</span>
            </div>
            <div class="stat">
              <span class="stat-num" :style="{ color: TYPE_COLOR.modified }">{{
                stats.modified
              }}</span>
              <span class="stat-label">修改条款</span>
            </div>
            <div class="stat">
              <span class="stat-num" :style="{ color: TYPE_COLOR.removed }">{{
                stats.removed
              }}</span>
              <span class="stat-label">删除条款</span>
            </div>
            <div class="stat">
              <span class="stat-num" :style="{ color: TYPE_COLOR.unchanged }">{{
                stats.unchanged
              }}</span>
              <span class="stat-label">未变</span>
            </div>
            <div class="stat">
              <span class="stat-num" style="color: var(--tp-accent)">{{
                report.impactedCaseIds.length
              }}</span>
              <span class="stat-label">受影响用例</span>
            </div>
          </div>

          <div class="changes-list">
            <div v-for="(c, i) in visibleChanges" :key="i" class="change-item">
              <div class="change-head">
                <span
                  class="type-tag"
                  :style="{
                    color: TYPE_COLOR[c.type],
                    borderColor: TYPE_COLOR[c.type],
                  }"
                >
                  {{ TYPE_LABEL[c.type] }}
                </span>
                <span class="change-path">{{ c.sectionPath }}</span>
                <span class="tiny-text text-dim mono"
                  >{{ c.fromReqId || "—" }} → {{ c.toReqId || "—" }}</span
                >
                <span v-if="c.type === 'modified'" class="tiny-text text-dim">
                  文本相似度 {{ (c.score * 100).toFixed(0) }}%
                </span>
              </div>
              <div v-if="c.type === 'modified'" class="diff-pair">
                <div class="diff-box before">
                  <div class="diff-label">改前</div>
                  <div class="diff-text">{{ c.before }}</div>
                </div>
                <div class="diff-box after">
                  <div class="diff-label">改后</div>
                  <div class="diff-text">{{ c.after }}</div>
                </div>
              </div>
              <div v-else class="diff-box">
                <div class="diff-text">{{ c.after || c.before }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 建议 -->
        <div class="panel">
          <h3 class="section-title">用例调整建议</h3>

          <div v-if="report.results.newCases.length" class="advice-block">
            <div class="advice-title" :style="{ color: TYPE_COLOR.added }">
              建议新增（{{ report.results.newCases.length }}）
            </div>
            <div
              v-for="(n, i) in report.results.newCases"
              :key="i"
              class="advice-item"
            >
              <div class="advice-head">
                <span class="advice-name">{{ n.title }}</span>
                <n-tag size="tiny" :bordered="false">{{
                  n.category ?? "normal"
                }}</n-tag>
                <n-button
                  size="tiny"
                  quaternary
                  :loading="applyingIndex === i"
                  @click="applyNewCase(i)"
                >
                  加入用例表
                </n-button>
              </div>
              <div class="tiny-text text-dim">
                预期：{{ (n.expected ?? []).join("；") || "—" }}
              </div>
              <div
                v-if="n.evidence?.length"
                class="tiny-text"
                style="color: var(--tp-accent)"
              >
                依据：{{
                  n.evidence
                    .map((e) => `${e.reqId} · ${e.quote.slice(0, 30)}`)
                    .join(" / ")
                }}
              </div>
            </div>
          </div>

          <div v-if="report.results.adjustedCases.length" class="advice-block">
            <div class="advice-title" :style="{ color: TYPE_COLOR.modified }">
              建议调整（{{ report.results.adjustedCases.length }}）
            </div>
            <div
              v-for="(a, i) in report.results.adjustedCases"
              :key="i"
              class="advice-item"
            >
              <div class="advice-head">
                <span class="advice-name">{{ a.caseTitle }}</span>
                <n-button
                  v-if="hasPatch(a)"
                  size="tiny"
                  quaternary
                  :loading="applyingAdjust === i"
                  @click="applyAdjustCase(i)"
                >
                  应用调整
                </n-button>
                <n-tag v-else size="tiny" :bordered="false"
                  >仅提示，无具体改法</n-tag
                >
              </div>
              <div class="tiny-text text-dim">原因：{{ a.reason }}</div>
              <div class="tiny-text text-dim">改法：{{ a.change }}</div>
              <div
                v-if="a.patch?.title"
                class="tiny-text"
                style="color: var(--tp-accent)"
              >
                标题改为：{{ a.patch.title }}
              </div>
              <div
                v-if="a.patch?.precondition"
                class="tiny-text"
                style="color: var(--tp-accent)"
              >
                前置改为：{{ a.patch.precondition }}
              </div>
              <div
                v-if="a.patch?.steps?.length"
                class="tiny-text"
                style="color: var(--tp-accent)"
              >
                步骤改为：{{ a.patch.steps.join(" → ") }}
              </div>
              <div
                v-if="a.patch?.expected?.length"
                class="tiny-text"
                style="color: var(--tp-accent)"
              >
                预期改为：{{ a.patch.expected.join("；") }}
              </div>
            </div>
          </div>

          <div
            v-if="report.results.deprecatedCases.length"
            class="advice-block"
          >
            <div class="advice-title" :style="{ color: TYPE_COLOR.removed }">
              建议废弃（{{ report.results.deprecatedCases.length }}）
            </div>
            <div
              v-for="(d, i) in report.results.deprecatedCases"
              :key="i"
              class="advice-item"
            >
              <div class="advice-head">
                <span class="advice-name">{{ d.caseTitle }}</span>
              </div>
              <div class="tiny-text text-dim">原因：{{ d.reason }}</div>
            </div>
          </div>

          <div v-if="report.results.notes.length" class="notes">
            <div v-for="(n, i) in report.results.notes" :key="i">· {{ n }}</div>
          </div>

          <div
            v-if="
              !report.results.newCases.length &&
              !report.results.adjustedCases.length &&
              !report.results.deprecatedCases.length
            "
            class="empty"
          >
            这次对比没有产生用例调整建议
          </div>
        </div>

        <!-- 历史 -->
        <div v-if="history.length" class="panel">
          <h3 class="section-title">历史报告</h3>
          <div
            v-for="h in history"
            :key="h.id"
            class="history-row"
            :class="{ active: report.id === h.id }"
            @click="openHistory(h)"
          >
            <span class="mono tiny-text text-dim">{{ h.id }}</span>
            <span>{{ labelOf(h.fromReqId) }} → {{ labelOf(h.toReqId) }}</span>
            <span class="tiny-text text-dim">
              {{ h.changes.filter((c) => c.type !== "unchanged").length }}
              处变化 · {{ h.impactedCaseIds.length }} 条受影响
            </span>
            <span class="tiny-text text-dim">{{
              new Date(h.createdAt).toLocaleString("zh-CN")
            }}</span>
          </div>
        </div>
      </template>

      <div v-else class="empty">选择两个版本后点「开始对比」</div>
    </template>
  </div>
</template>

<style scoped>
.compare-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  flex-wrap: wrap;
}

.vselect {
  background: var(--tp-panel-2);
  border: 1px solid var(--tp-border);
  color: var(--tp-text);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
  outline: none;
  min-width: 150px;
}

.spacer {
  flex: 1;
}

.tiny-text {
  font-size: 12px;
}

.stats-row {
  display: flex;
  gap: 32px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--tp-border);
  margin-bottom: 14px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-num {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.1;
}

.stat-label {
  font-size: 11px;
  color: var(--tp-text-dim);
}

.change-item {
  padding: 10px 0;
  border-bottom: 1px dashed var(--tp-border);
}

.change-item:last-child {
  border-bottom: none;
}

.change-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.type-tag {
  font-size: 11px;
  border: 1px solid;
  border-radius: 4px;
  padding: 0 6px;
}

.change-path {
  font-size: 13px;
  font-weight: 600;
}

.diff-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.diff-box {
  background: var(--tp-panel-2);
  border-radius: 6px;
  padding: 8px 10px;
}

.diff-box.before {
  border-left: 2px solid var(--tp-red);
}

.diff-box.after {
  border-left: 2px solid var(--tp-green);
}

.diff-label {
  font-size: 11px;
  color: var(--tp-text-dim);
  margin-bottom: 4px;
}

.diff-text {
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
}

.advice-block {
  margin-bottom: 18px;
}

.advice-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
}

.advice-item {
  background: var(--tp-panel-2);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.advice-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.advice-name {
  font-size: 13px;
  font-weight: 500;
  flex: 1;
}

.notes {
  font-size: 12px;
  color: var(--tp-text-dim);
  line-height: 1.8;
  border-top: 1px solid var(--tp-border);
  padding-top: 10px;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.history-row:hover {
  background: var(--tp-panel-2);
}

.history-row.active {
  background: rgba(69, 107, 145, 0.1);
}
</style>
