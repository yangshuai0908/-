<script setup lang="ts">
const props = defineProps<{
  duplicates: Array<{
    title: string;
    reason: string;
    caseIds: string[];
  }>;
  caseTitle: (id: string) => string;
}>();

const emit = defineEmits<{
  askAgentForDuplicateFix: [d: { title: string; reason: string; caseIds: string[] }];
  mergeDuplicateGroup: [caseIds: string[]];
  mergeAllDuplicates: [];
}>();
</script>

<template>
  <div class="panel">
    <div class="dup-top-bar">
      <h3 class="section-title">
        疑似重复（{{ props.duplicates.length }} 组）
      </h3>
      <button
        v-if="props.duplicates.length"
        type="button"
        class="dup-merge-all-btn"
        title="一键合并所有疑似重复用例"
        @click="emit('mergeAllDuplicates')"
      >
        一键合并全部重复
      </button>
    </div>
    <div
      v-if="!props.duplicates.length"
      class="empty"
      style="padding: 20px 0"
    >
      没有发现重复用例
    </div>
    <div v-for="(d, i) in props.duplicates" :key="i" class="dup-item">
      <div class="dup-header">
        <div class="dup-title">{{ d.title }}</div>
        <div class="dup-actions">
          <button
            type="button"
            class="dup-merge-btn"
            title="直接合并该组用例"
            @click="emit('mergeDuplicateGroup', d.caseIds)"
          >
            合并该组
          </button>
          <button
            type="button"
            class="dup-agent-btn"
            title="咨询 Agent 去重与合并建议"
            @click="emit('askAgentForDuplicateFix', d)"
          >
            ✦ AI 合并方案
          </button>
        </div>
      </div>
      <div class="tiny-text text-dim">{{ d.reason }}</div>
      <div class="dup-cases">
        <span v-for="id in d.caseIds" :key="id" class="dup-case mono">{{
          props.caseTitle(id)
        }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tiny-text {
  font-size: 12px;
}

.dup-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.dup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.dup-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dup-merge-all-btn,
.dup-merge-btn {
  border: 1px solid var(--tp-border);
  background: var(--tp-card);
  color: var(--tp-primary, #456b91);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.dup-merge-all-btn:hover,
.dup-merge-btn:hover {
  background: var(--tp-primary, #456b91);
  color: #fff;
  border-color: var(--tp-primary, #456b91);
}

.dup-agent-btn {
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
.dup-agent-btn:hover {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1e40af;
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
</style>
