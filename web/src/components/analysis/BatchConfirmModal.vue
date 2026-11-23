<script setup lang="ts">
import { NCheckbox, NInput, NModal } from "naive-ui";

const props = defineProps<{
  show: boolean;
  reviewer: string;
  onlyClear: boolean;
  comment: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
  "update:reviewer": [value: string];
  "update:onlyClear": [value: boolean];
  "update:comment": [value: string];
  confirm: [];
}>();
</script>

<template>
  <n-modal
    :show="show"
    preset="dialog"
    title="批量确认测试点"
    positive-text="确认并保存"
    negative-text="取消"
    :loading="loading"
    @update:show="(val) => emit('update:show', val)"
    @positive-click="() => { emit('confirm'); return false }"
  >
    <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
      <p class="small-text text-dim">
        人工认可当前所有已通过原文定位校验的测试点，赋予人工核对记录，以便进入下一步用例生成。
        勾选「仅确认无疑问」会跳过带疑问的测试点；取消勾选则用下方统一澄清结论一并确认带疑问的测试点。
      </p>
      <div>
        <label style="display: block; font-size: 12px; margin-bottom: 4px; font-weight: 500;">
          核对人姓名（必填）
        </label>
        <n-input
          :value="reviewer"
          placeholder="例如：测试员 / 姓名"
          size="small"
          @update:value="(val) => emit('update:reviewer', val)"
        />
      </div>
      <div>
        <n-checkbox
          :checked="onlyClear"
          @update:checked="(val) => emit('update:onlyClear', val)"
        >
          仅确认无疑问的测试点（暂缓带疑问的测试点）
        </n-checkbox>
      </div>
      <div v-if="!onlyClear">
        <label style="display: block; font-size: 12px; margin-bottom: 4px; font-weight: 500;">
          统一澄清结论（确认带疑问测试点时必填）
        </label>
        <n-input
          :value="comment"
          type="textarea"
          placeholder="例如：越权查询一律拒绝，不返回他人记录；具体提示文案以接口规范为准。"
          size="small"
          :autosize="{ minRows: 2, maxRows: 4 }"
          @update:value="(val) => emit('update:comment', val)"
        />
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.small-text {
  font-size: 12px;
}
</style>
