<script setup lang="ts">
import { NButton } from "naive-ui";
import { currentRequirementId } from "../../stores/workspace";
import CaseFilterBar from "./components/CaseFilterBar.vue";
import CaseBatchToolbar from "./components/CaseBatchToolbar.vue";
import CaseDataTable from "./components/CaseDataTable.vue";
import CaseOverviewPanel from "./components/CaseOverviewPanel.vue";
import CaseEditDrawer from "./components/CaseEditDrawer.vue";
import { useCases } from "./composables/useCases";

const {
  loading,
  generating,
  recheckingAll,
  recheckedCount,
  progress,
  selected,
  estimate,
  duplicates,
  coverage,
  filterCategory,
  filterState,
  filterVerdict,
  keyword,
  editingCase,
  selectedCaseIds,
  isAllSelected,
  stats,
  gapRows,
  filtered,
  clearFilters,
  toggleSelectAll,
  toggleSelectCase,
  clearSelection,
  onRowSelect,
  dispatchCaseToRole,
  askAgentReviewLibrary,
  askAgentReviewSelection,
  generateWithAgent,
  generate,
  patchCase,
  assessCase,
  addCase,
  removeCase,
  recheckAll,
  exportAs,
  openEditor,
  closeEditor,
  mergeDuplicateGroup,
  mergeAllDuplicates,
} = useCases();
</script>

<template>
  <div class="page cases-page">
    <div v-if="!currentRequirementId" class="empty">
      请先在「需求资料」导入并选择需求版本
    </div>

    <template v-else>
      <CaseBatchToolbar
        v-model:selected="selected"
        :generating="generating"
        :rechecking-all="recheckingAll"
        :progress="progress"
        :estimate="estimate"
        @generate-with-agent="generateWithAgent"
        @generate="generate"
        @open-editor="openEditor"
      />

      <CaseOverviewPanel
        :stats="stats"
        :gap-rows="gapRows"
        :duplicates="duplicates"
        :coverage="coverage"
        @open-editor="openEditor"
        @merge-group="mergeDuplicateGroup"
        @merge-all="mergeAllDuplicates"
      />

      <CaseDataTable
        :filtered="filtered"
        :loading="loading"
        :selected-case-ids="selectedCaseIds"
        :is-all-selected="isAllSelected"
        :rechecking-all="recheckingAll"
        :rechecked-count="recheckedCount"
        :generating="generating"
        @open-editor="openEditor"
        @remove-case="removeCase"
        @row-select="onRowSelect"
        @toggle-select-all="toggleSelectAll"
        @toggle-select-case="toggleSelectCase"
        @clear-selection="clearSelection"
        @patch-case="patchCase"
        @assess-case="assessCase"
        @dispatch-to-role="dispatchCaseToRole"
        @review-library="askAgentReviewLibrary"
        @add-case="addCase"
        @recheck-all="recheckAll"
        @export-as="exportAs"
        @ask-review-selection="askAgentReviewSelection"
      >
        <template #filter-bar>
          <CaseFilterBar
            v-model:filter-category="filterCategory"
            v-model:filter-state="filterState"
            v-model:filter-verdict="filterVerdict"
            v-model:keyword="keyword"
            :filtered-count="filtered.length"
            :total-count="stats.total"
            @clear="clearFilters"
          />
        </template>
        <template #clear-filter-btn>
          <n-button size="small" text type="primary" @click="clearFilters">清空筛选</n-button>
        </template>
      </CaseDataTable>
    </template>

    <CaseEditDrawer
      :case-item="editingCase"
      @close="closeEditor"
      @dispatch-to-role="dispatchCaseToRole"
    />
  </div>
</template>

<style scoped>
.cases-page {
  min-width: 0;
}
</style>
