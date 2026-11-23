<script setup lang="ts">
import { NCheckbox, NInput, NModal } from "naive-ui";

const props = defineProps<{
  show: boolean;
  reviewer: string;
  onlyClear: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
  "update:reviewer": [value: string];
  "update:onlyClear": [value: boolean];
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
    @positive-click="emit('confirm')"
  >
    <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
      <p class="small-text text-dim">
        人工认可当前所有已通过原文定位校验的测试点，赋予人工核对记录，以便进入下一步用例生成。
        尚有疑问的测试点需逐项填写澄清结论，本次批量操作会跳过。
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
    </div>
  </n-modal>
</template>

<style scoped>
.small-text {
  font-size: 12px;
}
</style>
