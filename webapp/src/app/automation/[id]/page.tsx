/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useParams, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { useCallback, useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { fetchDashboardDevices } from "@/lib/api";
import { DeviceConfig, PinConfig } from "@/types/device";
import { useToast } from "@/components/ToastContext";

// --- Types ---
import { AutomationNodeType, AutomationGraphNodeConfig, AutomationGraphNode, AutomationGraphEdge, TriggerResult, AutomationRecord, DraftAutomation, TIME_TRIGGER_KIND, TIME_TRIGGER_WEEKDAY_OPTIONS, DEVICE_VALUE_TRIGGER_KIND, DEVICE_ON_OFF_TRIGGER_KIND, LEGACY_DEVICE_TRIGGER_KIND, AutomationScheduleContext, TELEGRAM_ACTION_KIND } from "@/types/automation";

type PageState = "loading" | "empty" | "loaded" | "error";

interface PortSelection {
  nodeId: string;
  portId: string;
  type: "in" | "out";
}

interface ContextMenuState {
  nodeId: string | null;
  screenX: number;
  screenY: number;
  canvasX: number;
  canvasY: number;
}

// --- API helpers ---
import { fetchAutomations, createAutomation, updateAutomation, deleteAutomation, triggerAutomation, fetchAutomationScheduleContext } from "@/lib/api-automation";

// --- Subcomponents ---

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-500/30 dark:bg-rose-500/10">
      <span className="material-icons-round mt-0.5 text-rose-500 dark:text-rose-400">error</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 text-xs font-bold text-rose-600 underline dark:text-rose-300">
          Retry
        </button>
      )}
    </div>
  );
}

