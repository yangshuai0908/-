<script setup lang="ts">
import { computed } from "vue";
import {
  NAlert,
  NButton,
  NDrawer,
  NDrawerContent,
  NInput,
  NSelect,
} from "naive-ui";
import {
  CATEGORY_LABEL,
  type Category,
  type Chunk,
  type TestPoint,
} from "../../types";

export interface PointDraft {
  analysisId: string;
  analysisUpdatedAt: string;
  pointId: string;
  reviewer: string;
  comment: string;
  title: string;
  category: Category;
  objective: string;
  questionsText: string;
  evidence: { reqId: string; quote: string }[];
}

const props = defineProps<{
  draft: PointDraft | null;
  busy: boolean;
  saving: boolean;
  editorError: string;
  chunks: Chunk[];
  chunksById: Map<string, Chunk>;
  chunkOptions: { label: string; value: string }[];
}>();

const emit = defineEmits<{
  close: [];
  save: [status?: TestPoint["status"]];
}>();

const categoryOptions = (Object.keys(CATEGORY_LABEL) as Category[]).map(
  (category) => ({
    label: CATEGORY_LABEL[category],
    value: category,
  }),
);

function addEvidence() {
  if (!props.draft) return;
  props.draft.evidence.push({
    reqId: props.chunks[0]?.reqId ?? "",
    quote: "",
  });
}

function removeEvidence(index: number) {
  if (!props.draft || props.draft.evidence.length <= 1) return;
  props.draft.evidence.splice(index, 1);
}
</script>

<template>
  <n-drawer
    :show="Boolean(draft)"
    placement="right"
    :width="660"
    style="max-width: 100vw"
    :mask-closable="!busy"
    :close-on-esc="!busy"
    @update:show="(show) => !show && emit('close')"
  >
    <n-drawer-content v-if="draft" title="编辑测试点" :closable="!busy">
      <n-alert type="info" :show-icon="false" class="notice">
        内容修改后默认保存为待确认。确认仅表示人工认可测试目标，不消除待确认问题，也不自动校验规则；确认时所有引用必须通过后端原文定位校验。
      </n-alert>
      <n-alert v-if="editorError" type="error" class="notice">{{
        editorError
      }}</n-alert>
      <div class="form">
        <label>核对人（确认时必填）</label>
        <n-input v-model:value="draft.reviewer" :disabled="busy" placeholder="填写姓名" size="small" />
        <label>人工澄清结论 / 核对说明（存在疑问时必填）</label>
        <n-input v-model:value="draft.comment" type="textarea" :disabled="busy" :autosize="{ minRows: 2 }" size="small" />
        <label>测试点名称</label>
        <n-input v-model:value="draft.title" :disabled="busy" size="small" />
        <label>分类</label>
        <n-select
          v-model:value="draft.category"
          :options="categoryOptions"
          :disabled="busy"
          size="small"
        />
        <label>验证目标</label>
        <n-input
          v-model:value="draft.objective"
          type="textarea"
          :autosize="{ minRows: 3 }"
          :disabled="busy"
          size="small"
        />
        <label>待确认问题（一行一条）</label>
        <n-input
          v-model:value="draft.questionsText"
          type="textarea"
          :autosize="{ minRows: 2 }"
          :disabled="busy"
          size="small"
        />
        <label>原文引用（至少一条）</label>
        <div class="text-dim small-text">
          可从下方条款原文复制引用；定位结果以保存时的后端校验为准，定位成功不等于目标已获支持。
        </div>
        <div
          v-for="(evidence, index) in draft.evidence"
          :key="index"
          class="evidence-editor"
        >
          <div class="evidence-head">
            <span class="small-text">引用 {{ index + 1 }}</span>
            <n-button
              size="tiny"
              quaternary
              type="error"
              :disabled="busy || draft.evidence.length <= 1"
              @click="removeEvidence(index)"
              >删除引用</n-button
            >
          </div>
          <n-select
            v-model:value="evidence.reqId"
            :options="chunkOptions"
            filterable
            placeholder="选择引用条款"
            :disabled="busy"
            size="small"
          />
          <n-input
            v-model:value="evidence.quote"
            type="textarea"
            :autosize="{ minRows: 2 }"
            placeholder="填写引用的原文"
            :disabled="busy"
            size="small"
          />
          <details class="origin">
            <summary>查看引用条款原文</summary>
            <div class="pre-wrap">
              {{
                chunksById.get(evidence.reqId)?.text ||
                "未找到对应条款，请重新选择"
              }}
            </div>
          </details>
        </div>
        <n-button
          size="small"
          dashed
          :disabled="busy"
          @click="addEvidence"
          >新增引用</n-button
        >
      </div>
      <template #footer>
        <div class="drawer-actions">
          <n-button size="small" :disabled="busy" @click="emit('close')"
            >取消</n-button
          >
          <n-button
            size="small"
            :disabled="busy"
            @click="emit('save', 'excluded')"
            >排除测试点</n-button
          >
          <n-button
            size="small"
            type="success"
            :disabled="busy"
            @click="emit('save', 'confirmed')"
            >确认测试点</n-button
          >
          <n-button
            size="small"
            type="primary"
            :loading="saving"
            :disabled="busy"
            @click="emit('save')"
            >保存为待确认</n-button
          >
        </div>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.evidence-head,
.drawer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.small-text,
.origin {
  font-size: 12px;
}
.notice {
  margin-bottom: 12px;
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
.evidence-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--tp-border);
  border-radius: 6px;
  padding: 10px;
}
.evidence-head {
  justify-content: space-between;
  margin-bottom: 6px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form > label {
  margin-top: 8px;
  color: var(--tp-text-dim);
  font-size: 12px;
}
.drawer-actions {
  justify-content: flex-end;
  width: 100%;
}
</style>
