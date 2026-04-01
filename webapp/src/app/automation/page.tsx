"use client";

import { API_URL } from "@/lib/api";
import { getToken } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { fetchDashboardDevices } from "@/lib/api";
import { DeviceConfig } from "@/types/device";

// --- Types ---

export type AutomationNodeType = "trigger" | "condition" | "action";
export type ExecutionStatus = "success" | "failed";

export interface AutomationGraphNodeConfig {
  ui?: { x: number; y: number };
  device_id?: string;
  pin?: number;
  operator?: string;
  value?: number | string | boolean;
  secondary_value?: number | string | boolean;
  expected?: string | number | boolean;
  [key: string]: unknown;
}

export interface AutomationGraphNode {
  id: string;
  type: AutomationNodeType;
  kind: string; // e.g. "device_state", "schedule_daily", "send_command"
  label?: string | null;
  config: AutomationGraphNodeConfig;
}

export interface AutomationGraphEdge {
  source_node_id: string;
  source_port: string;
  target_node_id: string;
  target_port: string;
}

export interface AutomationGraph {
  nodes: AutomationGraphNode[];
  edges: AutomationGraphEdge[];
}

export interface ExecutionLog {
  id: number;
  automation_id: number;
  triggered_at: string;
  status: ExecutionStatus;
  trigger_source?: "manual" | "device_state" | "schedule";
  log_output: string | null;
  error_message: string | null;
}

export interface TriggerResult {
  status: ExecutionStatus;
  message: string;
  log: ExecutionLog | null;
}

export interface AutomationRecord {
  id: number;
  name: string;
  is_enabled: boolean;
  graph?: AutomationGraph;
  creator_id: number;
  last_triggered: string | null;
  last_execution: ExecutionLog | null;
  script_code?: string;
  schedule_type?: string;
  timezone?: string | null;
  schedule_hour?: number | null;
  schedule_minute?: number | null;
  schedule_weekdays?: string[];
  next_run_at?: string | null;
}

interface DraftAutomation {
  name: string;
  is_enabled: boolean;
  graph: AutomationGraph;
  last_triggered: string | null;
  last_execution: ExecutionLog | null;
}

type GraphAutomationPayload = {
  name: string;
  is_enabled: boolean;
  graph: AutomationGraph;
};

type LegacyAutomationPayload = {
  name: string;
  is_enabled: boolean;
  script_code: string;
  schedule_type?: string;
  timezone?: string | null;
  schedule_hour?: number | null;
  schedule_minute?: number | null;
  schedule_weekdays?: string[];
};

type AutomationMutationPayload = GraphAutomationPayload | LegacyAutomationPayload;

type AutomationListFilter = "all" | "enabled" | "disabled";

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
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string | { message?: string }; message?: string };
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail;
    if (payload.detail && typeof payload.detail === "object" && typeof payload.detail.message === "string") {
      return payload.detail.message;
    }
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  } catch {
    // Ignore invalid JSON bodies and fall back to status-based messaging.
  }
  return `${fallback}: ${response.status}`;
}

