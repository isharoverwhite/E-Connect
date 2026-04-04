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
  bot_api_key?: string;
  chat_id?: string;
  message?: string;
  severity?: string;
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

export const LEGACY_DEVICE_TRIGGER_KIND = "device_state";
export const DEVICE_VALUE_TRIGGER_KIND = "device_value";
export const DEVICE_ON_OFF_TRIGGER_KIND = "device_on_off_event";
export const TIME_TRIGGER_KIND = "time_schedule";
export const TELEGRAM_ACTION_KIND = "send_telegram_notification";
export const TIME_TRIGGER_WEEKDAY_OPTIONS = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
] as const;

export type AutomationScheduleContext = {
  effective_timezone: string;
  timezone_source: "setting" | "runtime";
  current_server_time: string;
};

export interface ExecutionLog {
  id: number;
  automation_id: number;
  triggered_at: string;
  status: ExecutionStatus;
  trigger_source?: "manual" | "device_state" | "schedule";
  scheduled_for?: string | null;
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

export interface DraftAutomation {
  name: string;
  is_enabled: boolean;
  graph: AutomationGraph;
  last_triggered: string | null;
  last_execution: ExecutionLog | null;
}

export type GraphAutomationPayload = {
  name: string;
  is_enabled: boolean;
  graph: AutomationGraph;
};

export type LegacyAutomationPayload = {
  name: string;
  is_enabled: boolean;
  script_code: string;
  schedule_type?: string;
  timezone?: string | null;
  schedule_hour?: number | null;
  schedule_minute?: number | null;
  schedule_weekdays?: string[];
};

export type AutomationMutationPayload = GraphAutomationPayload | LegacyAutomationPayload;

export type AutomationListFilter = "all" | "enabled" | "disabled";