function RealtimeServerClock({ timezone, initialServerTime }: { timezone?: string | null; initialServerTime?: string | null }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!timezone) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/60">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Server Clock</div>
        <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          Server timezone unavailable
        </p>
      </div>
    );
  }

  let timeStr = "";
  try {
    timeStr = now.toLocaleString([], {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    timeStr = formatServerTimePreview(initialServerTime, timezone);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Server Clock</div>
      <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        {timezone}
      </p>
      <p className="mt-1 text-xs text-slate-500 font-mono">
        Current server time: {timeStr}
      </p>
    </div>
  );
}

function MetricSelector({
  value,
  onChange,
}: {
  value?: string;
  onChange: (metric: "temperature" | "humidity") => void;
}) {
  const effectiveMetric = isDhtMetric(value) ? value : "temperature";

  return (
    <div className="space-y-2">
      <span className="text-xs font-bold text-slate-500 block">Reading</span>
      <div className="flex gap-2">
        {DHT_METRIC_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-bold transition shadow-sm ${
              effectiveMetric === option.value
                ? "bg-cyan-600 border-cyan-700 text-white"
                : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}



// --- Node Ports Logic ---
import {
  PortDefinition, NODE_WIDTH, NODE_HEIGHT, CANVAS_FIT_PADDING,
  MIN_CANVAS_SCALE, MAX_CANVAS_SCALE,
  getEmptyGraph, getEdgeKey,
  isEditableTarget, isAutomationPortTarget, buildConnectionEdge,
  layoutGraphForCanvas, getGraphBounds,
  buildStarterGraph, formatAutomationRunTime,
  buildGraphAutomationPayload, buildRenamePayload,
  getAutomationGraphSaveIssues,
  getLinearRule, isDhtMetric, isDhtPin, isNumericPin, isSwitchPin,
  getTimeTriggerWeekdays, buildTimeTriggerConfig,
  formatTimeTriggerValue, formatTimeTriggerSummary,
  formatServerTimePreview, getTriggerKindLabel, getPreferredTriggerKindForPin,
  DHT_METRIC_OPTIONS, getAutomationMetricLabel, resolveNumericMetricForPin,
  buildConditionStateForTriggerKind, getNodePorts
} from "@/lib/automation-utils";

// --- Main Page ---

export default function AutomationPage() {
  const params = useParams() as { id?: string };
  const router = useRouter();
  const { showToast } = useToast();

  const transformRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const graphLoadedForId = useRef<string | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);

  const rawId = params?.id || "new";
  const selectedId = rawId === "new" ? null : parseInt(rawId, 10);

  const [draftAutomation, setDraftAutomation] = useState<DraftAutomation | null>(null);
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [scheduleContext, setScheduleContext] = useState<AutomationScheduleContext | null>(null);
  const [fetchError, setFetchError] = useState("");

  const [saving, setSaving] = useState(false);
  const [triggerState, setTriggerState] = useState<"idle" | "pending" | "done">("idle");
  const [lastResult, setLastResult] = useState<TriggerResult | null>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [pendingCanvasFit, setPendingCanvasFit] = useState(false);

  // Graph state for currently selected automation
  const [nodes, setNodes] = useState<AutomationGraphNode[]>([]);
  const [edges, setEdges] = useState<AutomationGraphEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Drag & drop port connections
  const [connectingFrom, setConnectingFrom] = useState<PortSelection | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isHintExpanded, setIsHintExpanded] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsHintExpanded(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Basic modales

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deletePending, setDeletePending] = useState(false);

  const selectedAutomation = automations.find((a) => a.id === selectedId) ?? null;
  const activeAutomation = selectedAutomation ?? draftAutomation;
  const isDraftSelection = rawId === "new";
  const linearRule = activeAutomation ? getLinearRule(nodes, edges) : null;
  const saveValidationIssues = activeAutomation ? getAutomationGraphSaveIssues({ nodes, edges }) : [];

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const resolveCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const viewport = canvasViewportRef.current;
    const transformApi = transformRef.current;
    if (!viewport || !transformApi) return null;

    const rect = viewport.getBoundingClientRect();
    const { positionX, positionY, scale } = transformApi.instance.transformState;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    return {
      localX,
      localY,
      canvasX: (localX - positionX) / scale,
      canvasY: (localY - positionY) / scale,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    };
  }, []);

  const openContextMenu = useCallback(
    (clientX: number, clientY: number, nodeId: string | null) => {
      const point = resolveCanvasPoint(clientX, clientY);
      if (!point) return;

      const menuWidth = 208;
      const menuHeight = nodeId ? 212 : 172;
      setContextMenu({
        nodeId,
        screenX: Math.min(Math.max(point.localX, 12), Math.max(point.viewportWidth - menuWidth, 12)),
        screenY: Math.min(Math.max(point.localY, 12), Math.max(point.viewportHeight - menuHeight, 12)),
        canvasX: point.canvasX,
        canvasY: point.canvasY,
      });
      setSelectedNodeId(nodeId);
      setConnectingFrom(null);
      setConnectionPreview(null);
    },
    [resolveCanvasPoint]
  );

  const fitGraphToCanvas = useCallback(
    (graphNodes: AutomationGraphNode[] = nodes) => {
      const transformApi = transformRef.current;
      if (!transformApi || graphNodes.length === 0) return;

      const transformInstance = transformApi.instance as typeof transformApi.instance & {
        wrapperComponent?: HTMLDivElement | null;
      };
      const wrapper = transformInstance.wrapperComponent;
      const bounds = getGraphBounds(graphNodes);
      if (!wrapper || !bounds) return;

      const availableWidth = Math.max(wrapper.clientWidth - CANVAS_FIT_PADDING, 1);
      const availableHeight = Math.max(wrapper.clientHeight - CANVAS_FIT_PADDING, 1);
      const scale = Math.min(
        MAX_CANVAS_SCALE,
        Math.max(
          MIN_CANVAS_SCALE,
          Math.min(availableWidth / bounds.width, availableHeight / bounds.height)
        )
      );
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      const positionX = wrapper.clientWidth / 2 - centerX * scale;
      const positionY = wrapper.clientHeight / 2 - centerY * scale;

      transformApi.setTransform(positionX, positionY, scale, 220);
    },
    [nodes]
  );

  const loadData = useCallback(async () => {
    setPageState("loading");
    try {
      const [list, dList, nextScheduleContext] = await Promise.all([
        fetchAutomations(),
        fetchDashboardDevices().catch(() => []),
        fetchAutomationScheduleContext().catch(() => null),
      ]);
      setAutomations(list);
      setDevices(dList);
      setScheduleContext(nextScheduleContext);
      
      if (rawId === "new") {
          setDraftAutomation(prev => prev || {
            name: "New Automation",
            is_enabled: true,
            graph: buildStarterGraph(),
            last_triggered: null,
            last_execution: null,
          });
      }

      setPageState("loaded");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load.");
      setPageState("error");
    }
  }, [rawId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Update local graph state when selection changes
  useEffect(() => {
    if (selectedId === null) {
      if (draftAutomation && graphLoadedForId.current !== "new") {
        const displayGraph = layoutGraphForCanvas(draftAutomation.graph);
        setNodes(displayGraph.nodes);
        setEdges(displayGraph.edges);
        setPendingCanvasFit(true);
        setSelectedNodeId(null);
        setLastResult(null);
        graphLoadedForId.current = "new";
      }
      return;
    }

    if (selectedAutomation && graphLoadedForId.current !== selectedAutomation.id.toString()) {
      const displayGraph = layoutGraphForCanvas(selectedAutomation.graph ?? getEmptyGraph());
      setNodes(displayGraph.nodes);
      setEdges(displayGraph.edges);
      setPendingCanvasFit(true);
      setSelectedNodeId(null);
      setLastResult(selectedAutomation.last_execution ? { status: selectedAutomation.last_execution.status, message: "Last run from record", log: selectedAutomation.last_execution } : null);
      graphLoadedForId.current = selectedAutomation.id.toString();
    }
  }, [draftAutomation, selectedAutomation, selectedId]);

  useEffect(() => {
    if (!pendingCanvasFit || nodes.length === 0) return;

    const frame = window.requestAnimationFrame(() => {
      fitGraphToCanvas(nodes);
      setPendingCanvasFit(false);
      
      // Auto focus the canvas so keyboard events work immediately
      canvasViewportRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [fitGraphToCanvas, nodes, pendingCanvasFit]);

  useEffect(() => {
    if (!contextMenu) return;

    const handleWindowPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-automation-context-menu='true']")) return;
      setContextMenu(null);
    };

    window.addEventListener("mousedown", handleWindowPointerDown);
    return () => window.removeEventListener("mousedown", handleWindowPointerDown);
  }, [contextMenu]);

  function openRenameModal() {
    if (!activeAutomation) return;
    setRenameDraft(activeAutomation.name);
    setRenameError("");
    setRenameOpen(true);
  }

  function closeRenameModal() {
    if (renamePending) return;
    setRenameOpen(false);
    setRenameDraft("");
    setRenameError("");
  }

  function openDeleteModal() {
    if (!activeAutomation) return;
    setDeleteError("");
    setDeleteOpen(true);
  }

  function closeDeleteModal() {
    if (deletePending) return;
    setDeleteOpen(false);
    setDeleteError("");
  }

  async function handleRenameAutomation() {
    if (!activeAutomation || renamePending) return;
    const trimmedName = renameDraft.trim();
    if (!trimmedName) {
      setRenameError("Name is required.");
      return;
    }
    if (trimmedName === activeAutomation.name) {
      closeRenameModal();
      return;
    }

    if (isDraftSelection && draftAutomation) {
      setDraftAutomation({ ...draftAutomation, name: trimmedName });
      setRenameOpen(false);
      setRenameDraft("");
      return;
    }

    if (!selectedAutomation) return;

    try {
      setRenamePending(true);
      setRenameError("");
      const saved = await updateAutomation(
        selectedAutomation.id,
        buildRenamePayload(selectedAutomation, trimmedName, selectedAutomation.graph ?? { nodes: [], edges: [] })
      );
      setAutomations((prev) => prev.map((automation) => (automation.id === saved.id ? saved : automation)));
      setRenameOpen(false);
      setRenameDraft("");
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Failed to rename automation.");
    } finally {
      setRenamePending(false);
    }
  }

  async function handleSaveGraph() {
    if (!activeAutomation) return;
    if (saveValidationIssues.length > 0) {
      showToast(saveValidationIssues[0], "error");
      return;
    }
    try {
      setSaving(true);
      if (isDraftSelection && draftAutomation) {
        const saved = await createAutomation({
          name: draftAutomation.name,
          is_enabled: draftAutomation.is_enabled,
          graph: { nodes, edges },
        });
        setAutomations((prev) => [...prev, saved]);
        setDraftAutomation(null);
        router.replace(`/automation/${saved.id}`);
      } else if (selectedAutomation) {
        const payload = buildGraphAutomationPayload(selectedAutomation, { nodes, edges });
        const saved = await updateAutomation(selectedAutomation.id, payload);
        graphLoadedForId.current = null; // force reload graph logic on next render just in case
        setAutomations((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
      }
      showToast("Graph saved successfully!", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save graph.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAutomation() {
    if (!activeAutomation) return;

    if (isDraftSelection) {
      router.push('/automation');
      return;
    }

    if (!selectedAutomation) return;

    try {
      setDeletePending(true);
      setDeleteError("");
      await deleteAutomation(selectedAutomation.id);
      router.push('/automation');
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete automation.");
    } finally {
      setDeletePending(false);
    }
  }

  async function handleTrigger() {
    if (!selectedAutomation) return;
    setTriggerState("pending");
    setLastResult(null);
    try {
      const res = await triggerAutomation(selectedAutomation.id);
      setLastResult(res);
      setTriggerState("done");
    } catch (e) {
      setLastResult({ status: "failed", message: e instanceof Error ? e.message : "Error", log: null });
      setTriggerState("done");
    }
  }



  // --- Graph Edit Functions ---
  const addNode = useCallback((type: AutomationNodeType, position?: { x: number; y: number }, kind?: string) => {
    const id = `${type}_${Date.now()}`;
    let defaultPosition = { x: 1500 + Math.random() * 50, y: 1000 + Math.random() * 50 };
    
    if (!position && canvasViewportRef.current) {
       const viewport = canvasViewportRef.current;
       const rect = viewport.getBoundingClientRect();
       const center = resolveCanvasPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
       if (center) {
           defaultPosition = {
               x: Math.max(32, center.canvasX - NODE_WIDTH / 2 + Math.random() * 50),
               y: Math.max(32, center.canvasY - NODE_HEIGHT / 2 + Math.random() * 50),
           };
       }
    }

    const nextPosition = position
      ? {
          x: Math.max(32, Math.round(position.x - NODE_WIDTH / 2)),
          y: Math.max(32, Math.round(position.y - NODE_HEIGHT / 2)),
        }
      : defaultPosition;
    const newNode: AutomationGraphNode = {
      id,
      type,
      kind: kind || (type === "trigger" ? "device_state" : type === "action" ? "set_output" : "state_equals"),
      label: `New ${type}`,
      config: { ui: nextPosition }
    };
    setNodes((n) => [...n, newNode]);
    setSelectedNodeId(id);
    setConnectingFrom(null);
    setConnectionPreview(null);
    closeContextMenu();
  }, [closeContextMenu, resolveCanvasPoint]);

  const removeSelectedNode = useCallback((nodeId = selectedNodeId) => {
    if (!nodeId) return;
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== nodeId));
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.source_node_id !== nodeId && edge.target_node_id !== nodeId)
    );
    setSelectedNodeId((currentSelectedId) => (currentSelectedId === nodeId ? null : currentSelectedId));
    setConnectingFrom((currentSelection) => (currentSelection?.nodeId === nodeId ? null : currentSelection));
    setConnectionPreview(null);
    closeContextMenu();
  }, [closeContextMenu, selectedNodeId]);

  // Dragging nodes locally
  const [dragInfo, setDragInfo] = useState<{ id: string; startX: number; startY: number; initCanvasX: number; initCanvasY: number } | null>(null);

  const startNodeDrag = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    setDragInfo({ id, startX: e.clientX, startY: e.clientY, initCanvasX: node.config.ui?.x || 0, initCanvasY: node.config.ui?.y || 0 });
    setSelectedNodeId(id);
    closeContextMenu();
  };

  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (connectingFrom) {
      const point = resolveCanvasPoint(e.clientX, e.clientY);
      if (point) {
        setConnectionPreview({ x: point.canvasX, y: point.canvasY });
      }
    }

    if (dragInfo) {
      const scale = transformRef.current?.instance.transformState.scale ?? 1;
      const dx = (e.clientX - dragInfo.startX) / scale;
      const dy = (e.clientY - dragInfo.startY) / scale;
      setNodes(prev => prev.map(n => {
        if (n.id === dragInfo.id) {
          const newX = Math.max(0, Math.min(3000 - NODE_WIDTH, dragInfo.initCanvasX + dx));
          const newY = Math.max(0, Math.min(3000 - NODE_HEIGHT, dragInfo.initCanvasY + dy));
          return {
            ...n,
            config: {
              ...n.config,
              ui: {
                x: newX,
                y: newY,
              },
            },
          };
        }
        return n;
      }));
    }
  };

  const onCanvasMouseUp = (e: React.MouseEvent) => {
    if (dragInfo) {
      setDragInfo(null);
    }
    if (connectingFrom && !isAutomationPortTarget(e.target)) {
      setConnectingFrom(null);
      setConnectionPreview(null);
    }
  };

  const onPortClick = (e: React.MouseEvent, nodeId: string, portId: string, type: "in" | "out") => {
    e.stopPropagation();
    closeContextMenu();

    const nextSelection: PortSelection = { nodeId, portId, type };
    if (!connectingFrom) {
      setConnectingFrom(nextSelection);
      const node = nodes.find((item) => item.id === nodeId);
      const port = node ? getNodePorts(node.type).find((item) => item.id === portId) : null;
      if (node && port) {
        setConnectionPreview({
          x: (node.config.ui?.x || 0) + port.offset.x,
          y: (node.config.ui?.y || 0) + port.offset.y,
        });
      }
      return;
    }

    if (connectingFrom.nodeId === nodeId && connectingFrom.portId === portId) {
      setConnectingFrom(null);
      setConnectionPreview(null);
      return;
    }

    const edge = buildConnectionEdge(connectingFrom, nextSelection);
    if (!edge) {
      setConnectingFrom(nextSelection);
      const node = nodes.find((item) => item.id === nodeId);
      const port = node ? getNodePorts(node.type).find((item) => item.id === portId) : null;
      if (node && port) {
        setConnectionPreview({
          x: (node.config.ui?.x || 0) + port.offset.x,
          y: (node.config.ui?.y || 0) + port.offset.y,
        });
      }
      return;
    }

    setEdges((currentEdges) => {
      const filteredEdges = currentEdges.filter(
        (currentEdge) =>
          !(currentEdge.target_node_id === edge.target_node_id && currentEdge.target_port === edge.target_port)
      );
      if (filteredEdges.some((currentEdge) => getEdgeKey(currentEdge) === getEdgeKey(edge))) {
        return filteredEdges;
      }
      return [...filteredEdges, edge];
    });
    setSelectedNodeId(edge.target_node_id);
    setConnectingFrom(null);
    setConnectionPreview(null);
  };

  const deleteEdge = (eId: string) => {
    setEdges((currentEdges) => currentEdges.filter((edge) => getEdgeKey(edge) !== eId));
  };


  const handleContextAddNode = (type: AutomationNodeType, kind?: string) => {
    if (!contextMenu) return;
    addNode(type, { x: contextMenu.canvasX, y: contextMenu.canvasY }, kind);
  };

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (renameOpen || deleteOpen) return;

      if (event.key === "Escape") {
        if (contextMenu) {
          event.preventDefault();
          setContextMenu(null);
        }
        if (connectingFrom) {
          event.preventDefault();
          setConnectingFrom(null);
          setConnectionPreview(null);
        }
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && selectedNodeId && !isEditableTarget(event.target)) {
        event.preventDefault();
        removeSelectedNode(selectedNodeId);
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [connectingFrom, contextMenu, deleteOpen, removeSelectedNode, renameOpen, selectedNodeId]);

  // Rendering bezier
  const renderEdge = (startNode: AutomationGraphNode, startPort: PortDefinition, endNode: AutomationGraphNode | {x: number, y:number}, endPort: PortDefinition | null, eKey: string, activeHover: boolean = false) => {
    const sx = (startNode.config.ui?.x || 0) + startPort.offset.x;
    const sy = (startNode.config.ui?.y || 0) + startPort.offset.y;
    
    let ex = 0;
    let ey = 0;
    if ('config' in endNode && endPort) {
        ex = (endNode.config.ui?.x || 0) + endPort.offset.x;
        ey = (endNode.config.ui?.y || 0) + endPort.offset.y;
    } else if (!('config' in endNode)) {
        ex = endNode.x;
        ey = endNode.y;
    }

    const midY = (sy + ey) / 2;
    const path = `M ${sx} ${sy} C ${sx} ${Math.max(sy+40, midY)}, ${ex} ${Math.min(ey-40, midY)}, ${ex} ${ey}`;

    const isTrigger = startNode.type === "trigger";
    const isCondition = startNode.type === "condition";
    const isAction = startNode.type === "action";

    const baseColor = isTrigger ? "#3b82f6" : isCondition ? "#10b981" : isAction ? "#06b6d4" : "#475569";
    const strokeColor = activeHover ? "#2563eb" : baseColor;
    
    const shadowColor = activeHover ? "rgba(59,130,246,0.16)" : 
      isTrigger ? "rgba(59,130,246,0.18)" : isCondition ? "rgba(16,185,129,0.18)" : isAction ? "rgba(6,182,212,0.18)" : "rgba(71,85,105,0.18)";

    const markerId = activeHover 
      ? "url(#automation-edge-arrow-active)" 
      : isTrigger ? "url(#automation-edge-arrow-blue)" 
      : isCondition ? "url(#automation-edge-arrow-emerald)"
      : isAction ? "url(#automation-edge-arrow-cyan)"
      : "url(#automation-edge-arrow)";

    return (
      <g 
        key={eKey}
        className={activeHover ? "" : "group cursor-pointer pointer-events-auto"}
        onClick={activeHover ? undefined : (e) => { e.stopPropagation(); deleteEdge(eKey); }}
      >
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeLinecap="round"
          strokeWidth="24"
        />
        <path
          d={path}
          fill="none"
          stroke={shadowColor}
          strokeLinecap="round"
          strokeWidth="10"
        />
        <path 
          d={path}
          fill="none" 
          markerEnd={endPort ? markerId : undefined}
          stroke={strokeColor} 
          strokeLinecap="round"
          strokeWidth={activeHover ? "4" : "3"} 
          className={activeHover ? "animate-pulse" : "transition-colors group-hover:stroke-rose-500"}
        />
        {startPort.label && !activeHover && (
           <>
               <text x={sx} y={sy + 22} textAnchor="middle" fontSize="11" fill="none" stroke="white" strokeWidth="4" strokeLinejoin="round" className="pointer-events-none">
                   {startPort.label}
               </text>
               <text x={sx} y={sy + 22} textAnchor="middle" fontSize="11" fill={strokeColor} fontWeight="800" className="pointer-events-none drop-shadow-sm">
                   {startPort.label}
               </text>
           </>
        )}
        {endPort?.label && !activeHover && (
           <>
               <text x={ex} y={ey - 14} textAnchor="middle" fontSize="11" fill="none" stroke="white" strokeWidth="4" strokeLinejoin="round" className="pointer-events-none">
                   {endPort.label}
               </text>
               <text x={ex} y={ey - 14} textAnchor="middle" fontSize="11" fill={strokeColor} fontWeight="800" className="pointer-events-none drop-shadow-sm">
                   {endPort.label}
               </text>
           </>
        )}
      </g>
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background-light font-sans text-slate-800 transition-colors duration-300 selection:bg-primary selection:text-white dark:bg-background-dark dark:text-slate-200">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="z-30 flex min-h-16 flex-wrap items-center justify-between gap-x-4 border-b border-slate-200 bg-surface-light px-6 py-4 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
          <div className="flex items-center gap-1">
            <button
              onClick={() => router.push("/automation")}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title="Back to Automations"
            >
              <span className="material-icons-round text-xl">arrow_back</span>
            </button>
            {renameOpen ? (
              <form onSubmit={(e) => { e.preventDefault(); void handleRenameAutomation(); }} className="flex items-center relative">
                 <input 
                   autoFocus
                   type="text"
                   className="text-lg font-semibold px-2 py-0.5 -ml-1 bg-white border border-primary text-slate-800 rounded focus:outline-none focus:ring-2 focus:ring-primary/20 dark:bg-slate-800 dark:text-white dark:border-primary/50"
                   value={renameDraft}
                   onChange={(e) => { setRenameDraft(e.target.value); setRenameError(""); }}
                   onBlur={() => void handleRenameAutomation()}
                   onKeyDown={(e) => { if (e.key === "Escape") closeRenameModal(); }}
                   disabled={renamePending}
                 />
                 {renameError && <span className="absolute left-0 -bottom-6 text-xs text-rose-500 whitespace-nowrap">{renameError}</span>}
              </form>
            ) : (
                <h1 
                  className="group text-lg font-semibold text-slate-800 dark:text-white flex items-center cursor-pointer px-2 py-1 -ml-1 rounded transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={activeAutomation ? openRenameModal : undefined}
                >
                  <span>{activeAutomation ? activeAutomation.name : "Automation Rules"}</span>
                  {isDraftSelection && <span className="ml-3 inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Draft</span>}
                  {activeAutomation && (
                    <span className="material-icons-round text-[18px] opacity-65 transition-all group-hover:opacity-100 group-hover:text-primary text-slate-400 dark:text-slate-500 ml-2">
                      edit
                    </span>
                  )}
                </h1>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeAutomation && (
              <>
                <button title="Run Now" onClick={handleTrigger} disabled={triggerState === "pending"} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 disabled:opacity-50">
                  {triggerState === "pending" ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" /> : <span className="material-icons-round text-[20px]">play_arrow</span>}
                </button>
                <button title="Save Graph" onClick={handleSaveGraph} disabled={saving} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition hover:bg-primary/20 dark:bg-primary/20 dark:text-primary-light dark:hover:bg-primary/30 disabled:opacity-50">
                  <span className="material-icons-round text-[20px]">save</span>
                </button>
                <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700"></div>
                <button
                  title="Delete Automation"
                  onClick={openDeleteModal}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-700 transition hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                >
                  <span className="material-icons-round text-[20px]">delete</span>
                </button>
              </>
            )}
          </div>
        </header>

        {pageState === "error" && <div className="p-8"><ErrorBanner message={fetchError} onRetry={() => void loadData()} /></div>}



        {deleteOpen && activeAutomation && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
               <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                   <h2 className="text-lg font-bold mb-2">{isDraftSelection ? "Discard Draft" : "Delete Automation"}</h2>
                   <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                     {isDraftSelection
                       ? `Discard the local draft "${activeAutomation.name}"? This draft has not been saved to the backend yet.`
                       : `Delete "${activeAutomation.name}" and remove its saved execution history? This action cannot be undone.`}
                   </p>
                   {deleteError && (
                     <p className="mt-2 text-sm text-rose-500 dark:text-rose-400">{deleteError}</p>
                   )}
                   <div className="mt-5 flex justify-end gap-2">
                       <button onClick={closeDeleteModal} disabled={deletePending} className="px-4 py-2 text-sm font-medium hover:bg-slate-100 rounded-lg disabled:opacity-50 dark:hover:bg-slate-800">Cancel</button>
                       <button onClick={() => void handleDeleteAutomation()} disabled={deletePending} className="px-4 py-2 bg-rose-600 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                         {deletePending ? "Deleting..." : isDraftSelection ? "Discard Draft" : "Delete Rule"}
                       </button>
                   </div>
               </div>
            </div>
        )}

        {pageState === "loaded" && (
          <div className="flex flex-1 flex-col lg:flex-row overflow-hidden">
            {/* Center Panel: Graph Canvas */}
            <section className="flex-1 relative flex flex-col bg-slate-50 dark:bg-[#0b1120] border-r border-slate-200 dark:border-slate-800 overflow-hidden" 
                     onMouseMove={onCanvasMouseMove} 
                     onMouseUp={onCanvasMouseUp}
                     onMouseLeave={onCanvasMouseUp}
            >
              <TransformWrapper
                ref={transformRef}
                initialScale={1}
                minScale={MIN_CANVAS_SCALE}
                maxScale={MAX_CANVAS_SCALE}
                limitToBounds={false}
                panning={{ excluded: ["nodrag"] }}
                doubleClick={{ disabled: true }}
                onTransformed={(_, state) => setCanvasScale(state.scale)}
              >
                {({ zoomIn, zoomOut }) => (
                  <>


                    <div
                      ref={canvasViewportRef}
                      tabIndex={0}
                      className="flex-1 relative overflow-hidden outline-none"
                      onMouseDown={(event) => {
                        if (event.button !== 0) return;
                        closeContextMenu();
                        setSelectedNodeId(null);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openContextMenu(event.clientX, event.clientY, null);
                      }}
                    >
                      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-slate-50/80 to-transparent dark:from-[#0b1120] dark:to-transparent" />
                      <TransformComponent
                        wrapperClass="w-full h-full cursor-grab active:cursor-grabbing"
                        wrapperStyle={{ width: "100%", height: "100%", display: "block" }}
                        contentClass="w-[3000px] h-[3000px] relative"
                        contentStyle={{ width: "3000px", height: "3000px", position: "relative" }}
                      >
                         
                         <div className="absolute inset-0 opacity-30 dark:opacity-[0.05]" style={{ backgroundImage: `radial-gradient(#94a3b8 1px, transparent 1px)`, backgroundSize: '24px 24px' }} />

                         {/* SVG Edges Layer */}
                         <svg className="absolute inset-0 w-full h-full z-0 pointer-events-none" style={{ overflow: 'visible' }}>
                             <defs>
                                <marker id="automation-edge-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
                                </marker>
                                <marker id="automation-edge-arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
                                </marker>
                                <marker id="automation-edge-arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                                </marker>
                                <marker id="automation-edge-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
                                </marker>
                                <marker id="automation-edge-arrow-cyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#06b6d4" />
                                </marker>
                             </defs>
                            {edges.map(e => {
                                const sNode = nodes.find(n => n.id === e.source_node_id);
                                const tNode = nodes.find(n => n.id === e.target_node_id);
                                if (!sNode || !tNode) return null;
                                const sPort = getNodePorts(sNode.type).find(p => p.id === e.source_port);
                                const tPort = getNodePorts(tNode.type).find(p => p.id === e.target_port);
                                if (!sPort || !tPort) return null;
                                return renderEdge(sNode, sPort, tNode, tPort, getEdgeKey(e));
                            })}
                            
                            {/* Floating Edge while connecting */}
                            {connectingFrom && connectionPreview && (() => {
                                const sNode = nodes.find(n => n.id === connectingFrom.nodeId);
                                if (!sNode) return null;
                                const sPort = getNodePorts(sNode.type).find(p => p.id === connectingFrom.portId);
                                if (!sPort) return null;
                                return renderEdge(sNode, sPort, connectionPreview, null, "hover", true);
                            })()}
                         </svg>

                         {/* Nodes Layer */}
                         {nodes.map(node => {
                            const x = node.config.ui?.x || 0;
                            const y = node.config.ui?.y || 0;
                            const isSelected = selectedNodeId === node.id;
                            const ports = getNodePorts(node.type);
                            
                            // Color themes per type
                            const isTelegram = node.type === "action" && node.kind === TELEGRAM_ACTION_KIND;
                            const borderClasses = 
                              node.type === "trigger" ? "border-blue-200 dark:border-blue-500/30" : 
                              node.type === "condition" ? "border-amber-200 dark:border-amber-500/30" : 
                              isTelegram ? "border-[#0088cc]/40 dark:border-[#24A1DE]/40" :
                              "border-emerald-200 dark:border-emerald-500/30";
                              
                            const headerClasses = 
                              node.type === "trigger" ? "bg-blue-50 dark:bg-blue-900/30 border-b border-blue-100 dark:border-blue-500/20 text-blue-700 dark:text-blue-400" : 
                              node.type === "condition" ? "bg-amber-50 dark:bg-amber-900/30 border-b border-amber-100 dark:border-amber-500/20 text-amber-700 dark:text-amber-400" : 
                              isTelegram ? "bg-[#0088cc]/10 dark:bg-[#24A1DE]/20 border-b border-[#0088cc]/20 dark:border-[#24A1DE]/30 text-[#0088cc] dark:text-[#5bc0de]" :
                              "bg-emerald-50 dark:bg-emerald-900/30 border-b border-emerald-100 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400";
                            
                            const iconStr =
                              node.type === "trigger" ? "flash_on" :
                              node.type === "condition" ? "help_outline" : 
                              isTelegram ? "send" : "play_arrow";

                            return (
                              <div 
                                key={node.id}
                                data-automation-node="true"
                                className={`nodrag absolute rounded-2xl border-2 cursor-move shadow-md transition-shadow bg-white dark:bg-slate-900 ${borderClasses} ${isSelected ? 'ring-4 ring-primary/20 shadow-xl' : 'hover:border-slate-400 dark:hover:border-slate-500'}`}
                                style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                                onMouseDown={(e) => startNodeDrag(e, node.id)}
                                onClick={(e) => { e.stopPropagation(); closeContextMenu(); setSelectedNodeId(node.id); }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  openContextMenu(e.clientX, e.clientY, node.id);
                                }}
                              >
                                 {/* Node Header */}
                                 <div className={`px-4 py-2.5 rounded-t-[14px] ${headerClasses} flex justify-between items-center`}>
                                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                                        <span className="material-icons-round text-[14px]">{iconStr}</span>
                                        {isTelegram ? "notify" : node.type}
                                    </span>
                                    <span className="text-[10px] font-mono opacity-60">#{node.id.split('_')[1]}</span>
                                 </div>
                                 {/* Node Body */}
                                 <div className="px-4 py-4 flex items-center justify-center">
                                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">{node.label || node.kind}</span>
                                 </div>

                                 {/* Ports */}
                                 {ports.map((port) => {
                                    const px = port.offset.x;
                                    const py = port.type === "in" ? -7 : NODE_HEIGHT - 7;
                                    const isPortSelected = connectingFrom?.nodeId === node.id && connectingFrom.portId === port.id;
                                    return (
                                       <div key={port.id} title={port.label}
                                            data-automation-port="true"
                                            className={`nodrag group/port absolute w-3.5 h-3.5 rounded-full cursor-crosshair hover:scale-150 transition-transform shadow-sm
                                                bg-white border-2 border-slate-400 dark:bg-slate-900 dark:border-slate-500
                                                ${port.type === "in" ? 'hover:border-blue-500' : 'hover:border-amber-500'}
                                                ${isPortSelected ? 'scale-150 border-primary ring-4 ring-primary/20' : ''}`}
                                            style={{ left: px - 7, top: py }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onClick={(e) => onPortClick(e, node.id, port.id, port.type)}
                                       >
                                           <div className={`absolute hidden group-hover/port:block bg-slate-800 dark:bg-slate-700 text-white text-[10px] whitespace-nowrap font-bold tracking-wider px-2 py-1 rounded shadow-lg pointer-events-none w-max z-[100] ${port.type === 'in' ? 'bottom-full mb-1.5 left-1/2 -translate-x-1/2' : 'top-full mt-1.5 left-1/2 -translate-x-1/2'}`}>
                                              <span className="opacity-70 uppercase text-[9px] font-semibold">{port.type === "in" ? "Input" : "Output"}</span> <span className="text-blue-200 uppercase text-[9px]">●</span> {port.label}
                                           </div>
                                       </div>
                                    );
                                 })}
                              </div>
                            );
                         })}

                      </TransformComponent>

                      {/* Vertical Zoom Controls & Hint */}
                      <div className="absolute bottom-6 right-6 z-10 flex flex-col items-end gap-3 pointer-events-none">
                        <div 
                          className={`flex items-center rounded-full border border-slate-200 bg-white/90 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-950/85 pointer-events-auto transition-all duration-700 ease-in-out hover:opacity-100 overflow-hidden h-9 whitespace-nowrap ${isHintExpanded ? 'max-w-[250px] px-3 opacity-70 mr-0' : 'max-w-[36px] px-[9px] opacity-40 mr-1'}`}
                          onMouseEnter={() => setIsHintExpanded(true)}
                          onMouseLeave={() => setIsHintExpanded(false)}
                        >
                          <span className={`material-icons-round flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0 transition-all duration-700 ease-in-out ${isHintExpanded ? 'text-[16px] w-[16px]' : 'text-[18px] w-[18px]'}`}>mouse_right_click</span>
                          <span className={`text-[11px] font-medium text-slate-500 dark:text-slate-400 transition-all duration-700 ease-in-out ${isHintExpanded ? 'opacity-100 ml-2' : 'opacity-0 ml-2'}`}>
                            Right-click for options. Draw lines between ports.
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5 rounded-2xl border border-slate-200 bg-white/90 p-1 flex items-center shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-950/90 pointer-events-auto">
                           <button onClick={() => zoomIn(0.2, 300)} className="rounded-xl w-9 h-9 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 flex items-center justify-center transition" title="Zoom In">
                              <span className="material-icons-round text-[20px]">add</span>
                           </button>
                           <div className="py-1 w-full text-center text-[10px] font-bold text-slate-500 dark:text-slate-400 border-y border-slate-100 dark:border-slate-800/50">
                             {Math.round(canvasScale * 100)}%
                           </div>
                           <button onClick={() => zoomOut(0.2, 300)} className="rounded-xl w-9 h-9 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 flex items-center justify-center transition" title="Zoom Out">
                              <span className="material-icons-round text-[20px]">remove</span>
                           </button>
                           <button onClick={() => fitGraphToCanvas()} className="rounded-xl w-9 h-9 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 flex items-center justify-center transition mt-0.5" title="Fit to screen">
                              <span className="material-icons-round text-[20px]">fit_screen</span>
                           </button>
                        </div>
                      </div>
                      {contextMenu && (
                        <div
                          data-automation-context-menu="true"
                          className="absolute z-30 w-52 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95"
                          style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
                          onMouseDown={(event) => event.stopPropagation()}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                            {contextMenu.nodeId ? "Block Actions" : "Canvas Actions"}
                          </div>
                          {contextMenu.nodeId && (
                            <button
                              type="button"
                              onClick={() => removeSelectedNode(contextMenu.nodeId)}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                            >
                              <span className="material-icons-round text-base">delete</span>
                              Delete block
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleContextAddNode("trigger")}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                          >
                            <span className="material-icons-round text-base text-blue-500">flash_on</span>
                            Add trigger here
                          </button>
                          <button
                            type="button"
                            onClick={() => handleContextAddNode("condition")}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                          >
                            <span className="material-icons-round text-base text-amber-500">help_outline</span>
                            Add condition here
                          </button>
                          <button
                            type="button"
                            onClick={() => handleContextAddNode("action", "set_output")}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                          >
                            <span className="material-icons-round text-base text-emerald-500">play_arrow</span>
                            Add device action here
                          </button>
                          <button
                            type="button"
                            onClick={() => handleContextAddNode("action", "send_telegram_notification")}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                          >
                            <span className="material-icons-round text-base text-sky-500">send</span>
                            Add Telegram notify here
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </TransformWrapper>
            </section>

            {/* Right Panel: Inspector */}
            <div className={`relative shrink-0 transition-[width] duration-300 ease-in-out h-full ${isInspectorOpen ? 'w-full lg:w-80' : 'w-0'}`}>
                {/* Toggle Button attached to sidebar edge */}
                <button
                  title={isInspectorOpen ? "Hide Setup" : "Show Setup"}
                  onClick={() => setIsInspectorOpen(prev => !prev)}
                  className="absolute top-1/2 -translate-y-1/2 -left-8 z-40 flex h-14 w-8 items-center justify-center rounded-l-xl border-y border-l border-slate-200 bg-surface-light text-slate-500 shadow-sm transition-colors hover:text-primary dark:border-slate-700 dark:bg-surface-dark dark:text-slate-400"
                >
                  <span className="material-icons-round text-[22px] transition-transform duration-300" style={{ transform: isInspectorOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>chevron_left</span>
                </button>

                {/* Sidebar inner */}
                <aside className={`absolute inset-0 border-slate-200 bg-surface-light dark:border-slate-700 dark:bg-surface-dark overflow-y-auto overflow-x-hidden flex flex-col min-h-0 transition-opacity duration-300 ease-in-out ${isInspectorOpen ? 'opacity-100 border-l' : 'opacity-0 border-l-0 pointer-events-none'}`}>
                  <div className="w-screen lg:w-80 flex-1 flex flex-col min-h-0">
               <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{linearRule ? "Rule Setup" : "Inspector"}</span>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {linearRule
                          ? "Tune the current When / Condition / Action recipe without leaving the canvas."
                          : "Select a node to edit its bindings and behavior."}
                      </p>
                    </div>
                    {selectedNodeId && !linearRule && (
                      <button onClick={() => removeSelectedNode()} className="text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/50 p-1.5 rounded-lg transition"><span className="material-icons-round text-sm">delete</span></button>
                    )}
                  </div>
                  {activeAutomation && (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Last Run</div>
                        <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{isDraftSelection ? "Not saved yet" : formatAutomationRunTime(activeAutomation.last_triggered, scheduleContext?.effective_timezone)}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Runtime</div>
                        <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{isDraftSelection ? "Draft only" : activeAutomation.is_enabled ? "Enabled" : "Paused"}</div>
                      </div>
                    </div>
                  )}
                  {saveValidationIssues.length > 0 && (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                      <div className="text-[11px] font-bold uppercase tracking-[0.18em]">Save Checklist</div>
                      <p className="mt-2 text-sm font-semibold">Complete the required graph fields before saving.</p>
                      <p className="mt-1 text-sm">{saveValidationIssues[0]}</p>
                      {saveValidationIssues.length > 1 && (
                        <p className="mt-1 text-xs opacity-80">+{saveValidationIssues.length - 1} more issue(s) still need attention.</p>
                      )}
                    </div>
                  )}
               </div>
               
               {linearRule ? (() => {
                   const { trigger, condition, action } = linearRule;
                   const isTimeTrigger = trigger.kind === TIME_TRIGGER_KIND;

                   const updateConfigMany = (updates: {id: string, kind?: string, config?: Partial<AutomationGraphNodeConfig>}[]) => {
                       setNodes(prev => prev.map(n => {
                           const up = updates.find(u => u.id === n.id);
                           if (!up) return n;
                           return { 
                               ...n, 
                               ...(up.kind ? { kind: up.kind } : {}), 
                               config: { ...n.config, ...(up.config || {}) } 
                           };
                       }));
                   };

                   const resolveMetricForPin = (
                       pin: PinConfig | undefined,
                       lastState: DeviceConfig["last_state"] | undefined,
                       currentMetric?: unknown,
                   ) => resolveNumericMetricForPin(pin, lastState, currentMetric);

                   const handleSetTriggerSource = (source: "device" | "time") => {
                       setNodes(prev => prev.map(n => {
                           if (n.id !== trigger.id) return n;
                           if (source === "time") {
                               return { ...n, kind: TIME_TRIGGER_KIND, config: buildTimeTriggerConfig(n.config) };
                           }
                           return {
                               ...n,
                               kind: getPreferredTriggerKindForPin(undefined),
                               config: {
                                   ...n.config,
                                   hour: undefined,
                                   minute: undefined,
                                   weekdays: undefined,
                               },
                           };
                       }));
                   };

                   const handleSetSourceDevice = (devId: string) => {
                       updateConfigMany([
                           { id: trigger.id, config: { device_id: devId, pin: undefined, metric: undefined } },
                           { id: condition.id, config: { device_id: devId, pin: undefined, metric: undefined } }
                       ]);
                   };

                   const handleSetSourcePin = (pin: PinConfig) => {
                       const nextTriggerKind = getPreferredTriggerKindForPin(pin, sourceDev?.last_state);
                       const nextMetric = resolveMetricForPin(pin, sourceDev?.last_state, trigger.config.metric);
                       setNodes(prev => prev.map(n => {
                           if (n.id === trigger.id) {
                               return {
                                   ...n,
                                   kind: nextTriggerKind,
                                   config: {
                                       ...n.config,
                                       pin: pin.gpio_pin,
                                       metric: nextTriggerKind === DEVICE_VALUE_TRIGGER_KIND ? nextMetric : undefined,
                                       hour: undefined,
                                       minute: undefined,
                                       weekdays: undefined,
                                   },
                               };
                           }
                           if (n.id === condition.id) {
                               return {
                                   ...n,
                                   ...buildConditionStateForTriggerKind(nextTriggerKind, n.kind, n.config, pin.gpio_pin, nextMetric),
                               };
                           }
                           return n;
                       }));
                   };

                   const handleSetTimeValue = (value: string) => {
                       const [hourRaw, minuteRaw] = value.split(":");
                       const nextHour = Number.parseInt(hourRaw ?? "", 10);
                       const nextMinute = Number.parseInt(minuteRaw ?? "", 10);
                       if (Number.isNaN(nextHour) || Number.isNaN(nextMinute)) return;
                       updateConfigMany([
                           {
                               id: trigger.id,
                               config: {
                                   hour: nextHour,
                                   minute: nextMinute,
                                   weekdays: getTimeTriggerWeekdays(trigger.config),
                               },
                           },
                       ]);
                   };

                   const handleToggleTriggerWeekday = (weekday: string) => {
                       const currentWeekdays = getTimeTriggerWeekdays(trigger.config);
                       const nextWeekdays = currentWeekdays.includes(weekday)
                           ? currentWeekdays.filter((value) => value !== weekday)
                           : [...currentWeekdays, weekday];
                       updateConfigMany([{ id: trigger.id, config: { weekdays: nextWeekdays } }]);
                   };

                   const handleSetConditionDevice = (devId: string) => {
                       updateConfigMany([{ id: condition.id, config: { device_id: devId, pin: undefined, metric: undefined } }]);
                   };

                   const handleSetConditionPin = (pin: PinConfig) => {
                       const nextTriggerKind = isNumericPin(pin, conditionDev?.last_state)
                           ? DEVICE_VALUE_TRIGGER_KIND
                           : DEVICE_ON_OFF_TRIGGER_KIND;
                       const nextMetric = resolveMetricForPin(pin, conditionDev?.last_state, condition.config.metric);
                       setNodes(prev => prev.map(n => {
                           if (n.id !== condition.id) return n;
                           return {
                               ...n,
                               ...buildConditionStateForTriggerKind(nextTriggerKind, n.kind, n.config, pin.gpio_pin, nextMetric),
                           };
                       }));
                   };

                   const handleSetSourceMetric = (metric: "temperature" | "humidity") => {
                       updateConfigMany([
                           { id: trigger.id, config: { metric } },
                           { id: condition.id, config: { metric } },
                       ]);
                   };

                   const handleSetConditionMetric = (metric: "temperature" | "humidity") => {
                       updateConfigMany([{ id: condition.id, config: { metric } }]);
                   };

                   const handleSetTargetDevice = (devId: string) => {
                       updateConfigMany([{ id: action.id, config: { device_id: devId, pin: undefined } }]);
                   };

                   const handleSetTargetPin = (pinValue: number, mode: string) => {
                       const defaultKind = mode === "PWM" ? "set_value" : "set_output";
                       setNodes(prev => prev.map(n => {
                           if (n.id !== action.id) return n;
                           return {
                               ...n,
                               kind: defaultKind,
                               config: {
                                   ...n.config,
                                   pin: pinValue,
                                   value: defaultKind === "set_output" ? 1 : 0,
                               },
                           };
                       }));
                   };

                   const sourceDev = devices.find(d => d.device_id === trigger.config.device_id);
                   const sourcePinObj = sourceDev?.pin_configurations.find(p => p.gpio_pin === trigger.config.pin);

                   const conditionDev = devices.find(d => d.device_id === condition.config.device_id);
                   const conditionPinObj = conditionDev?.pin_configurations.find(p => p.gpio_pin === condition.config.pin);
                   const isNumericConditionSource = isNumericPin(conditionPinObj, conditionDev?.last_state);
                   const isSwitchConditionSource = isSwitchPin(conditionPinObj, conditionDev?.last_state);
                   const targetDev = devices.find(d => d.device_id === action.config.device_id);
                   const conditionConfigured =
                       condition.kind === "numeric_compare"
                           ? Boolean(condition.config.device_id) &&
                             condition.config.pin !== undefined &&
                             condition.config.value !== undefined &&
                             (condition.config.operator !== "between" || condition.config.secondary_value !== undefined)
                           : Boolean(condition.config.device_id) &&
                             condition.config.pin !== undefined &&
                             condition.config.expected !== undefined;

                   return (
                       <div className="p-4 space-y-6">
                           <div className="space-y-3">
                               <div className="flex bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg border border-blue-100 dark:border-blue-800/50 w-fit">
                                   <span className="text-xs font-bold text-blue-700 dark:text-blue-400">1. WHEN</span>
                               </div>

                               <span className="text-xs font-bold text-slate-500 block">Trigger source</span>
                               <div className="flex gap-2">
                                   <button
                                       type="button"
                                       onClick={() => handleSetTriggerSource("device")}
                                       className={`flex-1 py-2 rounded-lg font-bold text-[11px] border transition shadow-sm ${!isTimeTrigger ? "bg-blue-600 border-blue-700 text-white" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300"}`}
                                   >
                                       Device Event
                                   </button>
                                   <button
                                       type="button"
                                       onClick={() => handleSetTriggerSource("time")}
                                       className={`flex-1 py-2 rounded-lg font-bold text-[11px] border transition shadow-sm ${isTimeTrigger ? "bg-blue-600 border-blue-700 text-white" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300"}`}
                                   >
                                       Time
                                   </button>
                               </div>

                               {isTimeTrigger ? (
                                   <div className="space-y-3">
                                       <label className="block">
                                           <span className="text-xs font-bold text-slate-500 block mb-2">Run at</span>
                                           <input
                                               name="rule-trigger-time"
                                               type="time"
                                               value={formatTimeTriggerValue(trigger.config)}
                                               onChange={(e) => handleSetTimeValue(e.target.value)}
                                               className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono"
                                           />
                                       </label>
                                       <div className="space-y-2">
                                           <span className="text-xs font-bold text-slate-500 block">Weekdays</span>
                                           <div className="flex flex-wrap gap-2">
                                               {TIME_TRIGGER_WEEKDAY_OPTIONS.map((option) => {
                                                   const active = getTimeTriggerWeekdays(trigger.config).includes(option.value);
                                                   return (
                                                       <button
                                                           key={option.value}
                                                           type="button"
                                                           onClick={() => handleToggleTriggerWeekday(option.value)}
                                                           className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition ${active ? "bg-blue-600 border-blue-700 text-white" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300"}`}
                                                       >
                                                           {option.label}
                                                       </button>
                                                   );
                                               })}
                                           </div>
                                           <p className="text-[11px] text-slate-500">
                                               Leave all days unselected to run every day.
                                           </p>
                                       </div>
                                       <RealtimeServerClock timezone={scheduleContext?.effective_timezone} initialServerTime={scheduleContext?.current_server_time} />
                                   </div>
                               ) : (
                                   <>
                                       <span className="text-xs font-bold text-slate-500 block">Detect changes on:</span>
                                       <select name="rule-source-device" value={trigger.config.device_id || ""} onChange={(e) => handleSetSourceDevice(e.target.value)} className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary">
                                          <option value="">Select source device...</option>
                                          {devices.map(d => <option key={d.device_id} value={d.device_id}>{d.name}</option>)}
                                       </select>

                                       {sourceDev && (
                                           <div className="grid grid-cols-2 gap-2 mt-2">
                                               {sourceDev.pin_configurations.map(pin => (
                                                   <button
                                                       key={pin.gpio_pin}
                                                       onClick={() => handleSetSourcePin(pin)}
                                                       className={`flex flex-col text-left p-2 border rounded-lg transition-colors ${trigger.config.pin === pin.gpio_pin ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900'}`}
                                                   >
                                                       <div className="flex items-center justify-between mb-1 w-full gap-2">
                                                           <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">GPIO {pin.gpio_pin}</span>
                                                           <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">{pin.mode}</span>
                                                       </div>
                                                       <span className="text-[10px] text-slate-500 truncate w-full">{pin.label || pin.function || "Unnamed"}</span>
                                                   </button>
                                               ))}
                                           </div>
                                       )}

                                       {trigger.kind === DEVICE_VALUE_TRIGGER_KIND && isDhtPin(sourcePinObj, sourceDev?.last_state) && (
                                           <MetricSelector value={trigger.config.metric as string | undefined} onChange={handleSetSourceMetric} />
                                       )}

                                       {trigger.config.pin !== undefined && trigger.kind === LEGACY_DEVICE_TRIGGER_KIND && (
                                           <div className="mt-3 p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-800">
                                               <p className="text-[11px] text-slate-500">
                                                   Legacy rule detected. Click the selected pin again to safely upgrade mapping.
                                               </p>
                                           </div>
                                       )}
                                   </>
                               )}
                           </div>

                           <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                               <div className="flex bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-lg border border-amber-100 dark:border-amber-800/50 w-fit mb-2">
                                   <span className="text-xs font-bold text-amber-700 dark:text-amber-400">2. AND ONLY IF</span>
                               </div>

                               {isTimeTrigger && (
                                   <>
                                       <span className="text-xs font-bold text-slate-500 block">Condition source</span>
                                       <select name="rule-condition-device" value={condition.config.device_id || ""} onChange={(e) => handleSetConditionDevice(e.target.value)} className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary">
                                           <option value="">Select condition device...</option>
                                           {devices.map(d => <option key={d.device_id} value={d.device_id}>{d.name}</option>)}
                                       </select>

                                       {conditionDev && (
                                           <div className="grid grid-cols-2 gap-2 mt-2">
                                               {conditionDev.pin_configurations.map(pin => (
                                                   <button
                                                       key={pin.gpio_pin}
                                                       onClick={() => handleSetConditionPin(pin)}
                                                       className={`flex flex-col text-left p-2 border rounded-lg transition-colors ${condition.config.pin === pin.gpio_pin ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900'}`}
                                                   >
                                                       <div className="flex items-center justify-between mb-1 w-full gap-2">
                                                           <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">GPIO {pin.gpio_pin}</span>
                                                           <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">{pin.mode}</span>
                                                       </div>
                                                       <span className="text-[10px] text-slate-500 truncate w-full">{pin.label || pin.function || "Unnamed"}</span>
                                                   </button>
                                               ))}
                                           </div>
                                       )}

                                   </>
                               )}

                               {condition.kind === "numeric_compare" && isNumericConditionSource ? (
                                   <div className="space-y-3">
                                       {isDhtPin(conditionPinObj, conditionDev?.last_state) && (
                                           <MetricSelector value={condition.config.metric as string | undefined} onChange={handleSetConditionMetric} />
                                       )}
                                       <div className="flex flex-wrap gap-1.5">
                                           {['gt', 'gte', 'lt', 'lte', 'between'].map(op => (
                                               <button
                                                  key={op}
                                                  onClick={() => updateConfigMany([{id: condition.id, config: {operator: op}}])}
                                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono border transition shadow-sm ${condition.config.operator === op ? 'bg-primary text-white border-primary' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}
                                               >
                                                  {op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : op === 'lte' ? '<=' : 'between'}
                                               </button>
                                           ))}
                                       </div>
                                       <div className="flex gap-2 items-center">
                                           <input name="rule-condition-value" type="number" value={String(condition.config.value ?? "")} onChange={(e) => updateConfigMany([{id: condition.id, config: {value: Number.parseFloat(e.target.value)}}])} placeholder="Value" className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono shadow-sm" />
                                           {condition.config.operator === "between" && (
                                               <>
                                                   <span className="text-sm font-semibold text-slate-400">and</span>
                                                   <input name="rule-condition-secondary-value" type="number" value={String(condition.config.secondary_value ?? "")} onChange={(e) => updateConfigMany([{id: condition.id, config: {secondary_value: Number.parseFloat(e.target.value)}}])} placeholder="Max" className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono shadow-sm" />
                                               </>
                                           )}
                                       </div>
                                   </div>
                               ) : condition.kind === "state_equals" && isSwitchConditionSource ? (
                                   <div className="flex gap-2">
                                       <button onClick={() => updateConfigMany([{id: condition.id, config: {expected: 'on'}}])} className={`flex-1 py-2 rounded-lg font-bold text-[11px] border transition shadow-sm ${condition.config.expected === "on" ? 'bg-emerald-500 border-emerald-600 text-white dark:bg-emerald-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>Is ON</button>
                                       <button onClick={() => updateConfigMany([{id: condition.id, config: {expected: 'off'}}])} className={`flex-1 py-2 rounded-lg font-bold text-[11px] border transition shadow-sm ${condition.config.expected === "off" ? 'bg-slate-800 border-slate-900 text-white dark:bg-slate-700 dark:border-slate-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>Is OFF</button>
                                   </div>
                               ) : (
                                   <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800/50">
                                        <p className="text-xs text-slate-500">
                                            {isTimeTrigger
                                                ? "Pick a condition device and pin to define what the scheduler should verify at runtime."
                                                : "Pick a valid trigger source to define conditions."}
                                        </p>
                                   </div>
                               )}
                           </div>

                           {conditionConfigured && (
                               <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                                   <div className="flex bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-lg border border-emerald-100 dark:border-emerald-800/50 w-fit mb-2">
                                       <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">3. THEN DO</span>
                                   </div>

                                   <div className="mb-4 bg-slate-100 dark:bg-slate-900 p-1 rounded-lg">
                                       {action.kind !== TELEGRAM_ACTION_KIND ? (
                                           <div className="grid grid-cols-2 gap-2">
                                               <button
                                                   onClick={() => updateConfigMany([{id: action.id, kind: "set_output", config: { device_id: "", pin: undefined, value: 0 } }])}
                                                   className={`py-1.5 text-xs font-bold rounded-md transition-colors ${action.kind === "set_output" ? 'bg-white dark:bg-slate-800 shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                                               >
                                                   Turn On/Off
                                               </button>
                                               <button
                                                   onClick={() => updateConfigMany([{id: action.id, kind: "set_value", config: { device_id: "", pin: undefined, value: 0 } }])}
                                                   className={`py-1.5 text-xs font-bold rounded-md transition-colors ${action.kind === "set_value" ? 'bg-white dark:bg-slate-800 shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                                               >
                                                   Set Value
                                               </button>
                                           </div>
                                       ) : (
                                           <div className="grid grid-cols-1 gap-2">
                                               <button
                                                   onClick={() => updateConfigMany([{id: action.id, kind: TELEGRAM_ACTION_KIND, config: { chat_id: "", message: "" } }])}
                                                   className={`py-1.5 text-xs font-bold rounded-md transition-colors ${action.kind === TELEGRAM_ACTION_KIND ? 'bg-white dark:bg-slate-800 shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                                               >
                                                   Telegram
                                               </button>
                                           </div>
                                       )}
                                   </div>

                                   {action.kind === TELEGRAM_ACTION_KIND && (
                                       <div className="space-y-3">
                                           <div>
                                               <span className="text-xs font-bold text-slate-500 block mb-1">Bot API Key</span>
                                               <input 
                                                   type="password" 
                                                   value={action.config.bot_api_key || ""} 
                                                   onChange={(e) => updateConfigMany([{id: action.id, config: { bot_api_key: e.target.value } }])} 
                                                   placeholder="e.g. 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" 
                                                   className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono shadow-sm"
                                               />
                                           </div>
                                           <div>
                                               <span className="text-xs font-bold text-slate-500 block mb-1">Target Chat ID</span>
                                               <input 
                                                   type="text" 
                                                   value={action.config.chat_id || ""} 
                                                   onChange={(e) => updateConfigMany([{id: action.id, config: { chat_id: e.target.value } }])} 
                                                   placeholder="e.g. -100123456789" 
                                                   className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono shadow-sm"
                                               />
                                           </div>
                                           <div>
                                               <span className="text-xs font-bold text-slate-500 block mb-1">Message Template <span className="font-normal text-slate-400">(Optional)</span></span>
                                               <textarea 
                                                   value={action.config.message || ""} 
                                                   onChange={(e) => updateConfigMany([{id: action.id, config: { message: e.target.value } }])} 
                                                   placeholder="Supports {{device.name}}, {{trigger.value}}" 
                                                   rows={3} 
                                                   className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary shadow-sm resize-none"
                                               />
                                           </div>
                                       </div>
                                   )}

                                   {action.kind !== TELEGRAM_ACTION_KIND && (
                                     <>
                                       <span className="text-xs font-bold text-slate-500 block">Target Device:</span>
                                       <select name="rule-target-device" value={action.config.device_id || ""} onChange={(e) => handleSetTargetDevice(e.target.value)} className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary">
                                          <option value="">Select target device...</option>
                                          {devices.map(d => <option key={d.device_id} value={d.device_id}>{d.name}</option>)}
                                       </select>
   
                                       {targetDev && (
                                           <div className="grid grid-cols-2 gap-2 mt-2">
                                               {targetDev.pin_configurations.filter(p => p.mode === "OUTPUT" || p.mode === "PWM").map(pin => (
                                                   <button
                                                       key={pin.gpio_pin}
                                                       onClick={() => handleSetTargetPin(pin.gpio_pin, pin.mode)}
                                                       className={`flex flex-col text-left p-2 border rounded-lg transition-colors ${action.config.pin === pin.gpio_pin ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900'}`}
                                                   >
                                                       <div className="flex items-center justify-between mb-1 w-full gap-2">
                                                           <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">GPIO {pin.gpio_pin}</span>
                                                           <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">{pin.mode}</span>
                                                       </div>
                                                       <span className="text-[10px] text-slate-500 truncate w-full">{pin.label || pin.function || "Unnamed"}</span>
                                                   </button>
                                               ))}
                                               {targetDev.pin_configurations.filter(p => p.mode === "OUTPUT" || p.mode === "PWM").length === 0 && (
                                                    <div className="col-span-2 p-3 text-xs text-amber-600 bg-amber-50 rounded-lg border border-amber-200">No output pins available on this device.</div>
                                               )}
                                           </div>
                                       )}
   
                                       {action.config.pin !== undefined && (
                                        <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800">
                                           {action.kind === "set_output" && (
                                               <div>
                                                   <span className="text-xs font-bold text-slate-500 block mb-2">Set Pin State To</span>
                                                   <div className="flex gap-2">
                                                       <button onClick={() => updateConfigMany([{id: action.id, config: {value: 0}}])} className={`flex-1 py-2 rounded-lg font-bold text-sm border transition shadow-sm ${action.config.value === 0 ? 'bg-slate-800 border-slate-900 text-white dark:bg-slate-700 dark:border-slate-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>OFF</button>
                                                       <button onClick={() => updateConfigMany([{id: action.id, config: {value: 1}}])} className={`flex-1 py-2 rounded-lg font-bold text-sm border transition shadow-sm ${action.config.value === 1 ? 'bg-emerald-500 border-emerald-600 text-white dark:bg-emerald-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>ON</button>
                                                   </div>
                                               </div>
                                           )}
   
                                           {action.kind === "set_value" && (
                                               <div>
                                                   <span className="text-xs font-bold text-slate-500 block mb-2">Set PWM Value</span>
                                                   <div className="flex gap-3 items-center">
                                                       <input name="rule-target-pwm-range" type="range" min="0" max="255" value={String(action.config.value ?? 0)} onChange={(e) => updateConfigMany([{id: action.id, config: {value: Number.parseFloat(e.target.value)}}])} className="flex-1 accent-primary" />
                                                       <input name="rule-target-pwm-value" type="number" min="0" max="255" value={String(action.config.value ?? 0)} onChange={(e) => updateConfigMany([{id: action.id, config: {value: Number.parseFloat(e.target.value)}}])} className="w-16 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1 outline-none font-mono text-center" />
                                                   </div>
                                               </div>
                                           )}
                                         </div>
                                       )}
                                     </>
                                   )}
                                </div>
                            )}

                           {conditionConfigured && action.config.pin !== undefined && (
                               <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                                   <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 shadow-inner">
                                       <span className="text-[10px] font-bold uppercase tracking-widest text-primary mb-2 block">Rule Summary</span>
                                       <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed">
                                           <span className="text-blue-600 dark:text-blue-400 font-bold">When</span>{" "}
                                           {isTimeTrigger
                                               ? `server time reaches ${formatTimeTriggerSummary(trigger.config)}${scheduleContext?.effective_timezone ? ` (${scheduleContext.effective_timezone})` : ""}`
                                               : trigger.kind === DEVICE_VALUE_TRIGGER_KIND
                                                   ? `${getAutomationMetricLabel(trigger.config.metric)} on ${sourcePinObj?.label || `GPIO ${trigger.config.pin}`} from ${sourceDev?.name} changes`
                                                   : `${getTriggerKindLabel(trigger.kind).toLowerCase()} on ${sourcePinObj?.label || `GPIO ${trigger.config.pin}`} from ${sourceDev?.name}`}
                                           {" "}
                                           <span className="text-amber-600 dark:text-amber-500 font-bold">
                                             {condition.kind === 'state_equals' ? (condition.config.expected === 'on' ? 'is ON' : 'is OFF') :
                                              condition.kind === 'numeric_compare' ? `${isDhtMetric(condition.config.metric) ? `${getAutomationMetricLabel(condition.config.metric)} ` : ''}is ${condition.config.operator === 'between' ? 'between ' + condition.config.value + ' AND ' + condition.config.secondary_value : (condition.config.operator === 'gt' ? '>' : condition.config.operator === 'lt' ? '<' : condition.config.operator === 'gte' ? '>=' : '<=') + ' ' + condition.config.value}` : 'changes'}
                                           </span>
                                           , <br/><span className="text-emerald-600 dark:text-emerald-500 font-bold">Then</span> set {targetDev?.pin_configurations.find(p => p.gpio_pin === action.config.pin)?.label || `GPIO ${action.config.pin}`} on {targetDev?.name} to <span className="font-bold">{action.kind === 'set_output' ? (action.config.value ? 'ON' : 'OFF') : action.config.value}</span>.
                                       </p>
                                   </div>
                               </div>
                           )}
                       </div>
                   );
               })() : selectedNodeId ? (() => {
                   const node = nodes.find(n => n.id === selectedNodeId);
                   if (!node) return null;
                   
                   const updateConfig = (key: keyof AutomationGraphNodeConfig, val: unknown) => {
                       setNodes(prev => prev.map(n => n.id === node.id ? { ...n, config: { ...n.config, [key]: val } } : n));
                   };
                   const updateNode = (key: keyof AutomationGraphNode, val: unknown) => {
                       setNodes(prev => prev.map(n => n.id === node.id ? { ...n, [key]: val } : n));
                   };

                   const handleKindChange = (kind: string) => {
                       setNodes(prev => prev.map(n => {
                           if (n.id !== node.id) return n;
                           if (n.type === "trigger" && kind === TIME_TRIGGER_KIND) {
                               return { ...n, kind, config: { ui: n.config.ui, ...buildTimeTriggerConfig(n.config) } };
                           }
                           const nextMetric =
                               kind === DEVICE_VALUE_TRIGGER_KIND || kind === "numeric_compare"
                                   ? resolveNumericMetricForPin(selectedPinObj, selectedDevice?.last_state, n.config.metric)
                                   : undefined;
                           return {
                               ...n,
                               kind,
                               config: { ui: n.config.ui, device_id: n.config.device_id, pin: n.config.pin, metric: nextMetric },
                           };
                       }));
                   };
                   
                   const handleSetDevice = (device_id: string) => {
                       setNodes(prev => prev.map(n => n.id === node.id ? { ...n, config: { ui: n.config.ui, device_id, pin: undefined, metric: undefined } } : n));
                   };
                   
                   const handleSetPin = (pin: number, pinMeta?: PinConfig) => {
                       setNodes(prev => prev.map(n => {
                           if (n.id === node.id) {
                               const nextKind = n.type === "trigger" ? getPreferredTriggerKindForPin(pinMeta, selectedDevice?.last_state) : n.kind;
                               const nextMetric =
                                   n.type === "trigger"
                                       ? resolveNumericMetricForPin(pinMeta, selectedDevice?.last_state, n.config.metric)
                                       : n.kind === "numeric_compare"
                                           ? resolveNumericMetricForPin(pinMeta, selectedDevice?.last_state, n.config.metric)
                                           : undefined;
                               const newConfig = { ...n.config, pin, metric: nextMetric };
                               delete newConfig.operator;
                               delete newConfig.value;
                               delete newConfig.secondary_value;
                               delete newConfig.expected;
                               if (nextKind === 'state_equals') newConfig.expected = 'on';
                               if (nextKind === 'numeric_compare') { newConfig.operator = 'gt'; newConfig.value = 0; }
                               if (nextKind === 'set_output') newConfig.value = 1;
                               if (nextKind === 'set_value') newConfig.value = 0;
                               return { ...n, kind: nextKind, config: newConfig };
                           }
                           return n;
                       }));
                   };

                   const handleSetMetric = (metric: "temperature" | "humidity") => {
                       updateConfig("metric", metric);
                   };

                   const isTimeTriggerNode = node.type === "trigger" && node.kind === TIME_TRIGGER_KIND;
                   const isVirtualNode = isTimeTriggerNode || (node.type === "action" && node.kind === TELEGRAM_ACTION_KIND);
                   const selectedDevice = devices.find(d => d.device_id === node.config.device_id);
                   const selectedPinObj = selectedDevice?.pin_configurations.find(p => p.gpio_pin === node.config.pin);
                   const compatiblePins = selectedDevice?.pin_configurations.filter(p => {
                       if (node.type === "action" && node.kind === "set_output") return p.mode === "OUTPUT";
                       if (node.type === "action" && node.kind === "set_value") return p.mode === "PWM";
                       return true;
                   }) || [];
                   const triggerKindOptions = [
                     { k: TIME_TRIGGER_KIND, l: "Time", enabled: true },
                     { k: DEVICE_ON_OFF_TRIGGER_KIND, l: "On/Off Event", enabled: !selectedPinObj || isSwitchPin(selectedPinObj, selectedDevice?.last_state) },
                     { k: DEVICE_VALUE_TRIGGER_KIND, l: "Device Value", enabled: !selectedPinObj || isNumericPin(selectedPinObj, selectedDevice?.last_state) },
                   ];

                   return (
                     <div className="p-4 space-y-6">
                         {/* 1. General Setup */}
                         <div className="space-y-4">
                             <div>
                                 <span className="text-xs font-bold text-slate-500 block mb-2">Purpose</span>
                                 <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                                     {node.type === "trigger" && triggerKindOptions.map(opt => (
                                         <button
                                            key={opt.k}
                                            type="button"
                                            disabled={!opt.enabled}
                                            onClick={() => opt.enabled && handleKindChange(opt.k)}
                                            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${node.kind === opt.k ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-200' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                                         >
                                            {opt.l}
                                         </button>
                                     ))}
                                     {node.type === "condition" && [
                                         { k: "state_equals", l: "State Equals" },
                                         { k: "numeric_compare", l: "Numeric Compare" }
                                     ].map(opt => (
                                         <button key={opt.k} onClick={() => handleKindChange(opt.k)} className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition ${node.kind === opt.k ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-200' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                                            {opt.l}
                                         </button>
                                     ))}
                                     {node.type === "action" && node.kind !== TELEGRAM_ACTION_KIND && [
                                         { k: "set_output", l: "Turn On/Off" },
                                         { k: "set_value", l: "Set Value" }
                                     ].map(opt => (
                                         <button key={opt.k} onClick={() => handleKindChange(opt.k)} className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition ${node.kind === opt.k ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-200' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                                            {opt.l}
                                         </button>
                                     ))}
                                     {node.type === "action" && node.kind === TELEGRAM_ACTION_KIND && [
                                         { k: TELEGRAM_ACTION_KIND, l: "Telegram" }
                                     ].map(opt => (
                                         <button key={opt.k} onClick={() => handleKindChange(opt.k)} className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition ${node.kind === opt.k ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-200' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                                            {opt.l}
                                         </button>
                                     ))}
                                 </div>
                             </div>
                             
                             <label className="block">
                                 <span className="text-xs font-bold text-slate-500 block mb-1">Optional Label</span>
                                 <input name="node-label" value={node.label || ""} onChange={(e) => updateNode('label', e.target.value)} placeholder={`e.g. Check temperature`} className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary placeholder:text-slate-400" />
                             </label>
                         </div>

                         {/* 2. Device Selection */}
                         {!isVirtualNode && (
                             <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                                 <span className="text-xs font-bold text-slate-500 block">Target Device</span>
                                 <select name="node-target-device" value={node.config.device_id || ""} onChange={(e) => handleSetDevice(e.target.value)} className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer">
                                    <option value="">Select a device...</option>
                                    {devices.map(d => <option key={d.device_id} value={d.device_id}>{d.name} {d.conn_status === "online" ? "🟢" : "⚪"}</option>)}
                                 </select>
                             </div>
                         )}

                         {/* 3. Pin Selection */}
                         {!isVirtualNode && node.config.device_id && (
                             <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                                 <span className="text-xs font-bold text-slate-500 block">Target Pin / Function</span>
                                 {compatiblePins.length === 0 ? (
                                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30">
                                        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium flex items-start gap-2">
                                            <span className="material-icons-round text-sm mt-0.5">warning</span>
                                            This device has no compatible pins configured for this action type.
                                        </p>
                                    </div>
                                 ) : (
                                    <div className="grid grid-cols-2 gap-2">
                                        {compatiblePins.map(pin => (
                                            <button 
                                                key={pin.gpio_pin}
                                                onClick={() => handleSetPin(pin.gpio_pin, pin)}
                                                className={`flex flex-col text-left p-2 border rounded-lg transition-colors ${node.config.pin === pin.gpio_pin ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900'}`}
                                            >
                                                <div className="flex items-center justify-between mb-1 w-full gap-2">
                                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">GPIO {pin.gpio_pin}</span>
                                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">{pin.mode}</span>
                                                </div>
                                                <span className="text-[11px] text-slate-500 truncate w-full">{pin.label || pin.function || "Unnamed"}</span>
                                            </button>
                                        ))}
                                    </div>
                                 )}
                             </div>
                         )}

                         {!isTimeTriggerNode && node.type === "trigger" && node.kind === DEVICE_VALUE_TRIGGER_KIND && isDhtPin(selectedPinObj, selectedDevice?.last_state) && (
                             <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                                 <MetricSelector value={node.config.metric as string | undefined} onChange={handleSetMetric} />
                             </div>
                         )}

                         {/* 4. Logic/Action Configuration */}
                         {node.kind === TELEGRAM_ACTION_KIND && (
                             <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                                 <div>
                                     <span className="text-xs font-bold text-slate-500 block mb-1">Bot API Key</span>
                                     <input 
                                         type="password" 
                                         value={node.config.bot_api_key || ""} 
                                         onChange={(e) => updateConfig("bot_api_key", e.target.value)} 
                                         placeholder="e.g. 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" 
                                         className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono shadow-sm"
                                     />
                                 </div>
                                 <div>
                                     <span className="text-xs font-bold text-slate-500 block mb-1">Target Chat ID</span>
                                     <input 
                                         type="text" 
                                         value={node.config.chat_id || ""} 
                                         onChange={(e) => updateConfig("chat_id", e.target.value)} 
                                         placeholder="e.g. 987654321" 
                                         className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono shadow-sm"
                                     />
                                 </div>
                                 <div>
                                     <div className="flex items-center justify-between mb-1">
                                         <span className="text-xs font-bold text-slate-500 block">Message Template <span className="font-normal text-slate-400">(Optional)</span></span>
                                     </div>
                                     <textarea 
                                         value={node.config.message || ""} 
                                         onChange={(e) => updateConfig("message", e.target.value)} 
                                         placeholder="If left empty, system will auto-generate message." 
                                         className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary min-h-20 shadow-sm resize-y"
                                     />
                                 </div>
                             </div>
                         )}
                         {isTimeTriggerNode && (
                             <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                                 <div>
                                     <span className="text-xs font-bold text-slate-500 block mb-2">Run at</span>
                                     <input
                                         name="node-trigger-time"
                                         type="time"
                                         value={formatTimeTriggerValue(node.config)}
                                         onChange={(e) => {
                                             const [hourRaw, minuteRaw] = e.target.value.split(":");
                                             updateConfig("hour", Number.parseInt(hourRaw ?? "0", 10));
                                             updateConfig("minute", Number.parseInt(minuteRaw ?? "0", 10));
                                         }}
                                         className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono"
                                     />
                                 </div>
                                 <div>
                                     <span className="text-xs font-bold text-slate-500 block mb-2">Weekdays</span>
                                     <div className="flex flex-wrap gap-2">
                                         {TIME_TRIGGER_WEEKDAY_OPTIONS.map((option) => {
                                             const weekdays = getTimeTriggerWeekdays(node.config);
                                             const active = weekdays.includes(option.value);
                                             return (
                                                 <button
                                                     key={option.value}
                                                     type="button"
                                                     onClick={() => updateConfig("weekdays", active ? weekdays.filter((value) => value !== option.value) : [...weekdays, option.value])}
                                                     className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition ${active ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}
                                                 >
                                                     {option.label}
                                                 </button>
                                             );
                                         })}
                                     </div>
                                     <p className="mt-2 text-[11px] text-slate-500">Leave empty to run every day using the current server timezone.</p>
                                 </div>
                                 <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/60">
                                     <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Server Clock</div>
                                     <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{scheduleContext?.effective_timezone ?? "Server timezone unavailable"}</p>
                                     <p className="mt-1 text-xs text-slate-500">Current server time: {formatServerTimePreview(scheduleContext?.current_server_time, scheduleContext?.effective_timezone)}</p>
                                 </div>
                             </div>
                         )}

                         {!isTimeTriggerNode && node.config.pin !== undefined && (
                             <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                                 {node.kind === "state_equals" && (
                                     <div>
                                         <span className="text-xs font-bold text-slate-500 block mb-2">Expected State</span>
                                         <div className="flex gap-2">
                                             <button onClick={() => updateConfig("expected", "off")} className={`flex-1 py-2 rounded-lg font-bold text-sm border transition shadow-sm ${node.config.expected === "off" ? 'bg-slate-800 border-slate-900 text-white dark:bg-slate-700 dark:border-slate-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>OFF</button>
                                             <button onClick={() => updateConfig("expected", "on")} className={`flex-1 py-2 rounded-lg font-bold text-sm border transition shadow-sm ${node.config.expected === "on" ? 'bg-emerald-500 border-emerald-600 text-white dark:bg-emerald-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>ON</button>
                                         </div>
                                     </div>
                                 )}

                                 {node.kind === "numeric_compare" && (
                                     <div className="space-y-3">
                                         {isDhtPin(selectedPinObj, selectedDevice?.last_state) && (
                                             <MetricSelector value={node.config.metric as string | undefined} onChange={handleSetMetric} />
                                         )}
                                         <span className="text-xs font-bold text-slate-500 block">Condition</span>
                                         <div className="flex flex-wrap gap-1.5">
                                             {['gt', 'gte', 'lt', 'lte', 'between'].map(op => (
                                                 <button 
                                                    key={op} 
                                                    onClick={() => updateConfig("operator", op)}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono border transition shadow-sm ${node.config.operator === op ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/50 dark:border-blue-700 dark:text-blue-300' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}
                                                 >
                                                    {op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : op === 'lte' ? '<=' : 'between'}
                                                 </button>
                                             ))}
                                         </div>
                                         <div className="flex gap-2 items-center">
                                             <input name="node-condition-value" type="number" value={String(node.config.value ?? "")} onChange={(e) => updateConfig("value", parseFloat(e.target.value))} placeholder="Value" className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono shadow-sm" />
                                             {node.config.operator === "between" && (
                                                 <>
                                                     <span className="text-sm font-semibold text-slate-400">and</span>
                                                     <input name="node-condition-secondary-value" type="number" value={String(node.config.secondary_value ?? "")} onChange={(e) => updateConfig("secondary_value", parseFloat(e.target.value))} placeholder="Max" className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono shadow-sm" />
                                                 </>
                                             )}
                                         </div>
                                     </div>
                                 )}

                                 {node.kind === "set_output" && (
                                     <div>
                                         <span className="text-xs font-bold text-slate-500 block mb-2">Set Pin State To</span>
                                         <div className="flex gap-2">
                                             <button onClick={() => updateConfig("value", 0)} className={`flex-1 py-2 rounded-lg font-bold text-sm border transition shadow-sm ${node.config.value === 0 ? 'bg-slate-800 border-slate-900 text-white dark:bg-slate-700 dark:border-slate-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>OFF</button>
                                             <button onClick={() => updateConfig("value", 1)} className={`flex-1 py-2 rounded-lg font-bold text-sm border transition shadow-sm ${node.config.value === 1 ? 'bg-emerald-500 border-emerald-600 text-white dark:bg-emerald-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>ON</button>
                                         </div>
                                     </div>
                                 )}

                                 {node.kind === "set_value" && (
                                     <div>
                                         <span className="text-xs font-bold text-slate-500 block mb-2">Set PWM Value</span>
                                         <div className="flex gap-3 items-center">
                                             <input name="node-target-pwm-range" type="range" min="0" max="255" value={String(node.config.value ?? 0)} onChange={(e) => updateConfig('value', parseFloat(e.target.value))} className="flex-1 accent-primary" />
                                             <input name="node-target-pwm-value" type="number" min="0" max="255" value={String(node.config.value ?? 0)} onChange={(e) => updateConfig("value", parseFloat(e.target.value))} className="w-20 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 outline-none focus:border-primary font-mono text-center shadow-sm" />
                                         </div>
                                     </div>
                                 )}
                             </div>
                         )}

                         {/* Debug display of ID */}
                         <div className="pt-8 mb-4 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center opacity-60 hover:opacity-100 transition-opacity">
                             <div className="flex items-center gap-1.5 text-slate-400">
                                <span className="material-icons-round text-[14px]">info</span>
                                <span className="text-[10px] font-mono">ID: {node.id.split('_')[1]}</span>
                             </div>
                             {(isTimeTriggerNode || node.config.pin !== undefined) && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 text-[10px] font-bold uppercase">Ready</span>
                             )}
                         </div>
                     </div>
                   );
               })() : (
                   <div className="p-8 text-center flex flex-col items-center justify-center h-48 opacity-70">
                       <span className="material-icons-round text-4xl text-slate-300 dark:text-slate-600 mb-3">touch_app</span>
                       <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Select a node to configure</span>
                       <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 max-w-[200px] leading-relaxed">Click any node on the canvas to set up its logic and device bindings.</p>
                   </div>
               )}

               {/* Last run result inside right panel bottom */}
               {lastResult && activeAutomation && !selectedNodeId && (
                   <div className="p-5 border-t border-slate-200 dark:border-slate-700 m-4 rounded-xl bg-slate-50 dark:bg-slate-900 border">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Execution Result</span>
                      {(() => {
                         const isConditionMiss = lastResult.log?.error_message === "No action applied because no branch passed all conditions.";
                         const displayStatus = isConditionMiss ? "skipped" : lastResult.status;
                         const statusClasses = isConditionMiss 
                             ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                             : lastResult.status === 'success' 
                                 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400' 
                                 : 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400';
                         
                         return (
                            <>
                                <span className={`text-xs font-bold px-2 py-1 rounded inline-block mb-3 uppercase ${statusClasses}`}>
                                    {displayStatus}
                                </span>
                                {lastResult.log?.error_message && (
                                    <div className={`text-xs font-mono whitespace-pre-wrap mb-2 ${isConditionMiss ? "text-slate-500 dark:text-slate-400" : "text-rose-500"}`}>
                                        {isConditionMiss ? "Condition not met: Execution stopped." : lastResult.log.error_message}
                                    </div>
                                )}
                                {lastResult.log?.log_output && (
                                    <div className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap mt-2 max-h-40 overflow-y-auto hidden-scrollbar">
                                        {lastResult.log.log_output}
                                    </div>
                                )}
                                {!lastResult.log && <div className="text-xs italic text-slate-500">{lastResult.message}</div>}
                            </>
                         );
                      })()}
                   </div>
               )}
                </div>
            </aside>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
