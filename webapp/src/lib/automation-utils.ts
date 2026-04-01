import { 
  AutomationGraph, 
  AutomationGraphEdge, 
  AutomationGraphNode, 
  AutomationNodeType, 
  AutomationGraphNodeConfig, 
  AutomationRecord, 
  AutomationMutationPayload, 
  GraphAutomationPayload,
  TIME_TRIGGER_KIND,
  TIME_TRIGGER_WEEKDAY_OPTIONS,
  DEVICE_VALUE_TRIGGER_KIND,
  DEVICE_ON_OFF_TRIGGER_KIND,
  LEGACY_DEVICE_TRIGGER_KIND
} from "@/types/automation";

export interface PortDefinition {
  id: string;
  label: string;
  type: "in" | "out";
  offset: { x: number; y: number };
}

interface PortSelection {
  nodeId: string;
  portId: string;
  type: "in" | "out";
}

export const NODE_WIDTH = 260;
export const NODE_HEIGHT = 100;
export const CANVAS_BASE_X = 260;
export const CANVAS_BASE_Y = 320;
export const CANVAS_HORIZONTAL_GAP = 400;
export const CANVAS_VERTICAL_GAP = 220;
export const CANVAS_FIT_PADDING = 120;
export const MIN_CANVAS_SCALE = 0.2;
export const MAX_CANVAS_SCALE = 1;
export const NODE_TYPE_ORDER: Record<AutomationNodeType, number> = {
  trigger: 0,
  condition: 1,
  action: 2,
};

export function getEmptyGraph(): AutomationGraph {
  return { nodes: [], edges: [] };
}

