<script setup lang="ts">
import type { Chunk, RequirementAnalysisSection, TestPoint } from "../../types";
import TestPointCard from "./TestPointCard.vue";

const props = defineProps<{
  section: RequirementAnalysisSection;
  chunksById: Map<string, Chunk>;
  busy: boolean;
}>();

const emit = defineEmits<{
  openEditor: [point: TestPoint, reqId: string];
  quickConfirm: [point: TestPoint, reqId: string];
  quickExclude: [point: TestPoint, reqId: string];
  focusPoint: [point: TestPoint, section: any];
  askAgentForQuestions: [section: any];
  askAgentForPointQuestions: [point: TestPoint, section: any];
  consultPoint: [point: TestPoint, section: any];
}>();
</script>

<template>
  <article :id="`analysis-section-${section.reqId}`" class="analysis-section">
    <div class="section-heading">
      <span class="mono req-id">{{ section.reqId }}</span>
      <strong>{{
        chunksById.get(section.reqId)?.sectionPath || "未找到对应条款"
      }}</strong>
      <span class="text-dim small-text"
        >{{ section.points.length }} 个测试点</span
      >
    </div>
    <details v-if="chunksById.has(section.reqId)" class="origin">
      <summary>查看条款原文</summary>
      <div class="pre-wrap">{{ chunksById.get(section.reqId)?.text }}</div>
    </details>
    <div v-if="section.questions.length" class="questions">
      <div class="questions-head">
        <strong>条款级待确认问题</strong>
        <button
          type="button"
          class="ask-agent-question-btn"
          title="结合上下文整理待澄清问题"
          @click="emit('askAgentForQuestions', section)"
        >
          整理澄清问题
        </button>
      </div>
      <ul>
        <li v-for="(question, index) in section.questions" :key="index">
          {{ question }}
        </li>
      </ul>
    </div>
    <div v-if="section.notTestableReason" class="reason pre-wrap">
      <strong>不适用理由：</strong>{{ section.notTestableReason }}
    </div>
    <div v-if="!section.points.length" class="text-dim small-text">
      本条款暂无测试点，请结合待确认问题或不适用理由核对。
    </div>

    <TestPointCard
      v-for="point in section.points"
      :key="point.id"
      :point="point"
      :section="section"
      :busy="busy"
      @open-editor="(p, r) => emit('openEditor', p, r)"
      @quick-confirm="(p, r) => emit('quickConfirm', p, r)"
      @quick-exclude="(p, r) => emit('quickExclude', p, r)"
      @focus-point="(p, s) => emit('focusPoint', p, s)"
      @ask-agent-for-point-questions="(p, s) => emit('askAgentForPointQuestions', p, s)"
      @consult-point="(p, s) => emit('consultPoint', p, s)"
    />
  </article>
</template>

<style scoped>
.analysis-section {
  padding: 14px 0;
  font-size: 13px;
  line-height: 1.7;
}
.analysis-section + .analysis-section {
  border-top: 1px solid var(--tp-border);
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.req-id {
  color: var(--tp-accent);
  background: rgba(69, 107, 145, 0.12);
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}
.small-text,
.origin {
  font-size: 12px;
}
.origin {
  margin: 8px 0;
  color: var(--tp-text-dim);
}
.origin summary {
  cursor: pointer;
}
.origin .pre-wrap {
  margin-top: 8px;
}
.pre-wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.questions,
.reason {
  margin: 10px 0;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--tp-panel-2);
  overflow-wrap: anywhere;
}
.questions-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
.questions ul {
  margin: 4px 0 0;
  padding-left: 20px;
}
</style>
