<script setup lang="ts">
import { computed } from "vue";
import { NPopover, NTag } from "naive-ui";
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

const badgeConfig = computed(() => {
  if (needsRecheck.value) {
    return {
      label: "待重校验",
      type: "default" as const,
      color: "#94a3b8",
      bg: "#f1f5f9",
      border: "#e2e8f0",
      icon: "⏳",
    };
  }
  if (!props.evidence.length) {
    return {
      label: "无条款依据",
      type: "error" as const,
      color: "#ef4444",
      bg: "#fef2f2",
      border: "#fecaca",
      icon: "❌",
    };
  }
  switch (overall.value) {
    case "explicit":
      return {
        label: "明确支持",
        type: "success" as const,
        color: "#10b981",
        bg: "#ecfdf5",
        border: "#a7f3d0",
        icon: "✓",
      };
    case "inferred":
      return {
        label: "推导待核对",
        type: "warning" as const,
        color: "#f59e0b",
        bg: "#fffbeb",
        border: "#fde68a",
        icon: "~",
      };
    default:
      return {
        label: "依据不足",
        type: "error" as const,
        color: "#ef4444",
        bg: "#fef2f2",
        border: "#fecaca",
        icon: "⚠",
      };
  }
});

function matchBadge(match?: string) {
  if (match === "exact") return { text: "原文精确匹配", type: "success" as const };
  if (match === "fuzzy") return { text: "措辞改写·数值一致", type: "warning" as const };
  return { text: "未匹配原文", type: "error" as const };
}

function stateText(s?: string) {
  if (s === "explicit") return "明确定义";
  if (s === "inferred") return "合理推导";
  return "缺乏依据";
}
</script>

<template>
  <n-popover trigger="hover" placement="bottom-start" :show-arrow="true" raw>
    <template #trigger>
      <span
        class="evidence-pill"
        :style="{
          color: badgeConfig.color,
          background: badgeConfig.bg,
          borderColor: badgeConfig.border,
        }"
      >
        <span class="pill-icon">{{ badgeConfig.icon }}</span>
        <template v-if="!compact">
          <span class="pill-text">{{ badgeConfig.label }}</span>
          <span v-if="evidence.length > 1" class="pill-count"
            >×{{ evidence.length }}</span
          >
        </template>
      </span>
    </template>

    <div class="popover-card">
      <div class="popover-header">
        <div class="header-status">
          <span
            class="status-indicator-dot"
            :style="{ background: badgeConfig.color }"
          />
          <strong>需求溯源与依据核对</strong>
        </div>
        <span class="total-tag">{{ evidence.length }} 条依据引用</span>
      </div>

      <div v-if="!evidence.length" class="empty-evidence-warning">
        <span class="warning-icon">⚠️</span>
        <div>
          <strong>缺少原文引用</strong>
          <p>此用例未关联任何需求条款，无法验证其是否为 AI 凭空编造。</p>
        </div>
      </div>

      <div v-else class="evidence-list">
        <div
          v-for="(e, index) in evidence"
          :key="index"
          class="evidence-card-item"
          :class="{
            'item-exact': e.quoteMatch === 'exact',
            'item-fuzzy': e.quoteMatch === 'fuzzy',
            'item-missing': e.quoteMatch === 'missing' || e.state === 'unknown',
          }"
        >
          <div class="item-top">
            <span class="req-badge">{{ e.reqId || "未知条款" }}</span>
            <span v-if="e.sectionPath" class="section-path">{{ e.sectionPath }}</span>
            <n-tag
              size="tiny"
              :bordered="false"
              :type="matchBadge(e.quoteMatch).type"
              class="match-tag"
            >
              {{ matchBadge(e.quoteMatch).text }}
            </n-tag>
          </div>

          <blockquote class="quote-box">
            <span class="quote-mark">“</span>
            {{ e.quote || "（未提供原文句子）" }}
            <span class="quote-mark">”</span>
          </blockquote>

          <div v-if="e.reason" class="reason-row" :class="{ 'reason-danger': e.state === 'unknown' }">
            <span class="reason-icon">{{ e.state === 'unknown' ? '❌' : e.state === 'inferred' ? '💡' : '✅' }}</span>
            <span class="reason-text">{{ e.reason }}</span>
          </div>

          <div v-if="e.relocated" class="relocate-box">
            <span class="relocate-label">建议替换真句：</span>
            <span class="relocate-text">{{ e.relocated }}</span>
          </div>

          <div class="support-matrix">
            <div class="matrix-item">
              <span class="matrix-label">条件依据：</span>
              <span class="matrix-val" :class="e.conditionSupport || 'unknown'">
                {{ stateText(e.conditionSupport) }}
              </span>
            </div>
            <div class="matrix-item">
              <span class="matrix-label">预期依据：</span>
              <span class="matrix-val" :class="e.expectedSupport || 'unknown'">
                {{ stateText(e.expectedSupport) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </n-popover>
</template>

<style scoped>
.evidence-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 12px;
  border: 1px solid transparent;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: all 0.15s ease;
}
.evidence-pill:hover {
  filter: brightness(0.96);
  transform: translateY(-1px);
}
.pill-icon {
  font-size: 10px;
  font-weight: 800;
}
.pill-count {
  font-size: 10px;
  opacity: 0.75;
}

/* 浮层面板样式 */
.popover-card {
  width: 360px;
  max-width: 90vw;
  background: #ffffff;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
  padding: 12px 14px;
  font-family: inherit;
}

.popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 8px;
  margin-bottom: 10px;
}
.header-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #1e293b;
}
.status-indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.total-tag {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
}

