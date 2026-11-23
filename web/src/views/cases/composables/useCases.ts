import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useDialog, useMessage } from "naive-ui";
import { api, streamGenerate, type AgentRole } from "../../../api/client";
import {
  bumpCases,
  cases,
  casesRevision,
  currentRequirement,
  currentRequirementId,
  highlightedCaseId,
  sendToAgent,
  setCanvasFocus,
} from "../../../stores/workspace";
import {
  AGENT_ROLES,
  CATEGORY_LABEL,
  assessmentOf,
  evidenceNeedsRecheck,
  evidenceStateOf,
  type Assessment,
  type Category,
  type EvidenceState,
  type Priority,
  type RevisionCost,
  type TestCase,
  type Verdict,
} from "../../../types";

export function useCases() {
  const message = useMessage();
  const dialog = useDialog();

  const ALL: Category[] = ["normal", "abnormal", "boundary", "permission"];

  const loading = ref(false);
  const generating = ref(false);
  const recheckingAll = ref(false);
  const recheckedCount = ref(0);
  const progress = ref({ done: 0, total: 0, message: "" });
  const selected = ref<Category[]>([...ALL]);
  const estimate = ref<{
    chunks: number;
    points: number;
    scenarios: number;
    pending: number;
    excluded: number;
    batches: number;
    calls: number;
  } | null>(null);

  const assumptions = ref<string[]>([]);
  const duplicates = ref<
    { caseIds: string[]; title: string; reason: string; score: number }[]
  >([]);

  const filterCategory = ref<"all" | Category>("all");
  const filterState = ref<"all" | EvidenceState>("all");
  const filterVerdict = ref<"all" | Verdict>("all");
  const keyword = ref("");

  const editingCase = ref<TestCase | null>(null);

  function clearFilters() {
    filterCategory.value = "all";
    filterState.value = "all";
    filterVerdict.value = "all";
    keyword.value = "";
  }

  function overallOf(c: TestCase): EvidenceState {
    return evidenceStateOf(c.evidence);
  }

  let casesRequestId = 0;
  async function loadCases() {
    const requestId = ++casesRequestId;
    const requirementId = currentRequirementId.value;
    const categories = [...selected.value];
    if (!requirementId) {
      cases.value = [];
      duplicates.value = [];
      estimate.value = null;
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const [items, repeated, plan] = await Promise.all([
        api.listCases(requirementId),
        api.listDuplicates(requirementId),
        api.estimateGenerate(requirementId, categories),
      ]);
      if (
        requestId !== casesRequestId ||
        requirementId !== currentRequirementId.value
      )
        return;
      cases.value = items;
      duplicates.value = repeated;
      estimate.value = plan;
    } catch (error) {
      if (requestId === casesRequestId) message.error((error as Error).message);
    } finally {
      if (requestId === casesRequestId) loading.value = false;
    }
  }

  watch(currentRequirementId, loadCases);
  watch(casesRevision, async () => {
    const requirementId = currentRequirementId.value;
    if (!requirementId) return;
    await loadCases();
  });
  watch(selected, loadCases);
  onMounted(loadCases);
  watch(
    () => currentRequirement.value?.analysis?.updatedAt,
    () => {
      void loadCases();
    },
  );

  const stats = computed(() => {
    const byState: Record<EvidenceState, number> = {
      explicit: 0,
      inferred: 0,
      unknown: 0,
    };
    let pending = 0;
    let pendingValidation = 0;
    for (const c of cases.value) {
      if (evidenceNeedsRecheck(c.evidence)) pendingValidation++;
      else byState[overallOf(c)]++;
      if (assessmentOf(c).verdict === "unreviewed") pending++;
    }
    return {
      total: cases.value.length,
      byState,
      pending,
      pendingValidation,
    };
  });

  const gapRows = computed(() => {
    const byText = new Map<
      string,
      { text: string; caseIds: string[]; reqIds: string[] }
    >();
    const keyOf = (text: string) => {
      if (/订单编号/.test(text) && /(长度|最大值|最小值)/.test(text))
        return "order-id-length";
      if (/pagesize/i.test(text)) return "page-size-range";
      if (/订单金额/.test(text)) return "order-amount-range";
      return text.replace(/[\s，。；、]/g, "").toLowerCase();
    };
    for (const c of cases.value)
      for (const text of c.assumptions ?? []) {
        const key = keyOf(text);
        const gap = byText.get(key) ?? { text, caseIds: [], reqIds: [] };
        if (!gap.caseIds.includes(c.id)) gap.caseIds.push(c.id);
        for (const e of c.evidence)
          if (!gap.reqIds.includes(e.reqId)) gap.reqIds.push(e.reqId);
        byText.set(key, gap);
      }
    for (const text of assumptions.value)
      if (!byText.has(keyOf(text)))
        byText.set(keyOf(text), { text, caseIds: [], reqIds: [] });
    return [...byText.values()];
  });


  const filtered = computed(() =>
    cases.value.filter((c) => {
      if (filterCategory.value !== "all" && c.category !== filterCategory.value)
        return false;
      if (filterState.value !== "all" && overallOf(c) !== filterState.value)
        return false;
      if (
        filterVerdict.value !== "all" &&
        assessmentOf(c).verdict !== filterVerdict.value
      )
        return false;
      const k = keyword.value.trim().toLowerCase();
      if (k && !`${c.title} ${c.module} ${c.title}`.toLowerCase().includes(k))
        return false;
      return true;
    }),
  );

  const selectedCaseIds = ref<Set<string>>(new Set());

  const isAllSelected = computed(() => {
    if (!filtered.value.length) return false;
    return filtered.value.every((c) => selectedCaseIds.value.has(c.id));
  });

  function toggleSelectAll() {
    if (isAllSelected.value) {
      selectedCaseIds.value.clear();
    } else {
      filtered.value.forEach((c) => selectedCaseIds.value.add(c.id));
    }
  }

  function toggleSelectCase(id: string) {
    if (selectedCaseIds.value.has(id)) {
      selectedCaseIds.value.delete(id);
    } else {
      selectedCaseIds.value.add(id);
    }
  }

  function clearSelection() {
    selectedCaseIds.value.clear();
  }

  watch([highlightedCaseId, cases], ([id]) => {
    if (!id) return;
    nextTick(() => {
      const el = document.querySelector(`tr[data-case-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  });

  function onRowSelect(c: TestCase) {
    setCanvasFocus({
      type: "case",
      id: c.id,
      title: c.title,
      subtitle: `${c.priority} · ${c.module || "默认模块"}`,
      meta: c,
    });
  }

  function dispatchCaseToRole(c: TestCase, role: AgentRole) {
    onRowSelect(c);
    const stepsStr = c.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const expStr = c.expected.map((e, i) => `${i + 1}. ${e}`).join("\n");
    const caseSnapshot = `【用例标题】：${c.title} (ID: ${c.id}, 优先级: ${c.priority}, 分类: ${CATEGORY_LABEL[c.category] || c.category}, 模块: ${c.module || "未分模块"})\n【前置条件】：${c.precondition || "无"}\n【操作步骤】：\n${stepsStr}\n【预期结果】：\n${expStr}`;

    const task = role === "reviewer"
      ? '检查这条用例的原文依据、前置条件、步骤、可判定预期和重复风险。只输出问题及修改建议，不调用 update_case、add_case 或 generate_cases；不代替人工评审。'
      : role === "qa_expert"
        ? '按原文依据优化当前这一条用例的前置条件、步骤和预期，使用 update_case 保存到该 caseId。保持验证目标，不新增用例；缺少规则时说明待澄清问题，停止改写。'
        : '结合原文核对该用例对应的业务规则和待澄清问题，不新增或修改用例。';
    const prompt = AGENT_ROLES[role].label + '：' + task + '\n\n' + caseSnapshot;

    sendToAgent({
      prompt,
      role,
      autoSend: true,
      focus: {
        type: "case",
        id: c.id,
        title: c.title,
        subtitle: `${c.priority} · ${c.module || "默认模块"}`,
        meta: c,
      },
      source: `case-${role}`,
    });
  }

  function consultAgentForCase(c: TestCase) {
    dispatchCaseToRole(c, "reviewer");
  }

  function askAgentReviewLibrary() {
    if (!currentRequirement.value) {
      message.warning("请先选择需求版本");
      return;
    }
    sendToAgent({
      prompt: AGENT_ROLES.reviewer.label + '：请调用 review_cases 检查当前需求的测试用例，保存质量报告。检查依据、步骤、预期、引用覆盖和重复项；只给出修改建议，不新增、修改用例或代替人工评审。',
      role: "reviewer",
      autoSend: true,
      source: "cases-quality-review",
    });
  }

  function askAgentReviewSelection() {
    const selectedList = filtered.value.filter((c) =>
      selectedCaseIds.value.has(c.id),
    );
    if (!selectedList.length) return;
    const summaryList = selectedList
      .map(
        (c, i) =>
          `${i + 1}. 【${c.title}】(ID: "${c.id}", ${CATEGORY_LABEL[c.category]}, ${c.priority})\n   步骤: ${c.steps.join(" → ")}\n   预期: ${c.expected.join("；")}`,
      )
      .join("\n");
    const prompt = AGENT_ROLES.reviewer.label + '：仅检查以下所选用例的原文依据、步骤、预期和重复风险，输出问题与修改建议。不要调用全量 review_cases，不新增或修改用例，不代替人工评审。\n\n' + summaryList;

    sendToAgent({
      prompt,
      role: "reviewer",
      autoSend: true,
      source: "batch-review",
    });
  }

  function generateWithAgent() {
    sendToAgent({
      prompt: `请按已人工确认测试点生成用例，场景范围仅限：${selected.value.join("、")}。复用 generate_cases，保留原文依据和来源。`,
      role: "qa_expert",
      autoSend: true,
      source: "case-generation",
    });
  }

  async function generate(overwrite: boolean) {
    if (!currentRequirementId.value) return;
    if (!selected.value.length) {
      message.warning("至少选择一个场景类型");
      return;
    }
    if (overwrite) {
      dialog.warning({
        title: "重新生成",
        content:
          "按已确认测试点生成并复核，全部批次成功后才替换已有用例；失败会保留原有用例。",
        positiveText: "生成并替换",
        negativeText: "取消",
        onPositiveClick: () => runGenerate(true),
      });
      return;
    }
    await runGenerate(false);
  }

  async function runGenerate(overwrite: boolean) {
    if (!currentRequirementId.value) return;
    const requirementId = currentRequirementId.value;
    let receivedCase = false;
    let completed = false;
    let reportedError = false;
    generating.value = true;
    assumptions.value = [];
    progress.value = { done: 0, total: 0, message: "连接模型…" };
    try {
      await streamGenerate(
        { requirementId, categories: selected.value, overwrite },
        (evt) => {
          if (currentRequirementId.value !== requirementId) return;
          if (evt.type === "progress")
            progress.value = {
              done: evt.done ?? 0,
              total: evt.total ?? 0,
              message: evt.message ?? "",
            };
          else if (evt.type === "case" && evt.data) {
            if (overwrite && !receivedCase) cases.value = [];
            receivedCase = true;
            const idx = cases.value.findIndex((c) => c.id === evt.data!.id);
            if (idx >= 0) {
              cases.value[idx] = evt.data;
            } else {
              cases.value.push(evt.data);
            }
          } else if (evt.type === "assumption")
            assumptions.value = evt.items ?? [];
          else if (evt.type === "done") {
            completed = true;
            api.listDuplicates(requirementId).then((d) => { duplicates.value = d; }).catch(() => {});
            const summary = evt.summary;
            const warning = summary?.unverified
              ? "，其中 " + summary.unverified + " 条依据不足，需人工核对"
              : "";
            if (summary?.errors)
              message.warning(
                "部分完成：保存 " +
                  summary.total +
                  " 条，" +
                  summary.errors +
                  " 批失败" +
                  warning,
              );
            else
              message.success(
                "生成完成：保存 " + (summary?.total ?? 0) + " 条用例" + warning,
              );
          } else if (evt.type === "error") {
            reportedError = true;
            message.error(evt.message ?? "生成失败");
          }
        },
      );
      if (
        !completed &&
        !reportedError &&
        currentRequirementId.value === requirementId
      )
        message.warning(
          "生成连接已结束但未收到完成结果，请刷新列表重试",
        );
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      generating.value = false;
      progress.value = { done: 0, total: 0, message: "" };
      bumpCases();
      if (currentRequirementId.value === requirementId) await loadCases();
    }
  }

  async function patchCase(c: TestCase, patch: Partial<TestCase>) {
    try {
      const updated = await api.updateCase(c.id, patch);
      Object.assign(c, updated);
      bumpCases();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function assessCase(
    c: TestCase,
    patch: Partial<Assessment>,
  ): Promise<boolean> {
    const reviewer = localStorage.getItem("tp.reviewer") ?? "";
    const payload = reviewer.trim()
      ? { reviewer: reviewer.trim(), ...patch }
      : patch;
    try {
      const updated = await api.assessCase(c.id, payload);
      Object.assign(c, updated);
      bumpCases();
      return true;
    } catch (e) {
      message.error((e as Error).message);
      return false;
    }
  }

  async function addCase() {
    if (!currentRequirementId.value) {
      message.warning("请先选择需求版本");
      return;
    }
    try {
      const created = await api.createCase(currentRequirementId.value, {
        title: "新用例",
        category: "normal",
        priority: "P1",
        steps: [""],
        expected: [""],
      });
      cases.value.push(created);
      bumpCases();
      editingCase.value = created;
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  function removeCase(c: TestCase) {
    dialog.warning({
      title: "删除用例",
      content: `确认删除「${c.title}」？`,
      positiveText: "删除",
      negativeText: "取消",
      onPositiveClick: async () => {
        try {
          await api.deleteCase(c.id);
          cases.value = cases.value.filter((x) => x.id !== c.id);
          bumpCases();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  }

  async function recheck(c: TestCase) {
    try {
      const updated = await api.recheckCase(c.id);
      Object.assign(c, updated);
      bumpCases();
      message.success("依据已重新校验");
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function recheckAll() {
    if (recheckingAll.value || generating.value) return;
    recheckingAll.value = true;
    recheckedCount.value = 0;
    let failed = 0;
    try {
      for (let i = 0; i < cases.value.length; i += 3) {
        await Promise.all(
          cases.value.slice(i, i + 3).map(async (c) => {
            try {
              Object.assign(c, await api.recheckCase(c.id));
              recheckedCount.value++;
            } catch {
              failed++;
            }
          }),
        );
      }
      bumpCases();
      if (failed)
        message.warning(
          `已重新校验 ${recheckedCount.value} 条，${failed} 条失败，请稍后重试`,
        );
      else message.success(`已重新校验 ${recheckedCount.value} 条依据`);
    } finally {
      recheckingAll.value = false;
    }
  }

  function exportAs(format: "xlsx" | "csv") {
    if (!currentRequirementId.value) return;
    const url = `/api/requirements/${currentRequirementId.value}/export?format=${format}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function openEditor(c: TestCase) {
    editingCase.value = c;
  }

  function closeEditor() {
    editingCase.value = null;
  }

  const mergingDuplicates = ref(false);

  async function mergeDuplicateGroup(caseIds: string[]) {
    if (!currentRequirementId.value || caseIds.length < 2) return;
    mergingDuplicates.value = true;
    try {
      const res = await api.mergeDuplicates(currentRequirementId.value, caseIds);
      message.success(`已成功合并该组用例，整合了条款依据与测试步骤（去重清理 ${res.removedCount} 条）`);
      const removedSet = new Set(res.removedIds);
      cases.value = cases.value.filter((c) => !removedSet.has(c.id));
      for (const m of res.mergedCases) {
        const idx = cases.value.findIndex((c) => c.id === m.id);
        if (idx >= 0) cases.value[idx] = m;
        else cases.value.push(m);
      }
      duplicates.value = await api.listDuplicates(currentRequirementId.value);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '合并重复用例失败');
    } finally {
      mergingDuplicates.value = false;
    }
  }

  async function mergeAllDuplicates() {
    if (!currentRequirementId.value || !duplicates.value.length) return;
    mergingDuplicates.value = true;
    try {
      const res = await api.mergeDuplicates(currentRequirementId.value);
      if (res.removedCount > 0) {
        message.success(`已一键合并所有疑似重复用例（共合并 ${res.mergedCount} 条，去重清理 ${res.removedCount} 条）`);
        const removedSet = new Set(res.removedIds);
        cases.value = cases.value.filter((c) => !removedSet.has(c.id));
        for (const m of res.mergedCases) {
          const idx = cases.value.findIndex((c) => c.id === m.id);
          if (idx >= 0) cases.value[idx] = m;
          else cases.value.push(m);
        }
      } else {
        message.info('未发现需要自动合并的重复用例');
      }
      duplicates.value = await api.listDuplicates(currentRequirementId.value);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '一键合并失败');
    } finally {
      mergingDuplicates.value = false;
    }
  }

  return {
    loading,
    generating,
    mergingDuplicates,
    recheckingAll,
    recheckedCount,
    progress,
    selected,
    estimate,
    assumptions,
    duplicates,
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
    loadCases,
    toggleSelectAll,
    toggleSelectCase,
    clearSelection,
    onRowSelect,
    dispatchCaseToRole,
    consultAgentForCase,
    askAgentReviewLibrary,
    askAgentReviewSelection,
    generateWithAgent,
    generate,
    patchCase,
    assessCase,
    addCase,
    removeCase,
    recheck,
    recheckAll,
    exportAs,
    openEditor,
    closeEditor,
    mergeDuplicateGroup,
    mergeAllDuplicates,
  };
}
