import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type { useDialog, useMessage } from "naive-ui";
import { api, streamAnalyzeRequirement } from "../../api/client";
import {
  bumpRequirements,
  canvasFocus,
  requirements,
  requirementsRevision,
  sendToAgent,
  setCanvasFocus,
} from "../../stores/workspace";
import {
  AGENT_ROLES,
  isHumanConfirmed,
  type Category,
  type RequirementAnalysis,
  type RequirementVersion,
  type TestPoint,
} from "../../types";
import type { PointDraft } from "./TestPointEditDrawer.vue";

// 切走再切回同一版本时，仍禁用该版本的重复请求；不影响其他版本。
const pendingRequests = reactive(
  new Map<string, "load" | "analyze" | "save">(),
);

export interface AnalysisStreamState {
  batch: number;
  totalBatches: number;
  currentChunks: { reqId: string; sectionPath: string }[];
  totalPoints: number;
  message: string;
  logs: string[];
}

export function useRequirementAnalysis(
  props: { requirement: RequirementVersion },
  emit: (evt: "refresh") => void,
  dialog: ReturnType<typeof useDialog>,
  message: ReturnType<typeof useMessage>,
) {
  // 父组件以 requirement.id 挂 key，所有异步回写都使用请求发起时的版本。
  const requirementId = props.requirement.id;
  const projectId = props.requirement.projectId;
  const versionLabel = props.requirement.label;
  const analysis = computed(() => props.requirement.analysis ?? null);
  const operation = computed(() => pendingRequests.get(requirementId));
  const busy = computed(() => Boolean(operation.value));
  const hasContent = computed(() =>
    props.requirement.chunks.some((chunk) => chunk.text.trim()),
  );
  const error = ref("");
  const loadFailed = ref(false);
  const editorError = ref("");
  let active = true;
  let confirmation: ReturnType<typeof dialog.warning> | null = null;

  const analysisProgress = ref<AnalysisStreamState | null>(null);

  const showBatchModal = ref(false);
  const batchReviewer = ref("测试员");
  const batchOnlyClear = ref(true);
  const batchConfirming = ref(false);

  function openBatchConfirmModal() {
    batchReviewer.value = "测试员";
    showBatchModal.value = true;
  }

  async function executeBatchConfirm() {
    if (!batchReviewer.value.trim()) {
      message.warning("请填写核对人姓名");
      return;
    }
    batchConfirming.value = true;
    try {
      const previousStamp = stamp(analysis.value);
      const res = await api.batchConfirmRequirementPoints(requirementId, {
        reviewer: batchReviewer.value.trim(),
        onlyClear: batchOnlyClear.value,
      });
      writeAnalysis(res.analysis, previousStamp);
      message.success(`已批量确认 ${res.confirmedCount} 个测试点；带待澄清问题的测试点需逐项填写澄清结论。`);
      showBatchModal.value = false;
      bumpRequirements();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "批量确认失败");
    } finally {
      batchConfirming.value = false;
    }
  }

  const draft = ref<PointDraft | null>(null);
  const chunkOptions = computed(() =>
    props.requirement.chunks.map((chunk) => ({
      label: `${chunk.reqId} · ${chunk.sectionPath}`,
      value: chunk.reqId,
    })),
  );
  const chunksById = computed(
    () => new Map(props.requirement.chunks.map((chunk) => [chunk.reqId, chunk])),
  );

  const counts = computed(() => {
    const result = { pending: 0, confirmed: 0, excluded: 0 };
    for (const section of analysis.value?.sections ?? []) {
      for (const point of section.points)
        result[point.status === "confirmed" && !isHumanConfirmed(point) ? "pending" : point.status]++;
    }
    return result;
  });

  const pointTotal = computed(() =>
    (analysis.value?.sections ?? []).reduce(
      (sum, section) => sum + section.points.length,
      0,
    ),
  );

  function stamp(value: RequirementAnalysis | null | undefined) {
    return value ? `${value.id}:${value.updatedAt}` : "";
  }

  function writeAnalysis(
    result: RequirementAnalysis | null,
    previousStamp: string,
  ) {
    const target = requirements.value.find(
      (r) => r.id === requirementId && r.projectId === projectId,
    );
    if (!target || stamp(target.analysis) !== previousStamp) return false;
    target.analysis = result ?? undefined;
    return true;
  }

  function errorText(e: unknown) {
    return e instanceof Error ? e.message : "请求失败，请稍后重试";
  }

  async function loadAnalysis(notify = false) {
    if (busy.value) return;
    const previousStamp = stamp(analysis.value);
    pendingRequests.set(requirementId, "load");
    error.value = "";
    try {
      const result = await api.getRequirementAnalysis(requirementId);
      // 读取期间 Agent 或另一请求可能已更新工作区，不能覆盖较新的分析。
      const applied = writeAnalysis(result, previousStamp);
      loadFailed.value = false;
      if (notify && active) {
        if (!applied) message.info("分析结果已在读取期间更新，请再次同步");
        else if (!result) message.info("当前暂无分析结果，请点击「分析需求」");
        else if (stamp(result) === previousStamp)
          message.info("已是最新分析结果，无需更新");
        else message.success("已同步最新分析结果");
      }
    } catch (e) {
      if (active) {
        error.value = `加载分析失败：${errorText(e)}`;
        loadFailed.value = true;
      }
    } finally {
      pendingRequests.delete(requirementId);
    }
  }

  async function analyze(replaceAnalysisId?: string) {
    if (!active || busy.value || !hasContent.value || loadFailed.value) return;
    if (analysis.value?.id !== replaceAnalysisId) {
      error.value = "分析版本已变化，请刷新后重新确认。";
      return;
    }
    const previousStamp = stamp(analysis.value);
    pendingRequests.set(requirementId, "analyze");
    error.value = "";
    const totalChunks = props.requirement.chunks.length;
    const initialBatches = Math.max(1, Math.ceil(totalChunks / 3));
    analysisProgress.value = {
      batch: 0,
      totalBatches: initialBatches,
      currentChunks: [],
      totalPoints: 0,
      message: `准备对 ${totalChunks} 个条款分 ${initialBatches} 批调用模型深入分析…`,
      logs: [`[${new Date().toLocaleTimeString()}] 开始需求分析任务：共 ${totalChunks} 个条款`],
    };
    try {
      const result = await streamAnalyzeRequirement(
        requirementId,
        replaceAnalysisId ? { replaceAnalysisId, force: true } : {},
        (evt) => {
          if (!analysisProgress.value) return;
          if (evt.batch !== undefined) analysisProgress.value.batch = evt.batch;
          if (evt.totalBatches !== undefined) analysisProgress.value.totalBatches = evt.totalBatches;
          if (evt.currentChunks) analysisProgress.value.currentChunks = evt.currentChunks;
          if (evt.totalPoints !== undefined) analysisProgress.value.totalPoints = evt.totalPoints;
          if (evt.message) {
            analysisProgress.value.message = evt.message;
            analysisProgress.value.logs.push(`[${new Date().toLocaleTimeString()}] ${evt.message}`);
          }
        },
      );
      const applied = writeAnalysis(result, previousStamp);
      if (active) {
        if (applied) {
          message.success("需求分析已完成，请逐项核对测试目标");
          bumpRequirements();
        } else {
          error.value =
            "分析已完成，但该版本数据已有新变更，已保留最新分析结果。";
        }
      }
    } catch (e) {
      // 不清空旧结果，重分析失败仍可查看此前的人工核对内容。
      const detail = `分析失败：${errorText(e)}`;
      if (active) error.value = detail;
      else message.error(`「${versionLabel}」${detail}`);
    } finally {
      pendingRequests.delete(requirementId);
    }
  }

  function requestAnalysis() {
    if (busy.value || draft.value || confirmation) return;
    const previous = analysis.value;
    if (!previous) {
      void analyze();
      return;
    }
    confirmation = dialog.warning({
      title: "重新分析需求",
      content: `重新分析「${versionLabel}」将调用真实模型，可能耗时较长。条款内容未变化、或模型给出与上次相同结果的测试点，会保留人工修改及确认／排除状态；有实质变化的测试点重置为待确认。失败则保留原分析。此操作不修改已有用例。是否继续？`,
      positiveText: "确认重新分析",
      negativeText: "取消",
      onPositiveClick: () => {
        void analyze(previous.id);
      },
      onAfterLeave: () => {
        confirmation = null;
      },
    });
  }

  function openEditor(point: TestPoint, reqId: string) {
    if (busy.value || !analysis.value) return;
    editorError.value = "";
    draft.value = {
      analysisId: analysis.value.id,
      analysisUpdatedAt: analysis.value.updatedAt,
      pointId: point.id,
      reviewer: point.review?.actor === "human" ? point.review.reviewer : "",
      comment: point.review?.actor === "human" ? point.review.comment : "",
      title: point.title,
      category: point.category,
      objective: point.objective,
      questionsText: point.questions.join("\n"),
      evidence: point.evidence.length
        ? point.evidence.map(({ reqId: evidenceReqId, quote }) => ({
            reqId: evidenceReqId,
            quote,
          }))
        : [{ reqId, quote: "" }],
    };
  }

  function closeEditor() {
    if (busy.value) return;
    draft.value = null;
    editorError.value = "";
  }

  async function savePoint(status: TestPoint["status"] = "pending") {
    if (busy.value || !draft.value) return;
    const editing = draft.value;
    const analysisId = editing.analysisId;
    const previousStamp = stamp(analysis.value);
    if (analysis.value?.id !== analysisId) {
      editorError.value = "分析版本已变化，请取消并刷新后重新编辑。";
      return;
    }
    pendingRequests.set(requirementId, "save");
    editorError.value = "";
    try {
      const result = await api.updateRequirementAnalysisPoint(
        requirementId,
        editing.pointId,
        {
          analysisId,
          reviewer: editing.reviewer,
          comment: editing.comment,
          analysisUpdatedAt: editing.analysisUpdatedAt,
          title: editing.title.trim(),
          category: editing.category,
          objective: editing.objective.trim(),
          evidence: editing.evidence.map(({ reqId, quote }) => ({
            reqId,
            quote,
          })),
          questions: editing.questionsText
            .split(/\r?\n/)
            .map((q) => q.trim())
            .filter(Boolean),
          status,
        },
      );
      const applied = writeAnalysis(result, previousStamp);
      if (active && draft.value === editing) {
        if (applied) {
          draft.value = null;
          bumpRequirements();
          const statusMap = {
            pending: "待确认",
            confirmed: "已确认",
            excluded: "已排除",
          };
          message.success(`测试点已保存为「${statusMap[status]}」`);
        } else {
          editorError.value =
            "该版本分析已有新更新，已保护当前草稿。请重新核对后保存。";
        }
      }
    } catch (e) {
      if (active) editorError.value = `保存失败：${errorText(e)}`;
      else message.error(`「${versionLabel}」测试点保存失败：${errorText(e)}`);
    } finally {
      pendingRequests.delete(requirementId);
    }
  }

  async function quickConfirmPoint(point: TestPoint, reqId: string) {
    if (busy.value) return;
    if (point.questions?.length) {
      openEditor(point, reqId);
      message.warning("该测试点仍有待澄清问题，请填写人工澄清结论后再确认。");
      return;
    }
    const reviewer = localStorage.getItem("tp_point_reviewer") || "QA人员";
    const analysisId = analysis.value?.id;
    if (!analysisId) return;
    const previousStamp = stamp(analysis.value);

    pendingRequests.set(requirementId, "save");
    try {
      const result = await api.updateRequirementAnalysisPoint(
        requirementId,
        point.id,
        {
          analysisId,
          reviewer,
          comment: point.review?.comment || "人工快速核对确认",
          analysisUpdatedAt: analysis.value?.updatedAt || "",
          title: point.title,
          category: point.category,
          objective: point.objective,
          evidence: point.evidence.map(({ reqId, quote }) => ({ reqId, quote })),
          questions: point.questions || [],
          status: "confirmed",
        },
      );
      writeAnalysis(result, previousStamp);
      bumpRequirements();
      message.success(`测试点「${point.title}」已确认`);
    } catch (e) {
      message.error(`确认失败：${errorText(e)}`);
    } finally {
      pendingRequests.delete(requirementId);
    }
  }

  async function quickExcludePoint(point: TestPoint, reqId: string) {
    if (busy.value) return;
    const reviewer = localStorage.getItem("tp_point_reviewer") || "QA人员";
    const analysisId = analysis.value?.id;
    if (!analysisId) return;
    const previousStamp = stamp(analysis.value);

    pendingRequests.set(requirementId, "save");
    try {
      const result = await api.updateRequirementAnalysisPoint(
        requirementId,
        point.id,
        {
          analysisId,
          reviewer,
          comment: point.review?.comment || "人工排除",
          analysisUpdatedAt: analysis.value?.updatedAt || "",
          title: point.title,
          category: point.category,
          objective: point.objective,
          evidence: point.evidence.map(({ reqId, quote }) => ({ reqId, quote })),
          questions: point.questions || [],
          status: "excluded",
        },
      );
      writeAnalysis(result, previousStamp);
      bumpRequirements();
      message.info(`测试点「${point.title}」已排除`);
    } catch (e) {
      message.error(`排除失败：${errorText(e)}`);
    } finally {
      pendingRequests.delete(requirementId);
    }
  }

  watch(
    () => analysis.value?.id,
    (id) => {
      if (draft.value && draft.value.analysisId !== id) {
        draft.value = null;
        editorError.value = "";
        message.warning("分析已被更新，已关闭旧测试点编辑，请基于新分析重新核对");
      }
    },
  );

  function askAgentForQuestions(section: { reqId: string; sectionPath?: string; questions?: string[] }) {
    const clauseText = chunksById.value.get(section.reqId)?.text || "";
    const questionsList = (section.questions || [])
      .map((q: string, i: number) => `${i + 1}. ${q}`)
      .join("\n");
    const prompt = `在需求条款【${section.sectionPath || section.reqId}】中发现了以下待确认问题：\n${questionsList}\n\n该条款原文如下：\n"""\n${clauseText.slice(0, 800)}\n"""\n\n请由需求分析师指出原文已明确和仍然缺失的规则，整理向需求方确认的问题；不提供默认业务规则，不生成或修改用例。`;
    sendToAgent({
      prompt,
      autoSend: true,
      role: "analyst",
      source: "requirement-question",
    });
  }

  function askAgentForPointQuestions(point: TestPoint, section: { reqId: string; sectionPath?: string }) {
    const questionsList = (point.questions || [])
      .map((q: string, i: number) => `${i + 1}. ${q}`)
      .join("\n");
    const prompt = `在测试点【${point.title}】（验证目标：${point.objective}）中存在以下待确认疑问：\n${questionsList}\n\n请针对该测试点分析：\n1. 哪些验证条件或预期尚未明确？\n2. 应向需求方确认哪些具体问题？不要给出默认规则或代替人工澄清。`;
    sendToAgent({
      prompt,
      autoSend: true,
      role: "analyst",
      source: "point-question",
    });
  }

  function focusPoint(point: TestPoint, section: { reqId: string; category?: Category }) {
    setCanvasFocus({
      type: "point",
      id: point.id,
      title: point.title,
      subtitle: point.objective,
      meta: { pointId: point.id, reqId: section.reqId, category: point.category },
    });
  }

  function consultPoint(point: TestPoint, section: { reqId: string; sectionPath?: string }) {
    focusPoint(point, section);
    sendToAgent({
      prompt: AGENT_ROLES.analyst.label + '：核对测试点【' + point.title + '】（条款 ' + section.reqId + '；验证目标：' + point.objective + '）的原文支持、适用条件及缺失规则。只给出测试点修订建议和具体澄清问题，不生成用例，不修改人工确认状态，不将默认做法当作业务规则。',
      role: "analyst", autoSend: true, source: "point-analysis",
      focus: { type: "point", id: point.id, title: point.title, subtitle: point.objective },
    });
  }

  function analyzePathwaysWithAgent() {
    sendToAgent({
      prompt: `请作为【需求分析师】，对我当前的需求「${props.requirement.label}」(ID: "${props.requirement.id}") 调用 analyze_pathways 工具(传入 requirementId: "${props.requirement.id}")，深度剖析核心端到端正向业务闭环（Happy Path）、系统状态机流转关系以及隐式未明确的业务规则与接口契约盲区。`,
      role: "analyst",
      autoSend: true,
      source: "analyst-pathways",
    });
  }

  function scanVulnerabilitiesWithAgent() {
    sendToAgent({
      prompt: `请作为【需求分析师】，对我当前的需求「${props.requirement.label}」(ID: "${props.requirement.id}") 调用 scan_vulnerabilities 工具(传入 requirementId: "${props.requirement.id}")，深度排查其中的规则矛盾、未定义边界、并发时序死锁与安全隐患，并输出针对性的防御测试用例建议。`,
      role: "analyst",
      autoSend: true,
      source: "vulnerability-scan",
    });
  }

  watch(requirementsRevision, () => {
    void loadAnalysis();
  });

  onMounted(() => {
    void loadAnalysis();
  });

  onBeforeUnmount(() => {
    active = false;
    draft.value = null;
    confirmation?.destroy();
  });

  return {
    analysis,
    operation,
    busy,
    hasContent,
    error,
    loadFailed,
    editorError,
    analysisProgress,
    showBatchModal,
    batchReviewer,
    batchOnlyClear,
    batchConfirming,
    openBatchConfirmModal,
    executeBatchConfirm,
    draft,
    chunkOptions,
    chunksById,
    counts,
    pointTotal,
    loadAnalysis,
    requestAnalysis,
    openEditor,
    closeEditor,
    savePoint,
    quickConfirmPoint,
    quickExcludePoint,
    askAgentForQuestions,
    askAgentForPointQuestions,
    focusPoint,
    consultPoint,
    analyzePathwaysWithAgent,
    scanVulnerabilitiesWithAgent,
  };
}
