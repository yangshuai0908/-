<script setup lang="ts">
import { NButton, NTag } from "naive-ui";
import {
  isHumanConfirmed,
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  type TestPoint,
} from "../../types";
import { canvasFocus } from "../../stores/workspace";

interface SectionLike {
  reqId: string;
  sectionPath?: string;
  questions: string[];
}

const props = defineProps<{
  point: TestPoint;
  section: SectionLike;
  busy: boolean;
}>();

const emit = defineEmits<{
  openEditor: [point: TestPoint, reqId: string];
  quickConfirm: [point: TestPoint, reqId: string];
  quickExclude: [point: TestPoint, reqId: string];
  focusPoint: [point: TestPoint, section: SectionLike];
  askAgentForPointQuestions: [point: TestPoint, section: SectionLike];
  consultPoint: [point: TestPoint, section: SectionLike];
}>();

const statusLabel: Record<TestPoint["status"], string> = {
  pending: "待确认",
  confirmed: "已确认",
  excluded: "已排除",
};
const statusType = {
  pending: "warning",
  confirmed: "success",
  excluded: "default",
} as const;
</script>

<template>
  <div
    class="point-card"
    :class="{
      'canvas-focused-point': canvasFocus?.id === point.id,
      'is-confirmed': point.status === 'confirmed',
      'is-excluded': point.status === 'excluded',
    }"
    :style="{ borderLeftColor: CATEGORY_COLOR[point.category] }"
    @click="emit('focusPoint', point, section)"
  >
    <div class="point-head">
      <div class="head-left">
        <strong class="point-title">{{ point.title || "未填写名称" }}</strong>
        <span v-if="canvasFocus?.id === point.id" class="point-focus-badge">🎯 对齐中</span>
        <n-tag
          size="tiny"
          :bordered="false"
          :color="{
            color: CATEGORY_COLOR[point.category] + '18',
            textColor: CATEGORY_COLOR[point.category],
          }"
        >
          {{ CATEGORY_LABEL[point.category] }}
        </n-tag>
        <n-tag
          size="tiny"
          :bordered="false"
          :type="statusType[point.status]"
        >
          {{ point.status === "confirmed" && !isHumanConfirmed(point) ? "历史确认·需复核" : statusLabel[point.status] }}
        </n-tag>
      </div>

      <div class="head-actions">
        <button
          v-if="point.status !== 'confirmed'"
          type="button"
          class="point-action-btn confirm-btn"
          title="人工快速确认此测试点"
          :disabled="busy"
          @click.stop="emit('quickConfirm', point, section.reqId)"
        >
          ✓ 确认
        </button>
        <button
          v-if="point.status !== 'excluded'"
          type="button"
          class="point-action-btn exclude-btn"
          title="将此测试点排除出生成范围"
          :disabled="busy"
          @click.stop="emit('quickExclude', point, section.reqId)"
        >
          ✕ 排除
        </button>
        <n-button
          size="tiny"
          quaternary
          :disabled="busy"
          @click.stop="emit('openEditor', point, section.reqId)"
        >
          编辑详情
        </n-button>
      </div>
    </div>

    <!-- 验证目标 -->
    <div class="objective-box">
      <div class="objective-header">
        <span class="objective-dot" :style="{ background: CATEGORY_COLOR[point.category] }" />
        <span class="objective-label">验证目标</span>
      </div>
      <div class="objective-text pre-wrap">{{ point.objective || "未填写验证目标" }}</div>
    </div>

    <div v-if="point.methods?.length" class="methods-bar">
      <span class="methods-label">测试方法：</span>
      <span class="methods-text">{{ point.methods.join("、") }}</span>
      <span v-if="point.rationale" class="rationale-text">（{{ point.rationale }}）</span>
    </div>

    <!-- 依据引用 -->
    <div class="evidence-container">
      <div class="evidence-caption">
        <span>📖 原文依据</span>
        <span v-if="!point.evidence.length" class="warn-badge">⚠️ 缺少原文引用，不能确认</span>
      </div>
      <div
        v-for="(evidence, index) in point.evidence"
        :key="index"
        class="evidence-box"
        :class="evidence.matched ? 'matched' : 'unmatched'"
      >
        <div class="evidence-head">
          <span class="mono req-id">{{ evidence.reqId || "未选条款" }}</span>
          <span class="match-indicator" :class="evidence.matched ? 'matched' : 'unmatched'">
            {{ evidence.matched ? "✓ 原文已定位" : "⚠️ 未匹配原文" }}
          </span>
        </div>
        <blockquote class="quote-content">“{{ evidence.quote || "未填写引用文本" }}”</blockquote>
      </div>
    </div>

    <!-- 待确认问题阻断区 -->
    <div v-if="point.questions.length" class="questions-card">
      <div class="questions-head">
        <div class="questions-title-wrap">
          <span class="q-icon">❓</span>
          <strong>待澄清需求疑问 ({{ point.questions.length }})</strong>
        </div>
        <button
          type="button"
          class="ask-agent-question-btn"
          title="整理具体的待澄清问题"
          @click.stop="emit('askAgentForPointQuestions', point, section)"
        >
          整理澄清问题
        </button>
      </div>
      <ul class="questions-ul">
        <li v-for="(question, index) in point.questions" :key="index">
          {{ question }}
        </li>
      </ul>
    </div>

    <!-- 人工核对记录条 -->
    <div v-if="point.review" class="review-sign-bar">
      <span class="sign-icon">👤</span>
      <span class="sign-reviewer">{{ point.review.reviewer }}</span>
      <span class="sign-date">{{ point.review.at }}</span>
      <span v-if="point.review.comment" class="sign-comment">· {{ point.review.comment }}</span>
    </div>

    <div class="point-agent-bar">
      <button type="button" class="point-agent-btn analyst" :disabled="busy" title="核对原文依据和待澄清规则，不生成用例" @click.stop="emit('consultPoint', point, section)">核对测试点</button>
    </div>
  </div>