.empty-evidence-warning {
  display: flex;
  gap: 10px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 10px;
  color: #991b1b;
  font-size: 12px;
}
.empty-evidence-warning strong {
  display: block;
  margin-bottom: 2px;
}
.empty-evidence-warning p {
  margin: 0;
  color: #b91c1c;
  line-height: 1.4;
}

.evidence-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 380px;
  overflow-y: auto;
}

.evidence-card-item {
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  padding: 9px 10px;
  background: #f8fafc;
}
.evidence-card-item.item-exact {
  border-color: #bbf7d0;
  background: #f0fdf4;
}
.evidence-card-item.item-fuzzy {
  border-color: #fde68a;
  background: #fffbeb;
}
.evidence-card-item.item-missing {
  border-color: #fecaca;
  background: #fef2f2;
}

.item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.req-badge {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #1e40af;
  background: #dbeafe;
  padding: 1px 6px;
  border-radius: 4px;
}
.section-path {
  font-size: 11px;
  color: #475569;
  font-weight: 500;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-tag {
  margin-left: auto;
}

.quote-box {
  margin: 0 0 6px;
  padding: 6px 8px;
  background: #ffffff;
  border-left: 3px solid #3b82f6;
  border-radius: 0 4px 4px 0;
  font-size: 12px;
  line-height: 1.5;
  color: #334155;
  word-break: break-word;
}
.quote-mark {
  color: #94a3b8;
  font-size: 14px;
}

.reason-row {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  font-size: 11px;
  line-height: 1.4;
  color: #475569;
  margin-bottom: 6px;
}
.reason-danger {
  color: #b91c1c;
  font-weight: 600;
}
.reason-icon {
  flex-shrink: 0;
  font-size: 12px;
}

.relocate-box {
  background: #ffffff;
  border: 1px dashed #f59e0b;
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 11px;
  margin-bottom: 6px;
}
.relocate-label {
  color: #b45309;
  font-weight: 600;
}
.relocate-text {
  color: #78350f;
}

.support-matrix {
  display: flex;
  gap: 12px;
  font-size: 11px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  padding-top: 5px;
}
.matrix-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.matrix-label {
  color: #64748b;
}
.matrix-val {
  font-weight: 600;
}
.matrix-val.explicit {
  color: #059669;
}
.matrix-val.inferred {
  color: #d97706;
}
.matrix-val.unknown {
  color: #dc2626;
}
</style>