export function cloneGraph(graph?: AutomationGraph): AutomationGraph {
  if (!graph) return getEmptyGraph();
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      config: { ...node.config, ui: node.config.ui ? { ...node.config.ui } : undefined },
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

export function stripGraphUi(graph: AutomationGraph): AutomationGraph {
  return {
    nodes: graph.nodes.map((node) => {
      const restConfig = { ...node.config };
      delete restConfig.ui;
      return { ...node, config: restConfig };
    }),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

export function getEdgeKey(edge: AutomationGraphEdge): string {
  return `${edge.source_node_id}-${edge.source_port}-${edge.target_node_id}-${edge.target_port}`;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

export function isAutomationPortTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("[data-automation-port='true']"));
}

export function buildConnectionEdge(first: PortSelection, second: PortSelection): AutomationGraphEdge | null {
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

export function graphNeedsReadableLayout(graph?: AutomationGraph): boolean {
  if (!graph || graph.nodes.length === 0) return false;
  const positions = new Set<string>();

  for (const node of graph.nodes) {
    const ui = node.config.ui;
    if (!ui || typeof ui.x !== "number" || typeof ui.y !== "number") return true;
    positions.add(`${Math.round(ui.x)}:${Math.round(ui.y)}`);
  }

  return positions.size !== graph.nodes.length;
}

export function layoutGraphForCanvas(graph?: AutomationGraph): AutomationGraph {
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

    const groupStartX = CANVAS_BASE_X - ((group.length - 1) * CANVAS_HORIZONTAL_GAP) / 2;
    group.forEach((node, index) => {
      node.config = {
        ...node.config,
        ui: {
          x: groupStartX + index * CANVAS_HORIZONTAL_GAP,
          y: CANVAS_BASE_Y + level * CANVAS_VERTICAL_GAP,
        },
      };
    });
  }

  return cloned;
}

export function getGraphBounds(nodes: AutomationGraphNode[]) {
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

export function buildStarterGraph(seed = Date.now()): AutomationGraph {
  const triggerId = `trigger_${seed}`;
  const conditionId = `condition_${seed}`;
  const actionId = `action_${seed}`;

  return {
    nodes: [
      { id: triggerId, type: "trigger", kind: "device_state", label: "When...", config: { ui: { x: CANVAS_BASE_X, y: 150 } } },
      { id: conditionId, type: "condition", kind: "state_equals", label: "Check...", config: { ui: { x: CANVAS_BASE_X, y: 150 + CANVAS_VERTICAL_GAP } } },
      { id: actionId, type: "action", kind: "set_output", label: "Then...", config: { ui: { x: CANVAS_BASE_X, y: 150 + CANVAS_VERTICAL_GAP * 2 } } },
    ],
    edges: [
      { source_node_id: triggerId, source_port: "event_out", target_node_id: conditionId, target_port: "event_in" },
      { source_node_id: conditionId, source_port: "pass_out", target_node_id: actionId, target_port: "event_in" },
    ],
  };
}

export function getNodeDisplayName(node: Pick<AutomationGraphNode, "label" | "kind"> | null | undefined): string {
  if (!node) return "Unconfigured step";
  const base = (node.label || node.kind || "step").trim();
  return base.replaceAll("_", " ");
}

export function formatAutomationRunTime(value: string | null | undefined): string {
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

export function getAutomationGraphSummary(graph?: AutomationGraph): string {
  if (!graph) return "Waiting for graph data.";
  if (graph.nodes.length === 0) return "No blocks yet.";
  const linear = getLinearRule(graph.nodes, graph.edges);
  if (linear) {
    return `${getNodeDisplayName(linear.trigger)} -> ${getNodeDisplayName(linear.condition)} -> ${getNodeDisplayName(linear.action)}`;
  }
  return `${graph.nodes.length} blocks and ${graph.edges.length} links in this workflow.`;
}

export function getAutomationGraphReadiness(graph?: AutomationGraph): { label: string; tone: string } {
  if (!graph) return { label: "Legacy", tone: "slate" };
  if (graph.nodes.length === 0) return { label: "Empty", tone: "amber" };
  const linear = getLinearRule(graph.nodes, graph.edges);
  if (!linear) return { label: "Custom", tone: "blue" };

  const triggerReady =
    linear.trigger.kind === TIME_TRIGGER_KIND
      ? Number.isInteger(getTimeTriggerHour(linear.trigger.config)) && Number.isInteger(getTimeTriggerMinute(linear.trigger.config))
      : Boolean(linear.trigger.config.device_id) && linear.trigger.config.pin !== undefined;
  const actionReady = Boolean(linear.action.config.device_id) && linear.action.config.pin !== undefined;
  const conditionReady =
    linear.condition.kind === "numeric_compare"
      ? Boolean(linear.condition.config.device_id) &&
        linear.condition.config.pin !== undefined &&
        linear.condition.config.value !== undefined &&
        (linear.condition.config.operator !== "between" || linear.condition.config.secondary_value !== undefined)
      : Boolean(linear.condition.config.device_id) &&
        linear.condition.config.pin !== undefined &&
        linear.condition.config.expected !== undefined;

  if (triggerReady && actionReady && conditionReady) return { label: "Ready", tone: "emerald" };
  return { label: "Draft", tone: "amber" };
}

export function getReadinessClasses(tone: string): string {
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

export function isLegacyAutomation(automation: AutomationRecord): automation is AutomationRecord & { script_code: string } {
  return typeof automation.script_code === "string";
}

export function buildGraphAutomationPayload(automation: AutomationRecord, graph: AutomationGraph): GraphAutomationPayload {
  return {
    name: automation.name,
    is_enabled: automation.is_enabled,
    graph,
  };
}

export function buildRenamePayload(automation: AutomationRecord, nextName: string, graph: AutomationGraph): AutomationMutationPayload {
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

export function getTimeTriggerHour(config: AutomationGraphNodeConfig): number {
  return typeof config.hour === "number" && Number.isFinite(config.hour) ? Math.min(23, Math.max(0, Math.trunc(config.hour))) : 0;
}

export function getTimeTriggerMinute(config: AutomationGraphNodeConfig): number {
  return typeof config.minute === "number" && Number.isFinite(config.minute) ? Math.min(59, Math.max(0, Math.trunc(config.minute))) : 0;
}

export function getTimeTriggerWeekdays(config: AutomationGraphNodeConfig): string[] {
  if (!Array.isArray(config.weekdays)) return [];
  return config.weekdays.filter((weekday): weekday is string => typeof weekday === "string");
}

export function buildTimeTriggerConfig(config: AutomationGraphNodeConfig): AutomationGraphNodeConfig {
  return {
    ...config,
    device_id: undefined,
    pin: undefined,
    hour: getTimeTriggerHour(config),
    minute: getTimeTriggerMinute(config),
    weekdays: getTimeTriggerWeekdays(config),
  };
}

export function formatTimeNumber(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatTimeTriggerValue(config: AutomationGraphNodeConfig): string {
  return `${formatTimeNumber(getTimeTriggerHour(config))}:${formatTimeNumber(getTimeTriggerMinute(config))}`;
}

export function formatTimeTriggerSummary(config: AutomationGraphNodeConfig): string {
  const weekdays = getTimeTriggerWeekdays(config);
  const dayLabel = weekdays.length === 0
    ? "every day"
    : weekdays
        .map((weekday) => TIME_TRIGGER_WEEKDAY_OPTIONS.find((option) => option.value === weekday)?.label ?? weekday)
        .join(", ");
  return `${formatTimeTriggerValue(config)} ${dayLabel}`;
}

export function formatServerTimePreview(value?: string | null): string {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getTriggerKindLabel(kind: string): string {
  switch (kind) {
    case TIME_TRIGGER_KIND:
      return "Time";
    case DEVICE_VALUE_TRIGGER_KIND:
      return "Device Value";
    case DEVICE_ON_OFF_TRIGGER_KIND:
      return "On/Off Event";
    default:
      return "Any Device Update";
  }
}

export function getPreferredTriggerKindForPin(pin: { mode?: string; function?: string | null } | undefined | null): string {
  if (isNumericPin(pin)) return DEVICE_VALUE_TRIGGER_KIND;
  if (isSwitchPin(pin)) return DEVICE_ON_OFF_TRIGGER_KIND;
  return LEGACY_DEVICE_TRIGGER_KIND;
}

export function buildConditionStateForTriggerKind(
  triggerKind: string,
  currentKind: string,
  currentConfig: AutomationGraphNodeConfig,
  pin: number | undefined,
): Pick<AutomationGraphNode, "kind" | "config"> {
  if (triggerKind === DEVICE_VALUE_TRIGGER_KIND) {
    return {
      kind: "numeric_compare",
      config: {
        ...currentConfig,
        pin,
        operator: currentKind === "numeric_compare" && typeof currentConfig.operator === "string" ? currentConfig.operator : "gt",
        value:
          currentKind === "numeric_compare" && typeof currentConfig.value === "number"
            ? currentConfig.value
            : 0,
        secondary_value:
          currentKind === "numeric_compare" && typeof currentConfig.secondary_value === "number"
            ? currentConfig.secondary_value
            : undefined,
        expected: undefined,
      },
    };
  }

  if (triggerKind === DEVICE_ON_OFF_TRIGGER_KIND) {
    return {
      kind: "state_equals",
      config: {
        ...currentConfig,
        pin,
        expected:
          currentKind === "state_equals" && typeof currentConfig.expected === "string"
            ? currentConfig.expected
            : "on",
        operator: undefined,
        secondary_value: undefined,
        value: undefined,
      },
    };
  }

  if (triggerKind === TIME_TRIGGER_KIND) {
    return {
      kind: currentKind,
      config: {
        ...currentConfig,
      },
    };
  }

  return {
    kind: currentKind,
    config: {
      ...currentConfig,
      pin,
    },
  };
}

export function getNodePorts(type: AutomationNodeType): PortDefinition[] {
  switch (type) {
    case "trigger":
      return [{ id: "event_out", label: "Triggered", type: "out", offset: { x: NODE_WIDTH / 2, y: NODE_HEIGHT } }];
    case "condition":
      return [
        { id: "event_in", label: "In", type: "in", offset: { x: NODE_WIDTH / 2, y: 0 } },
        { id: "pass_out", label: "True", type: "out", offset: { x: NODE_WIDTH / 2, y: NODE_HEIGHT } }
      ];
    case "action":
      return [{ id: "event_in", label: "Execute", type: "in", offset: { x: NODE_WIDTH / 2, y: 0 } }];
  }
}