</template>

<style scoped>
.point-card {
  margin-top: 10px;
  padding: 12px 14px;
  border: 1px solid var(--tp-border, #e2e8f0);
  border-left-width: 4px;
  border-radius: 8px;
  transition: all 0.2s ease;
  cursor: pointer;
  background: var(--tp-panel, #ffffff);
}
.point-card:hover {
  border-color: #93c5fd;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.08);
}
.point-card.canvas-focused-point {
  border-color: #3b82f6;
  background: #f8faff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
}
.point-card.is-confirmed {
  border-left-color: #10b981 !important;
}
.point-card.is-excluded {
  opacity: 0.65;
  background: #f8fafc;
}
.point-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}
.point-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  overflow-wrap: anywhere;
}
.point-focus-badge {
  font-size: 10px;
  font-weight: 600;
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  padding: 1px 6px;
  border-radius: 4px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.point-action-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}
.point-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.confirm-btn {
  background: #ecfdf5;
  color: #059669;
  border-color: #a7f3d0;
}
.confirm-btn:hover:not(:disabled) {
  background: #d1fae5;
  border-color: #6ee7b7;
}
.exclude-btn {
  background: #f8fafc;
  color: #64748b;
  border-color: #cbd5e1;
}
.exclude-btn:hover:not(:disabled) {
  background: #f1f5f9;
  color: #ef4444;
  border-color: #fca5a5;
}

.objective-box {
  margin-top: 10px;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}
.objective-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.objective-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.objective-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.objective-text {
  font-size: 13px;
  line-height: 1.5;
  color: #334155;
}
.pre-wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.methods-bar {
  margin-top: 8px;
  font-size: 12px;
  color: #475569;
  background: #fafafa;
  padding: 4px 8px;
  border-radius: 4px;
}
.methods-label {
  font-weight: 500;
  color: #64748b;
}
.rationale-text {
  color: #94a3b8;
  font-style: italic;
}

.evidence-container {
  margin-top: 10px;
}
.evidence-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 4px;
}
.warn-badge {
  font-size: 10px;
  color: #d97706;
  background: #fffbeb;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid #fde68a;
}
.evidence-box {
  padding: 8px 10px;
  margin-top: 6px;
  background: #f8fafc;
  border-left: 3px solid #cbd5e1;
  border-radius: 0 6px 6px 0;
  border-top: 1px solid #f1f5f9;
  border-right: 1px solid #f1f5f9;
  border-bottom: 1px solid #f1f5f9;
}
.evidence-box.matched {
  border-left-color: #10b981;
  background: #f0fdf4;
}
.evidence-box.unmatched {
  border-left-color: #f59e0b;
  background: #fffbeb;
}
.evidence-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.req-id {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.08);
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.match-indicator {
  font-size: 11px;
  font-weight: 500;
}
.match-indicator.matched {
  color: #059669;
}
.match-indicator.unmatched {
  color: #d97706;
}
.quote-content {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
  font-style: italic;
  overflow-wrap: anywhere;
}

.questions-card {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  overflow-wrap: anywhere;
}
.questions-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.questions-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #b45309;
}
.ask-agent-question-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 500;
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ask-agent-question-btn:hover {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1e40af;
}
.questions-ul {
  margin: 6px 0 0;
  padding-left: 20px;
  font-size: 12px;
  color: #92400e;
}

.review-sign-bar {
  margin-top: 8px;
  padding: 4px 8px;
  font-size: 11px;
  color: #059669;
  background: #ecfdf5;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.sign-reviewer {
  font-weight: 600;
}
.sign-date {
  color: #10b981;
}
.sign-comment {
  color: #047857;
}

.point-agent-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed #e2e8f0;
}
.point-agent-label {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
}
.point-agent-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
  background: #ffffff;
}
.point-agent-btn.qa {
  color: #c2410c;
  border-color: #fed7aa;
}
.point-agent-btn.qa:hover {
  background: #fff7ed;
  border-color: #fb923c;
}
.point-agent-btn.analyst {
  color: #0369a1;
  border-color: #bae6fd;
}
.point-agent-btn.analyst:hover {
  background: #f0f9ff;
  border-color: #38bdf8;
}
.point-agent-btn.reviewer {
  color: #15803d;
  border-color: #bbf7d0;
}
.point-agent-btn.reviewer:hover {
  background: #f0fdf4;
  border-color: #4ade80;
}
</style>