async function fetchAutomations(): Promise<AutomationRecord[]> {
  const res = await fetch(`${API_URL}/automations`, { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error(await readApiError(res, "Failed to load automations"));
  return res.json() as Promise<AutomationRecord[]>;
}

async function createAutomation(payload: GraphAutomationPayload): Promise<AutomationRecord> {
  const res = await fetch(`${API_URL}/automation`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await readApiError(res, "Create failed"));
  return res.json();
}

async function updateAutomation(id: number, payload: AutomationMutationPayload): Promise<AutomationRecord> {
  const res = await fetch(`${API_URL}/automation/${id}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await readApiError(res, "Update failed"));
  return res.json();
}

async function deleteAutomation(id: number): Promise<{ message: string }> {
  const res = await fetch(`${API_URL}/automation/${id}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (!res.ok) throw new Error(await readApiError(res, "Delete failed"));
  return res.json();
}

async function triggerAutomation(id: number): Promise<TriggerResult> {
  const res = await fetch(`${API_URL}/automation/${id}/trigger`, {
    method: "POST",
    headers: authHeaders()
  });
  if (!res.ok) throw new Error(await readApiError(res, "Trigger failed"));
  return res.json();
}

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

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
        <span className="material-icons-round text-4xl text-primary">account_tree</span>
      </div>
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">No automations yet</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400 max-w-sm">
          Create an automation graph. Build rules to react to your devices in real-time.
        </p>
      </div>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-white transition hover:bg-blue-600 shadow"
      >
        <span className="material-icons-round text-sm">add</span> Add Automation
      </button>
    </div>
  );
}

// --- Node Ports Logic ---
interface PortDefinition {
  id: string;
  label: string;
  type: "in" | "out";
  offset: { x: number; y: number };
}

const NODE_WIDTH = 260;
const NODE_HEIGHT = 100;
const CANVAS_BASE_X = 260;
const CANVAS_BASE_Y = 320;
const CANVAS_HORIZONTAL_GAP = 400;
const CANVAS_VERTICAL_GAP = 220;
const CANVAS_FIT_PADDING = 120;
const MIN_CANVAS_SCALE = 0.2;
const MAX_CANVAS_SCALE = 1;
const NODE_TYPE_ORDER: Record<AutomationNodeType, number> = {
  trigger: 0,
  condition: 1,
  action: 2,
};

function getEmptyGraph(): AutomationGraph {
  return { nodes: [], edges: [] };
}

function cloneGraph(graph?: AutomationGraph): AutomationGraph {
  if (!graph) return getEmptyGraph();
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      config: { ...node.config, ui: node.config.ui ? { ...node.config.ui } : undefined },
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function stripGraphUi(graph: AutomationGraph): AutomationGraph {
  return {
    nodes: graph.nodes.map((node) => {
      const restConfig = { ...node.config };
      delete restConfig.ui;
      return { ...node, config: restConfig };
    }),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function getEdgeKey(edge: AutomationGraphEdge): string {
  return `${edge.source_node_id}-${edge.source_port}-${edge.target_node_id}-${edge.target_port}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function isAutomationPortTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("[data-automation-port='true']"));
}

function buildConnectionEdge(first: PortSelection, second: PortSelection): AutomationGraphEdge | null {
  if (first.nodeId === second.nodeId || first.type === second.type) {
    return null;
  }

  const source = first.type === "out" ? first : second;
  const target = first.type === "in" ? first : second;

  return {
    source_node_id: source.nodeId,
    source_port: source.portId,
    target_node_id: target.nodeId,
    target_port: target.portId,
  };
}

function graphNeedsReadableLayout(graph?: AutomationGraph): boolean {
  if (!graph || graph.nodes.length === 0) return false;
  const positions = new Set<string>();

  for (const node of graph.nodes) {
    const ui = node.config.ui;
    if (!ui || typeof ui.x !== "number" || typeof ui.y !== "number") return true;
    positions.add(`${Math.round(ui.x)}:${Math.round(ui.y)}`);
  }

  return positions.size !== graph.nodes.length;
}

function layoutGraphForCanvas(graph?: AutomationGraph): AutomationGraph {
  const cloned = cloneGraph(graph);
  if (cloned.nodes.length === 0 || !graphNeedsReadableLayout(cloned)) {
    return cloned;
  }

  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const levels = new Map<string, number>();

  for (const node of cloned.nodes) {
    outgoing.set(node.id, []);
    incomingCount.set(node.id, 0);
    if (node.type === "trigger") levels.set(node.id, 0);
  }

  for (const edge of cloned.edges) {
    outgoing.get(edge.source_node_id)?.push(edge.target_node_id);
    incomingCount.set(edge.target_node_id, (incomingCount.get(edge.target_node_id) ?? 0) + 1);
  }

  const queue = cloned.nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .sort((left, right) => NODE_TYPE_ORDER[left.type] - NODE_TYPE_ORDER[right.type] || left.id.localeCompare(right.id))
    .map((node) => node.id);

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;
    const currentLevel = levels.get(currentId) ?? 0;

    for (const targetId of outgoing.get(currentId) ?? []) {
      levels.set(targetId, Math.max(levels.get(targetId) ?? 0, currentLevel + 1));
      const nextIncoming = (incomingCount.get(targetId) ?? 0) - 1;
      incomingCount.set(targetId, nextIncoming);
      if (nextIncoming === 0) queue.push(targetId);
    }
  }

  for (const node of cloned.nodes) {
    if (!levels.has(node.id)) {
      levels.set(node.id, NODE_TYPE_ORDER[node.type]);
    }
  }

  const groupedByLevel = new Map<number, AutomationGraphNode[]>();
  for (const node of cloned.nodes) {
    const level = levels.get(node.id) ?? 0;
    const group = groupedByLevel.get(level) ?? [];
    group.push(node);
    groupedByLevel.set(level, group);
  }

  for (const [level, group] of groupedByLevel.entries()) {
    group.sort((left, right) => {
      const typeDelta = NODE_TYPE_ORDER[left.type] - NODE_TYPE_ORDER[right.type];
      if (typeDelta !== 0) return typeDelta;
      return getNodeDisplayName(left).localeCompare(getNodeDisplayName(right));
    });

    const groupStartY = CANVAS_BASE_Y - ((group.length - 1) * CANVAS_VERTICAL_GAP) / 2;
    group.forEach((node, index) => {
      node.config = {
        ...node.config,
        ui: {
          x: CANVAS_BASE_X + level * CANVAS_HORIZONTAL_GAP,
          y: groupStartY + index * CANVAS_VERTICAL_GAP,
        },
      };
    });
  }

  return cloned;
}

function getGraphBounds(nodes: AutomationGraphNode[]) {
  if (nodes.length === 0) return null;

  const left = Math.min(...nodes.map((node) => node.config.ui?.x ?? 0));
  const top = Math.min(...nodes.map((node) => node.config.ui?.y ?? 0));
  const right = Math.max(...nodes.map((node) => (node.config.ui?.x ?? 0) + NODE_WIDTH));
  const bottom = Math.max(...nodes.map((node) => (node.config.ui?.y ?? 0) + NODE_HEIGHT));

  return {
    left,
    top,
    width: Math.max(right - left, NODE_WIDTH),
    height: Math.max(bottom - top, NODE_HEIGHT),
  };
}

function buildStarterGraph(seed = Date.now()): AutomationGraph {
  const triggerId = `trigger_${seed}`;
  const conditionId = `condition_${seed}`;
  const actionId = `action_${seed}`;

  return {
    nodes: [
      { id: triggerId, type: "trigger", kind: "device_state", label: "When...", config: { ui: { x: 50, y: 150 } } },
      { id: conditionId, type: "condition", kind: "state_equals", label: "Check...", config: { ui: { x: 340, y: 150 } } },
      { id: actionId, type: "action", kind: "set_output", label: "Then...", config: { ui: { x: 630, y: 150 } } },
    ],
    edges: [
      { source_node_id: triggerId, source_port: "event_out", target_node_id: conditionId, target_port: "event_in" },
      { source_node_id: conditionId, source_port: "pass_out", target_node_id: actionId, target_port: "event_in" },
    ],
  };
}

function getNodeDisplayName(node: Pick<AutomationGraphNode, "label" | "kind"> | null | undefined): string {
  if (!node) return "Unconfigured step";
  const base = (node.label || node.kind || "step").trim();
  return base.replaceAll("_", " ");
}

function formatAutomationRunTime(value: string | null | undefined): string {
  if (!value) return "Never run";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown run time";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getAutomationGraphSummary(graph?: AutomationGraph): string {
  if (!graph) return "Waiting for graph data.";
  if (graph.nodes.length === 0) return "No blocks yet.";
  const linear = getLinearRule(graph.nodes, graph.edges);
  if (linear) {
    return `${getNodeDisplayName(linear.trigger)} -> ${getNodeDisplayName(linear.condition)} -> ${getNodeDisplayName(linear.action)}`;
  }
  return `${graph.nodes.length} blocks and ${graph.edges.length} links in this workflow.`;
}

function getAutomationGraphReadiness(graph?: AutomationGraph): { label: string; tone: string } {
  if (!graph) return { label: "Legacy", tone: "slate" };
  if (graph.nodes.length === 0) return { label: "Empty", tone: "amber" };
  const linear = getLinearRule(graph.nodes, graph.edges);
  if (!linear) return { label: "Custom", tone: "blue" };

  const triggerReady = Boolean(linear.trigger.config.device_id) && linear.trigger.config.pin !== undefined;
  const actionReady = Boolean(linear.action.config.device_id) && linear.action.config.pin !== undefined;
  const conditionReady =
    linear.condition.kind === "numeric_compare"
      ? linear.condition.config.value !== undefined
      : linear.condition.config.expected !== undefined || linear.condition.config.pin !== undefined;

  if (triggerReady && actionReady && conditionReady) return { label: "Ready", tone: "emerald" };
  return { label: "Draft", tone: "amber" };
}

function getReadinessClasses(tone: string): string {
  switch (tone) {
    case "emerald":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "blue":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "amber":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    default:
      return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
}

function isLegacyAutomation(automation: AutomationRecord): automation is AutomationRecord & { script_code: string } {
  return typeof automation.script_code === "string";
}

function buildGraphAutomationPayload(automation: AutomationRecord, graph: AutomationGraph): GraphAutomationPayload {
  return {
    name: automation.name,
    is_enabled: automation.is_enabled,
    graph,
  };
}

function buildRenamePayload(automation: AutomationRecord, nextName: string, graph: AutomationGraph): AutomationMutationPayload {
  if (isLegacyAutomation(automation)) {
    return {
      name: nextName,
      is_enabled: automation.is_enabled,
      script_code: automation.script_code,
      schedule_type: automation.schedule_type,
      timezone: automation.timezone ?? null,
      schedule_hour: automation.schedule_hour ?? null,
      schedule_minute: automation.schedule_minute ?? null,
      schedule_weekdays: automation.schedule_weekdays ?? [],
    };
  }

  return {
    ...buildGraphAutomationPayload(automation, graph),
    name: nextName,
  };
}

export function getLinearRule(nodes: AutomationGraphNode[], edges: AutomationGraphEdge[]) {
  if (nodes.length !== 3 || edges.length !== 2) return null;
  const trigger = nodes.find(n => n.type === "trigger");
  const condition = nodes.find(n => n.type === "condition");
  const action = nodes.find(n => n.type === "action");
  if (!trigger || !condition || !action) return null;
  const e1 = edges.find(e => e.source_node_id === trigger.id && e.target_node_id === condition.id);
  const e2 = edges.find(e => e.source_node_id === condition.id && e.target_node_id === action.id);
  if (!e1 || !e2) return null;
  return { trigger, condition, action };
}

export function isNumericPin(p: { mode?: string; function?: string | null } | undefined | null) {
  return p?.mode === "ADC" || p?.mode === "DHT22" || p?.mode === "PWM" || p?.function?.toLowerCase().includes("temp") || p?.function?.toLowerCase().includes("hum") || p?.function?.toLowerCase().includes("moisture");
}

export function isSwitchPin(p: { mode?: string; function?: string | null } | undefined | null) {
  return p?.mode === "INPUT" || p?.mode === "OUTPUT" || p?.function?.toLowerCase().includes("switch") || p?.function?.toLowerCase().includes("btn") || p?.function?.toLowerCase().includes("button") || p?.function?.toLowerCase().includes("relay") || p?.function?.toLowerCase().includes("contact") || p?.function?.toLowerCase().includes("pir");
}

function getNodePorts(type: AutomationNodeType): PortDefinition[] {
  switch (type) {
    case "trigger":
      return [{ id: "event_out", label: "Triggered", type: "out", offset: { x: NODE_WIDTH / 2, y: NODE_HEIGHT } }];
    case "condition":
      return [
        { id: "event_in", label: "In", type: "in", offset: { x: NODE_WIDTH / 2, y: 0 } },
        { id: "pass_out", label: "True", type: "out", offset: { x: NODE_WIDTH * 0.75, y: NODE_HEIGHT } },
        { id: "fail_out", label: "False", type: "out", offset: { x: NODE_WIDTH * 0.25, y: NODE_HEIGHT } }
      ];
    case "action":
      return [{ id: "event_in", label: "Execute", type: "in", offset: { x: NODE_WIDTH / 2, y: 0 } }];
  }
}

// --- Main Page ---

export default function AutomationPage() {
  const transformRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftAutomation, setDraftAutomation] = useState<DraftAutomation | null>(null);
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [fetchError, setFetchError] = useState("");

  const [saving, setSaving] = useState(false);
  const [triggerState, setTriggerState] = useState<"idle" | "pending" | "done">("idle");
  const [lastResult, setLastResult] = useState<TriggerResult | null>(null);
  const [automationFilter, setAutomationFilter] = useState<AutomationListFilter>("all");
  const [automationSearch, setAutomationSearch] = useState("");
  const [canvasScale, setCanvasScale] = useState(1);
  const [pendingCanvasFit, setPendingCanvasFit] = useState(false);
  const deferredAutomationSearch = useDeferredValue(automationSearch.trim().toLowerCase());

  // Graph state for currently selected automation
  const [nodes, setNodes] = useState<AutomationGraphNode[]>([]);
  const [edges, setEdges] = useState<AutomationGraphEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Drag & drop port connections
  const [connectingFrom, setConnectingFrom] = useState<PortSelection | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Basic modales
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deletePending, setDeletePending] = useState(false);

  const selectedAutomation = automations.find((a) => a.id === selectedId) ?? null;
  const activeAutomation = selectedAutomation ?? draftAutomation;
  const isDraftSelection = selectedAutomation === null && draftAutomation !== null;
  const linearRule = activeAutomation ? getLinearRule(nodes, edges) : null;
  const selectedGraph = { nodes, edges };
  const selectedReadiness = getAutomationGraphReadiness(selectedGraph);
  const selectedSummary = getAutomationGraphSummary(selectedGraph);
  const graphDirty = isDraftSelection
    ? true
    : selectedAutomation
    ? JSON.stringify(stripGraphUi(selectedAutomation.graph ?? getEmptyGraph())) !== JSON.stringify(stripGraphUi(selectedGraph))
    : false;
  const filteredAutomations = automations.filter((automation) => {
    if (automationFilter === "enabled" && !automation.is_enabled) return false;
    if (automationFilter === "disabled" && automation.is_enabled) return false;
    if (!deferredAutomationSearch) return true;
    const haystack = [
      automation.name,
      getAutomationGraphSummary(automation.graph),
      automation.last_execution?.status,
      automation.last_triggered,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(deferredAutomationSearch);
  });
  const enabledAutomations = filteredAutomations.filter((automation) => automation.is_enabled);
  const disabledAutomations = filteredAutomations.filter((automation) => !automation.is_enabled);

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
      const [list, dList] = await Promise.all([
        fetchAutomations(),
        fetchDashboardDevices().catch(() => [])
      ]);
      setAutomations(list);
      setDevices(dList);
      if (list.length > 0 && selectedId === null && !draftAutomation) {
        setSelectedId(list[0].id);
        const initialGraph = layoutGraphForCanvas(list[0].graph ?? getEmptyGraph());
        setNodes(initialGraph.nodes);
        setEdges(initialGraph.edges);
        setPendingCanvasFit(true);
      }
      setPageState(list.length === 0 && !draftAutomation ? "empty" : "loaded");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load.");
      setPageState("error");
    }
  }, [draftAutomation, selectedId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Update local graph state when selection changes
  useEffect(() => {
    if (selectedAutomation) {
      const displayGraph = layoutGraphForCanvas(selectedAutomation.graph ?? getEmptyGraph());
      setNodes(displayGraph.nodes);
      setEdges(displayGraph.edges);
      setPendingCanvasFit(true);
      setSelectedNodeId(null);
      setLastResult(selectedAutomation.last_execution ? { status: selectedAutomation.last_execution.status, message: "Last run from record", log: selectedAutomation.last_execution } : null);
      return;
    }
    if (draftAutomation && selectedId === null) {
      const displayGraph = layoutGraphForCanvas(draftAutomation.graph);
      setNodes(displayGraph.nodes);
      setEdges(displayGraph.edges);
      setPendingCanvasFit(true);
      setSelectedNodeId(null);
      setLastResult(null);
      return;
    }
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setLastResult(null);
  }, [draftAutomation, selectedAutomation, selectedId]);

  useEffect(() => {
    if (!pendingCanvasFit || nodes.length === 0) return;

    const frame = window.requestAnimationFrame(() => {
      fitGraphToCanvas(nodes);
      setPendingCanvasFit(false);
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

  async function handleCreateNew() {
    const trimmedName = newName.trim();
    if (!trimmedName) return;
    const starterGraph = buildStarterGraph();
    setDraftAutomation({
      name: trimmedName,
      is_enabled: true,
      graph: starterGraph,
      last_triggered: null,
      last_execution: null,
    });
    setSelectedId(null);
    setNodes(starterGraph.nodes);
    setEdges(starterGraph.edges);
    setPendingCanvasFit(true);
    setSelectedNodeId(starterGraph.nodes[0]?.id ?? null);
    setLastResult(null);
    setCreating(false);
    setNewName("");
    setPageState("loaded");
  }

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
    if (!activeAutomation) return;
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
        buildRenamePayload(selectedAutomation, trimmedName, { nodes, edges })
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
    try {
      setSaving(true);
      if (isDraftSelection && draftAutomation) {
        const saved = await createAutomation({
          name: draftAutomation.name,
          is_enabled: draftAutomation.is_enabled,
          graph: { nodes, edges },
        });
        setAutomations((prev) => [...prev, saved]);
        setSelectedId(saved.id);
        setDraftAutomation(null);
      } else if (selectedAutomation) {
        const payload = buildGraphAutomationPayload(selectedAutomation, { nodes, edges });
        const saved = await updateAutomation(selectedAutomation.id, payload);
        setAutomations((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
      }
      alert("Graph saved successfully!");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to save graph.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAutomation() {
    if (!activeAutomation) return;

    if (isDraftSelection) {
      const nextAutomation = automations[0] ?? null;
      setDraftAutomation(null);
      setSelectedId(nextAutomation?.id ?? null);
      setPageState(nextAutomation ? "loaded" : "empty");
      setTriggerState("idle");
      setLastResult(null);
      setDeleteOpen(false);
      setDeleteError("");
      return;
    }

    if (!selectedAutomation) return;

    try {
      setDeletePending(true);
      setDeleteError("");
      await deleteAutomation(selectedAutomation.id);
      const remaining = automations.filter((automation) => automation.id !== selectedAutomation.id);
      setAutomations(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setDraftAutomation(null);
      setPageState(remaining.length === 0 ? "empty" : "loaded");
      setTriggerState("idle");
      setLastResult(null);
      setDeleteOpen(false);
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

  function renderAutomationRows(items: AutomationRecord[], sectionTitle: string) {
    if (items.length === 0) return null;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between px-2 pt-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{sectionTitle}</span>
          <span className="text-[11px] text-slate-400">{items.length}</span>
        </div>
        {items.map((automation) => {
          const readiness = getAutomationGraphReadiness(automation.graph);
          const isSelected = selectedId === automation.id;
          return (
            <button
              key={automation.id}
              onClick={() => {
                setDraftAutomation(null);
                setSelectedId(automation.id);
              }}
              className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                isSelected
                  ? "border-primary/40 bg-primary/10 shadow-sm"
                  : "border-transparent bg-white/80 hover:border-slate-200 hover:bg-white dark:bg-slate-950/40 dark:hover:border-slate-700 dark:hover:bg-slate-900"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="material-icons-round text-sm text-slate-400">account_tree</span>
                    <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{automation.name}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {getAutomationGraphSummary(automation.graph)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${getReadinessClasses(readiness.tone)}`}>
                  {readiness.label}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>{automation.is_enabled ? "Enabled" : "Paused"}</span>
                <span className="truncate">
                  {automation.last_execution ? `Last run ${automation.last_execution.status}` : formatAutomationRunTime(automation.last_triggered)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // --- Graph Edit Functions ---
  const addNode = useCallback((type: AutomationNodeType, position?: { x: number; y: number }) => {
    const id = `${type}_${Date.now()}`;
    const nextPosition = position
      ? {
          x: Math.max(32, Math.round(position.x - NODE_WIDTH / 2)),
          y: Math.max(32, Math.round(position.y - NODE_HEIGHT / 2)),
        }
      : {
          x: 500 + Math.random() * 50,
          y: 300 + Math.random() * 50,
        };
    const newNode: AutomationGraphNode = {
      id,
      type,
      kind: type === "trigger" ? "device_state" : type === "action" ? "set_output" : "state_equals",
      label: `New ${type}`,
      config: { ui: nextPosition }
    };
    setNodes((n) => [...n, newNode]);
    setSelectedNodeId(id);
    setConnectingFrom(null);
    setConnectionPreview(null);
    closeContextMenu();
  }, [closeContextMenu]);

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
          return {
            ...n,
            config: {
              ...n.config,
              ui: {
                x: dragInfo.initCanvasX + dx,
                y: dragInfo.initCanvasY + dy,
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

  const autoArrangeNodes = () => {
    const arrangedGraph = layoutGraphForCanvas({ nodes, edges });
    setNodes(arrangedGraph.nodes);
    setPendingCanvasFit(true);
    closeContextMenu();
  };

  const handleContextAddNode = (type: AutomationNodeType) => {
    if (!contextMenu) return;
    addNode(type, { x: contextMenu.canvasX, y: contextMenu.canvasY });
  };

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (creating || renameOpen || deleteOpen) return;

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
  }, [connectingFrom, contextMenu, creating, deleteOpen, removeSelectedNode, renameOpen, selectedNodeId]);

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

    return (
      <g key={eKey}>
        <path
          d={path}
          fill="none"
          stroke={activeHover ? "rgba(59,130,246,0.16)" : "rgba(71,85,105,0.18)"}
          strokeLinecap="round"
          strokeWidth="10"
        />
        <path 
          d={path}
          fill="none" 
          markerEnd={endPort ? (activeHover ? "url(#automation-edge-arrow-active)" : "url(#automation-edge-arrow)") : undefined}
          stroke={activeHover ? "#2563eb" : "#475569"} 
          strokeLinecap="round"
          strokeWidth={activeHover ? "5" : "4"} 
          className={activeHover ? "animate-pulse" : "pointer-events-auto transition-colors cursor-pointer hover:stroke-rose-500"}
          onClick={activeHover ? undefined : (e) => { e.stopPropagation(); deleteEdge(eKey); }}
        />
      </g>
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background-light font-sans text-slate-800 transition-colors duration-300 selection:bg-primary selection:text-white dark:bg-background-dark dark:text-slate-200">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="z-30 flex min-h-16 flex-wrap items-center justify-between gap-x-4 border-b border-slate-200 bg-surface-light px-6 py-4 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
              <span className="material-icons-round text-primary">account_tree</span>
              Automation Rules
            </h1>
            {activeAutomation && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Selected rule: <span className="font-semibold text-slate-700 dark:text-slate-200">{activeAutomation.name}</span>
                {isDraftSelection && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Draft</span>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
             {activeAutomation && (
               <>
                 <button
                   onClick={openRenameModal}
                   className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                 >
                   <span className="material-icons-round text-sm">edit</span> Rename
                 </button>
                 <button
                   onClick={openDeleteModal}
                   className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                 >
                   <span className="material-icons-round text-sm">delete</span> Delete
                 </button>
               </>
             )}
             <button
               onClick={() => setCreating(true)}
               className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 shadow"
             >
               <span className="material-icons-round text-sm">add</span> New
             </button>
          </div>
        </header>

        {pageState === "error" && <div className="p-8"><ErrorBanner message={fetchError} onRetry={() => void loadData()} /></div>}
        {pageState === "empty" && !creating && !draftAutomation && <EmptyState onCreate={() => setCreating(true)} />}

        {creating && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
               <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                   <h2 className="text-lg font-bold mb-4">Create Automation</h2>
                   <input 
                     autoFocus
                     name="new-automation-name"
                     value={newName} 
                     onChange={e => setNewName(e.target.value)} 
                     placeholder="Name (e.g., Turn on lights)" 
                     className="w-full rounded-xl border border-slate-300 bg-transparent px-4 py-2 text-sm focus:border-primary dark:border-slate-700 outline-none" 
                   />
                   <div className="mt-5 flex justify-end gap-2">
                       <button onClick={() => setCreating(false)} className="px-4 py-2 text-sm font-medium hover:bg-slate-100 rounded-lg dark:hover:bg-slate-800">Cancel</button>
                       <button onClick={handleCreateNew} disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg">Create</button>
                   </div>
               </div>
            </div>
        )}

        {renameOpen && activeAutomation && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
               <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                   <h2 className="text-lg font-bold mb-2">Rename Automation</h2>
                   <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                     Update the rule name shown in your automation list.
                   </p>
                   <input
                     autoFocus
                     name="rename-automation-name"
                     value={renameDraft}
                     onChange={(e) => {
                       setRenameDraft(e.target.value);
                       if (renameError) setRenameError("");
                     }}
                     onKeyDown={(e) => {
                       if (e.key === "Enter") {
                         void handleRenameAutomation();
                       }
                       if (e.key === "Escape") {
                         closeRenameModal();
                       }
                     }}
                     placeholder="Rule name"
                     className="w-full rounded-xl border border-slate-300 bg-transparent px-4 py-2 text-sm focus:border-primary dark:border-slate-700 outline-none"
                   />
                   {renameError && (
                     <p className="mt-2 text-sm text-rose-500 dark:text-rose-400">{renameError}</p>
                   )}
                   <div className="mt-5 flex justify-end gap-2">
                       <button onClick={closeRenameModal} disabled={renamePending} className="px-4 py-2 text-sm font-medium hover:bg-slate-100 rounded-lg disabled:opacity-50 dark:hover:bg-slate-800">Cancel</button>
                       <button onClick={() => void handleRenameAutomation()} disabled={renamePending} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-50">
                         {renamePending ? "Saving..." : "Save Name"}
                       </button>
                   </div>
               </div>
            </div>
        )}

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
            {/* Left Panel: List */}
            <aside className="w-full lg:w-[23rem] shrink-0 border-r border-slate-200 bg-surface-light dark:border-slate-700 dark:bg-surface-dark flex flex-col">
              <div className="border-b border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Rule Library</span>
                    <h2 className="mt-2 text-base font-semibold text-slate-900 dark:text-white">Automation inventory</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Filter and reopen saved rules without leaving the editor.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right shadow-sm dark:border-slate-700 dark:bg-slate-950">
                    <div className="text-lg font-semibold text-slate-900 dark:text-white">{automations.length}</div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{automations.filter((automation) => automation.is_enabled).length} enabled</div>
                  </div>
                </div>
                <label className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                  <span className="material-icons-round text-base text-slate-400">search</span>
                  <input
                    name="automation-search"
                    value={automationSearch}
                    onChange={(e) => setAutomationSearch(e.target.value)}
                    placeholder="Search by name, status, or step"
                    className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {([
                    ["all", "All"],
                    ["enabled", "Enabled"],
                    ["disabled", "Paused"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setAutomationFilter(value)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        automationFilter === value
                          ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                          : "bg-white text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {filteredAutomations.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    No rules match the current search or filter.
                  </div>
                ) : automationFilter === "all" ? (
                  <div className="space-y-5">
                    {renderAutomationRows(enabledAutomations, "Enabled")}
                    {renderAutomationRows(disabledAutomations, "Paused")}
                  </div>
                ) : (
                  renderAutomationRows(filteredAutomations, automationFilter === "enabled" ? "Enabled" : "Paused")
                )}
              </div>
            </aside>

            {/* Center Panel: Graph Canvas */}
            <section className="flex-1 relative flex flex-col bg-slate-50 dark:bg-[#0b1120] border-r border-slate-200 dark:border-slate-800 overflow-hidden" 
                     onMouseMove={onCanvasMouseMove} 
                     onMouseUp={onCanvasMouseUp}
                     onMouseLeave={onCanvasMouseUp}
            >
              <TransformWrapper
                ref={transformRef}
                initialScale={1}
                minScale={0.2}
                maxScale={2}
                panning={{ excluded: ["nodrag"] }}
                doubleClick={{ disabled: true }}
                onTransformed={(_, state) => setCanvasScale(state.scale)}
              >
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <>
                    <div className="z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
                      <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${getReadinessClasses(selectedReadiness.tone)}`}>
                              {selectedReadiness.label}
                            </span>
                            {graphDirty && (
                              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                Unsaved graph
                              </span>
                            )}
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-900 dark:text-slate-300">
                              {nodes.length} blocks
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-900 dark:text-slate-300">
                              {edges.length} links
                            </span>
                          </div>
                          <div>
                            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                              {activeAutomation ? activeAutomation.name : "Choose an automation"}
                            </h2>
                            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                              {activeAutomation
                                ? selectedSummary
                                : "Select a saved rule or create a new one to start wiring trigger, condition, and action blocks."}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => addNode("trigger")} className="bg-blue-50 border border-blue-100 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800/40 dark:text-blue-300 shadow-sm flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition">
                              <span className="material-icons-round text-[16px]">flash_on</span> Add Trigger
                            </button>
                            <button onClick={() => addNode("condition")} className="bg-amber-50 border border-amber-100 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800/40 dark:text-amber-300 shadow-sm flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition">
                              <span className="material-icons-round text-[16px]">help_outline</span> Add Condition
                            </button>
                            <button onClick={() => addNode("action")} className="bg-emerald-50 border border-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800/40 dark:text-emerald-300 shadow-sm flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition">
                              <span className="material-icons-round text-[16px]">play_arrow</span> Add Action
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col items-stretch gap-3 sm:items-end">
                          <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            <button onClick={() => zoomOut()} className="rounded-xl px-2.5 py-2 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800" title="Zoom out">
                              <span className="material-icons-round text-base">remove</span>
                            </button>
                            <span className="min-w-16 text-center text-xs font-semibold text-slate-500 dark:text-slate-300">
                              {Math.round(canvasScale * 100)}%
                            </span>
                            <button onClick={() => zoomIn()} className="rounded-xl px-2.5 py-2 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800" title="Zoom in">
                              <span className="material-icons-round text-base">add</span>
                            </button>
                            <button onClick={autoArrangeNodes} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800">
                              Arrange
                            </button>
                            <button onClick={() => fitGraphToCanvas()} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800">
                              Fit
                            </button>
                            <button onClick={() => resetTransform(200)} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800">
                              Reset
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button onClick={handleTrigger} disabled={!selectedAutomation || triggerState === "pending"} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition disabled:opacity-50">
                              {triggerState === "pending" ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" /> : <span className="material-icons-round text-base">play_circle</span>}
                              Run Now
                            </button>
                            <button onClick={handleSaveGraph} disabled={!activeAutomation || saving} className="bg-primary hover:bg-blue-600 text-white shadow-md flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold transition disabled:opacity-50">
                              <span className="material-icons-round text-base">save</span> {isDraftSelection ? "Create Rule" : "Save Graph"}
                            </button>
                          </div>
                        </div>
                      </div>

                    </div>

                    <div
                      ref={canvasViewportRef}
                      className="flex-1 relative overflow-hidden"
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
                         <svg className="absolute inset-0 w-full h-full z-0">
                            <defs>
                              <marker id="automation-edge-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
                              </marker>
                              <marker id="automation-edge-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
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
                            const borderClasses = 
                              node.type === "trigger" ? "border-blue-200 dark:border-blue-500/30" : 
                              node.type === "condition" ? "border-amber-200 dark:border-amber-500/30" : 
                              "border-emerald-200 dark:border-emerald-500/30";
                              
                            const headerClasses = 
                              node.type === "trigger" ? "bg-blue-50 dark:bg-blue-900/30 border-b border-blue-100 dark:border-blue-500/20 text-blue-700 dark:text-blue-400" : 
                              node.type === "condition" ? "bg-amber-50 dark:bg-amber-900/30 border-b border-amber-100 dark:border-amber-500/20 text-amber-700 dark:text-amber-400" : 
                              "bg-emerald-50 dark:bg-emerald-900/30 border-b border-emerald-100 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400";
                            
                            const iconStr =
                              node.type === "trigger" ? "flash_on" :
                              node.type === "condition" ? "help_outline" : "play_arrow";

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
                                        {node.type}
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
                                    const py = port.type === "in" ? -6 : NODE_HEIGHT - 6;
                                    const isPortSelected = connectingFrom?.nodeId === node.id && connectingFrom.portId === port.id;
                                    return (
                                       <div key={port.id} title={port.label}
                                            data-automation-port="true"
                                            className={`nodrag absolute w-3.5 h-3.5 rounded-full cursor-crosshair hover:scale-150 transition-transform shadow-sm
                                                bg-white border-2 border-slate-400 dark:bg-slate-900 dark:border-slate-500
                                                ${port.type === "in" ? 'hover:border-blue-500' : 'hover:border-amber-500'}
                                                ${isPortSelected ? 'scale-150 border-primary ring-4 ring-primary/20' : ''}`}
                                            style={{ left: px - 6, top: py }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onClick={(e) => onPortClick(e, node.id, port.id, port.type)}
                                       />
                                    );
                                 })}
                              </div>
                            );
                         })}

                      </TransformComponent>

                      <div className="absolute bottom-4 right-4 z-10 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-medium text-slate-500 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-950/85 dark:text-slate-300">
                        Pan on empty space • Zoom with controls • Fit keeps the whole graph centered
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
                            onClick={() => handleContextAddNode("action")}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                          >
                            <span className="material-icons-round text-base text-emerald-500">play_arrow</span>
                            Add action here
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </TransformWrapper>
            </section>

            {/* Right Panel: Inspector */}
            <aside className="w-full lg:w-80 shrink-0 border-l border-slate-200 bg-surface-light dark:border-slate-700 dark:bg-surface-dark overflow-y-auto">
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
                        <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{isDraftSelection ? "Not saved yet" : formatAutomationRunTime(activeAutomation.last_triggered)}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Runtime</div>
                        <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{isDraftSelection ? "Draft only" : activeAutomation.is_enabled ? "Enabled" : "Paused"}</div>
                      </div>
                    </div>
                  )}
               </div>
               
               {linearRule ? (() => {
                   const { trigger, condition, action } = linearRule;
                   
                   const updateConfigMany = (updates: {id: string, config: Partial<AutomationGraphNodeConfig>}[]) => {
                       setNodes(prev => prev.map(n => {
                           const up = updates.find(u => u.id === n.id);
                           return up ? { ...n, config: { ...n.config, ...up.config } } : n;
                       }));
                   };
                   
                   const handleSetSourceDevice = (devId: string) => {
                       updateConfigMany([
                           { id: trigger.id, config: { device_id: devId, pin: undefined } },
                           { id: condition.id, config: { device_id: devId, pin: undefined } }
                       ]);
                   };
                   
                   const handleSetSourcePin = (pinValue: number, mode: string, func: string) => {
                       const isNum = isNumericPin({ mode, function: func });
                       const defaultKind = isNum ? "numeric_compare" : "state_equals";
                       setNodes(prev => prev.map(n => {
                           if (n.id === trigger.id) return { ...n, config: { ...n.config, pin: pinValue } };
                           if (n.id === condition.id) return { 
                               ...n, 
                               kind: defaultKind, 
                               config: { 
                                   ...n.config, 
                                   pin: pinValue, 
                                   operator: isNum ? 'gt' : undefined, 
                                   value: isNum ? 0 : undefined,
                                   expected: isNum ? undefined : 'on' 
                               } 
                           };
                           return n;
                       }));
                   };

                   const handleSetTargetDevice = (devId: string) => {
                       updateConfigMany([ { id: action.id, config: { device_id: devId, pin: undefined } } ]);
                   };
                   
                   const handleSetTargetPin = (pinValue: number, mode: string) => {
                       const defaultKind = mode === "PWM" ? "set_value" : "set_output";
                       setNodes(prev => prev.map(n => {
                           if (n.id === action.id) return { 
                               ...n, 
                               kind: defaultKind, 
                               config: { 
                                   ...n.config, 
                                   pin: pinValue, 
                                   value: defaultKind === "set_output" ? 1 : 0 
                               } 
                           };
                           return n;
                       }));
                   };

                   const sourceDev = devices.find(d => d.device_id === trigger.config.device_id);
                   const sourcePinObj = sourceDev?.pin_configurations.find(p => p.gpio_pin === trigger.config.pin);
                   const isNumericSource = isNumericPin(sourcePinObj);
                   const isSwitchSource = isSwitchPin(sourcePinObj);

                   const targetDev = devices.find(d => d.device_id === action.config.device_id);

                   return (
                       <div className="p-4 space-y-6">
                           <div className="space-y-3">
                               <div className="flex bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg border border-blue-100 dark:border-blue-800/50 w-fit">
                                   <span className="text-xs font-bold text-blue-700 dark:text-blue-400">1. WHEN</span>
                               </div>
                               
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
                                               onClick={() => handleSetSourcePin(pin.gpio_pin, pin.mode, pin.function || "")}
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
                           </div>

                           {trigger.config.pin !== undefined && (
                               <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                                   <div className="flex bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-lg border border-amber-100 dark:border-amber-800/50 w-fit mb-2">
                                       <span className="text-xs font-bold text-amber-700 dark:text-amber-400">2. AND ONLY IF</span>
                                   </div>
                                   
                                   {isNumericSource ? (
                                       <div className="space-y-3">
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
                                               <input name="rule-condition-value" type="number" value={String(condition.config.value ?? "")} onChange={(e) => updateConfigMany([{id: condition.id, config: {value: parseFloat(e.target.value)}}])} placeholder="Value" className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono shadow-sm" />
                                               {condition.config.operator === "between" && (
                                                   <>
                                                       <span className="text-sm font-semibold text-slate-400">and</span>
                                                       <input name="rule-condition-secondary-value" type="number" value={String(condition.config.secondary_value ?? "")} onChange={(e) => updateConfigMany([{id: condition.id, config: {secondary_value: parseFloat(e.target.value)}}])} placeholder="Max" className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono shadow-sm" />
                                                   </>
                                               )}
                                           </div>
                                       </div>
                                   ) : isSwitchSource ? (
                                       <div className="flex gap-2">
                                           <button onClick={() => updateConfigMany([{id: condition.id, config: {expected: 'on'}}])} className={`flex-1 py-2 rounded-lg font-bold text-[11px] border transition shadow-sm ${condition.config.expected === "on" ? 'bg-emerald-500 border-emerald-600 text-white dark:bg-emerald-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>Is ON</button>
                                           <button onClick={() => updateConfigMany([{id: condition.id, config: {expected: 'off'}}])} className={`flex-1 py-2 rounded-lg font-bold text-[11px] border transition shadow-sm ${condition.config.expected === "off" ? 'bg-slate-800 border-slate-900 text-white dark:bg-slate-700 dark:border-slate-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'}`}>Is OFF</button>
                                       </div>
                                   ) : (
                                       <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800/50">
                                            <p className="text-xs text-slate-500">Pick a valid trigger source to define conditions.</p>
                                       </div>
                                   )}
                               </div>
                           )}

                           {(isNumericSource ? condition.config.value !== undefined : trigger.config.pin !== undefined) && (
                               <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                                   <div className="flex bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-lg border border-emerald-100 dark:border-emerald-800/50 w-fit mb-2">
                                       <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">3. THEN DO</span>
                                   </div>
                                   
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
                                                   <input name="rule-target-pwm-range" type="range" min="0" max="255" value={String(action.config.value ?? 0)} onChange={(e) => updateConfigMany([{id: action.id, config: {value: parseFloat(e.target.value)}}])} className="flex-1 accent-primary" />
                                                   <input name="rule-target-pwm-value" type="number" min="0" max="255" value={String(action.config.value ?? 0)} onChange={(e) => updateConfigMany([{id: action.id, config: {value: parseFloat(e.target.value)}}])} className="w-16 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1 outline-none font-mono text-center" />
                                               </div>
                                           </div>
                                       )}
                                     </div>
                                   )}
                               </div>
                           )}

                           {action.config.pin !== undefined && (
                               <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                                   <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 shadow-inner">
                                       <span className="text-[10px] font-bold uppercase tracking-widest text-primary mb-2 block">Rule Summary</span>
                                       <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed">
                                           <span className="text-blue-600 dark:text-blue-400 font-bold">When</span> {sourcePinObj?.label || `GPIO ${trigger.config.pin}`} on {sourceDev?.name}
                                           {' '}
                                           <span className="text-amber-600 dark:text-amber-500 font-bold">
                                             {condition.kind === 'state_equals' ? (condition.config.expected === 'on' ? 'is ON' : 'is OFF') : 
                                              condition.kind === 'numeric_compare' ? `is ${condition.config.operator === 'between' ? 'between ' + condition.config.value + ' AND ' + condition.config.secondary_value : (condition.config.operator === 'gt' ? '>' : condition.config.operator === 'lt' ? '<' : condition.config.operator === 'gte' ? '>=' : '<=') + ' ' + condition.config.value}` : 'changes'}
                                           </span>
                                           , <br/><span className="text-emerald-600 dark:text-emerald-500 font-bold">Then</span> set {targetDev?.pin_configurations.find(p=>p.gpio_pin === action.config.pin)?.label || `GPIO ${action.config.pin}`} on {targetDev?.name} to <span className="font-bold">{action.kind === 'set_output' ? (action.config.value ? 'ON' : 'OFF') : action.config.value}</span>.
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
                       setNodes(prev => prev.map(n => n.id === node.id ? { ...n, kind, config: { ui: n.config.ui, device_id: n.config.device_id, pin: n.config.pin } } : n));
                   };
                   
                   const handleSetDevice = (device_id: string) => {
                       setNodes(prev => prev.map(n => n.id === node.id ? { ...n, config: { ui: n.config.ui, device_id } } : n));
                   };
                   
                   const handleSetPin = (pin: number) => {
                       setNodes(prev => prev.map(n => {
                           if (n.id === node.id) {
                               const newConfig = { ...n.config, pin };
                               delete newConfig.operator;
                               delete newConfig.value;
                               delete newConfig.secondary_value;
                               delete newConfig.expected;
                               if (node.kind === 'state_equals') newConfig.expected = 'on';
                               if (node.kind === 'numeric_compare') { newConfig.operator = 'gt'; newConfig.value = 0; }
                               if (node.kind === 'set_output') newConfig.value = 1;
                               if (node.kind === 'set_value') newConfig.value = 0;
                               return { ...n, config: newConfig };
                           }
                           return n;
                       }));
                   };

                   const selectedDevice = devices.find(d => d.device_id === node.config.device_id);
                   const compatiblePins = selectedDevice?.pin_configurations.filter(p => {
                       if (node.type === "action" && node.kind === "set_output") return p.mode === "OUTPUT";
                       if (node.type === "action" && node.kind === "set_value") return p.mode === "PWM";
                       return true;
                   }) || [];

                   return (
                     <div className="p-4 space-y-6">
                         {/* 1. General Setup */}
                         <div className="space-y-4">
                             <div>
                                 <span className="text-xs font-bold text-slate-500 block mb-2">Purpose</span>
                                 <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                                     {node.type === "trigger" && <button className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-200">Device State</button>}
                                     {node.type === "condition" && [
                                         { k: "state_equals", l: "State Equals" },
                                         { k: "numeric_compare", l: "Numeric Compare" }
                                     ].map(opt => (
                                         <button key={opt.k} onClick={() => handleKindChange(opt.k)} className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition ${node.kind === opt.k ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-200' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                                            {opt.l}
                                         </button>
                                     ))}
                                     {node.type === "action" && [
                                         { k: "set_output", l: "Turn On/Off" },
                                         { k: "set_value", l: "Set Value" }
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
                         <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                             <span className="text-xs font-bold text-slate-500 block">Target Device</span>
                             <select name="node-target-device" value={node.config.device_id || ""} onChange={(e) => handleSetDevice(e.target.value)} className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer">
                                <option value="">Select a device...</option>
                                {devices.map(d => <option key={d.device_id} value={d.device_id}>{d.name} {d.conn_status === "online" ? "🟢" : "⚪"}</option>)}
                             </select>
                         </div>

                         {/* 3. Pin Selection */}
                         {node.config.device_id && (
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
                                                onClick={() => handleSetPin(pin.gpio_pin)}
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

                         {/* 4. Logic/Action Configuration */}
                         {node.config.pin !== undefined && (
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
                             {node.config.pin !== undefined && (
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
                      <span className={`text-xs font-bold px-2 py-1 rounded inline-block mb-3 ${lastResult.status === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400'}`}>
                          {lastResult.status}
                      </span>
                      {lastResult.log?.error_message && (
                          <div className="text-xs font-mono text-rose-500 whitespace-pre-wrap">{lastResult.log.error_message}</div>
                      )}
                      {lastResult.log?.log_output && (
                          <div className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{lastResult.log.log_output}</div>
                      )}
                      {!lastResult.log && <div className="text-xs italic text-slate-500">{lastResult.message}</div>}
                   </div>
               )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
