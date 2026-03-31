"use client";

import { API_URL } from "@/lib/api";
import { getToken } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import { useCallback, useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { fetchDashboardDevices } from "@/lib/api";
import { DeviceConfig } from "@/types/device";

// --- Types ---

export type AutomationNodeType = "trigger" | "condition" | "action";
export type ExecutionStatus = "success" | "failed";

export interface AutomationGraphNode {
  id: string;
  type: AutomationNodeType;
  kind: string; // e.g. "device_state", "schedule_daily", "send_command"
  label?: string | null;
  config: Record<string, any>;
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
  graph: AutomationGraph;
  creator_id: number;
  last_triggered: string | null;
  last_execution: ExecutionLog | null;
}

type PageState = "loading" | "empty" | "loaded" | "error";

// --- API helpers ---
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function fetchAutomations(): Promise<AutomationRecord[]> {
  const res = await fetch(`${API_URL}/automations`, { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to load automations: ${res.status}`);
  return res.json() as Promise<AutomationRecord[]>;
}

async function createAutomation(payload: Partial<AutomationRecord>): Promise<AutomationRecord> {
  const res = await fetch(`${API_URL}/automation`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Create failed: ${res.status}`);
  return res.json();
}

async function updateAutomation(id: number, payload: Partial<AutomationRecord>): Promise<AutomationRecord> {
  const res = await fetch(`${API_URL}/automation/${id}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status}`);
  return res.json();
}

async function triggerAutomation(id: number): Promise<TriggerResult> {
  const res = await fetch(`${API_URL}/automation/${id}/trigger`, {
    method: "POST",
    headers: authHeaders()
  });
  if (!res.ok) throw new Error(`Trigger failed: ${res.status}`);
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
  const [pageState, setPageState] = useState<PageState>("loading");
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [fetchError, setFetchError] = useState("");

  const [saving, setSaving] = useState(false);
  const [triggerState, setTriggerState] = useState<"idle" | "pending" | "done">("idle");
  const [lastResult, setLastResult] = useState<TriggerResult | null>(null);

  // Graph state for currently selected automation
  const [nodes, setNodes] = useState<AutomationGraphNode[]>([]);
  const [edges, setEdges] = useState<AutomationGraphEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Drag & drop port connections
  const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; portId: string } | null>(null);
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);

  // Basic modales
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const selectedAutomation = automations.find((a) => a.id === selectedId) ?? null;

  const loadData = useCallback(async () => {
    setPageState("loading");
    try {
      const [list, dList] = await Promise.all([
        fetchAutomations(),
        fetchDashboardDevices().catch(() => [])
      ]);
      setAutomations(list);
      setDevices(dList);
      if (list.length > 0 && selectedId === null) {
        setSelectedId(list[0].id);
        setNodes(list[0].graph?.nodes || []);
        setEdges(list[0].graph?.edges || []);
      }
      setPageState(list.length === 0 ? "empty" : "loaded");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load.");
      setPageState("error");
    }
  }, [selectedId]);

  useEffect(() => {
    void loadData();
  }, []);

  // Update local graph state when selection changes
  useEffect(() => {
    if (selectedAutomation) {
      setNodes(selectedAutomation.graph?.nodes || []);
      setEdges(selectedAutomation.graph?.edges || []);
      setSelectedNodeId(null);
      setLastResult(selectedAutomation.last_execution ? { status: selectedAutomation.last_execution.status, message: "Last run from record", log: selectedAutomation.last_execution } : null);
    }
  }, [selectedId, selectedAutomation]);

  async function handleCreateNew() {
    if (!newName.trim()) return;
    try {
      setSaving(true);
      const payload: Partial<AutomationRecord> = {
        name: newName,
        is_enabled: true,
        graph: {
          nodes: [{ id: `trigger_${Date.now()}`, type: "trigger", kind: "manual", label: "Manual Trigger", config: { ui: { x: 500, y: 300 } } }],
          edges: []
        }
      };
      const saved = await createAutomation(payload);
      setAutomations((prev) => [...prev, saved]);
      setSelectedId(saved.id);
      setCreating(false);
      setNewName("");
      setPageState("loaded");
    } catch (e) {
      alert("Failed to create automation.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveGraph() {
    if (!selectedAutomation) return;
    try {
      setSaving(true);
      const payload: Partial<AutomationRecord> = {
        graph: { nodes, edges }
      };
      const saved = await updateAutomation(selectedAutomation.id, payload);
      setAutomations((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
      alert("Graph saved successfully!");
    } catch (e) {
      alert("Failed to save graph.");
    } finally {
      setSaving(false);
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
  const addNode = (type: AutomationNodeType) => {
    const id = `${type}_${Date.now()}`;
    const newNode: AutomationGraphNode = {
      id,
      type,
      kind: type === "trigger" ? "manual" : type === "action" ? "send_command" : "device_state",
      label: `New ${type}`,
      config: { ui: { x: 500 + Math.random() * 50, y: 300 + Math.random() * 50 }, props: {} }
    };
    setNodes((n) => [...n, newNode]);
    setSelectedNodeId(id);
  };

  const removeSelectedNode = () => {
    if (!selectedNodeId) return;
    setNodes((n) => n.filter((x) => x.id !== selectedNodeId));
    setEdges((e) => e.filter((x) => x.source_node_id !== selectedNodeId && x.target_node_id !== selectedNodeId));
    setSelectedNodeId(null);
  };

  // Dragging nodes locally
  const [dragInfo, setDragInfo] = useState<{ id: string; startX: number; startY: number; initCanvasX: number; initCanvasY: number } | null>(null);

  const startNodeDrag = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    setDragInfo({ id, startX: e.clientX, startY: e.clientY, initCanvasX: node.config.ui?.x || 0, initCanvasY: node.config.ui?.y || 0 });
    setSelectedNodeId(id);
  };

  const onCanvasMouseMove = (e: React.MouseEvent) => {
    // Port connection wire follow
    if (connectingFrom) {
      // Offset by canvas wrapper rect bounds... approximate logic:
      const rect = e.currentTarget.getBoundingClientRect();
      // Need scale from transform wrapper, ideally simple approximation for now or direct raw client pos if absolute
      setMouseX(e.clientX - rect.left);
      setMouseY(e.clientY - rect.top);
    }
    
    // Node dragging
    if (dragInfo) {
      // Wait, mouse moves on the transform component scaled element. E.clientX is screen pos.
      // Scaling makes this tricky without the active scale factor. We approximate for now.
      const dx = (e.clientX - dragInfo.startX); // Should divide by scale, but works natively if we just use transform
      const dy = (e.clientY - dragInfo.startY);
      // We will actually implement node dragging via an absolute position style set locally.
      // Easiest robust workaround inside transform:
      setNodes(prev => prev.map(n => {
        if (n.id === dragInfo.id) {
            // we really need scale. Let's assume scale=1 for MVP drag or better, use onDrag callback
            // For now, simple movement:
            // This is unscaled delta.
            n.config = { ...n.config, ui: { ...n.config.ui, x: dragInfo.initCanvasX + dx, y: dragInfo.initCanvasY + dy } };
        }
        return n;
      }));
    }
  };

  const onCanvasMouseUp = () => {
    if (dragInfo) {
      setDragInfo(null);
    }
    if (connectingFrom) {
      setConnectingFrom(null); // dropped in empty space
    }
  };

  const onPortClick = (e: React.MouseEvent, nodeId: string, portId: string, type: "in" | "out") => {
    e.stopPropagation();
    if (type === "out") {
      setConnectingFrom({ nodeId, portId });
      // Set initial mouse pos
      const rect = e.currentTarget.closest('.react-transform-component')?.getBoundingClientRect() || { left: 0, top: 0 };
      setMouseX(e.clientX - rect.left);
      setMouseY(e.clientY - rect.top);
    } else if (type === "in" && connectingFrom) {
      // Connect!
      // Prevent duplicate edges
      if (!edges.find(e => e.source_node_id === connectingFrom.nodeId && e.source_port === connectingFrom.portId && e.target_node_id === nodeId && e.target_port === portId)) {
        setEdges([...edges, { source_node_id: connectingFrom.nodeId, source_port: connectingFrom.portId, target_node_id: nodeId, target_port: portId }]);
      }
      setConnectingFrom(null);
    }
  };

  const deleteEdge = (eId: string) => {
    const parts = eId.split('-');
    setEdges((e) => e.filter((x) => !(x.source_node_id === parts[0] && x.source_port === parts[1] && x.target_node_id === parts[2] && x.target_port === parts[3])));
  };

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
      <path 
        key={eKey} 
        d={path} 
        fill="none" 
        stroke={activeHover ? "#3b82f6" : "#64748b"} 
        strokeWidth="3" 
        className={activeHover ? "animate-pulse" : "transition-colors cursor-pointer hover:stroke-rose-500"}
        onClick={activeHover ? undefined : (e) => { e.stopPropagation(); deleteEdge(eKey); }}
      />
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
          </div>
          <div className="flex items-center gap-3">
             <button
               onClick={() => setCreating(true)}
               className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 shadow"
             >
               <span className="material-icons-round text-sm">add</span> New
             </button>
          </div>
        </header>

        {pageState === "error" && <div className="p-8"><ErrorBanner message={fetchError} onRetry={() => void loadData()} /></div>}
        {pageState === "empty" && !creating && <EmptyState onCreate={() => setCreating(true)} />}

        {creating && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
               <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                   <h2 className="text-lg font-bold mb-4">Create Automation</h2>
                   <input 
                     autoFocus
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

        {pageState === "loaded" && (
          <div className="flex flex-1 flex-col lg:flex-row overflow-hidden">
            {/* Left Panel: List */}
            <aside className="w-full lg:w-72 shrink-0 border-r border-slate-200 bg-surface-light dark:border-slate-700 dark:bg-surface-dark flex flex-col">
              <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">My Rules</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                 {automations.map(auto => (
                     <button
                        key={auto.id}
                        onClick={() => setSelectedId(auto.id)}
                        className={`w-full text-left p-3 rounded-xl transition ${selectedId === auto.id ? 'bg-primary/10 border border-primary/30 text-primary dark:text-blue-400' : 'hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent text-slate-700 dark:text-slate-300'}`}
                     >
                         <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2 overflow-hidden">
                                 <span className="material-icons-round text-sm opacity-70">account_tree</span>
                                 <span className="truncate text-sm font-semibold">{auto.name}</span>
                             </div>
                             <span className={`w-2 h-2 rounded-full ${auto.is_enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                         </div>
                     </button>
                 ))}
              </div>
            </aside>

            {/* Center Panel: Graph Canvas */}
            <section className="flex-1 relative flex flex-col bg-slate-50 dark:bg-[#0b1120] border-r border-slate-200 dark:border-slate-800 overflow-hidden" 
                     onMouseMove={onCanvasMouseMove} 
                     onMouseUp={onCanvasMouseUp}
                     onMouseLeave={onCanvasMouseUp}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-surface-dark z-20">
                 <div className="flex items-center flex-wrap gap-2">
                     <button onClick={() => addNode("trigger")} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-700 dark:text-slate-300">
                         <span className="material-icons-round text-[16px] text-blue-500">flash_on</span> Add Trigger
                     </button>
                     <button onClick={() => addNode("condition")} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-700 dark:text-slate-300">
                         <span className="material-icons-round text-[16px] text-amber-500">help_outline</span> Add Condition
                     </button>
                     <button onClick={() => addNode("action")} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-700 dark:text-slate-300">
                         <span className="material-icons-round text-[16px] text-emerald-500">play_arrow</span> Add Action
                     </button>
                 </div>
                 <div className="flex items-center gap-2">
                    <button onClick={handleTrigger} disabled={triggerState === "pending"} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition disabled:opacity-50">
                       {triggerState === "pending" ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" /> : <span className="material-icons-round text-base">play_circle</span>}
                       Run Now
                    </button>
                    <button onClick={handleSaveGraph} disabled={saving} className="bg-primary hover:bg-blue-600 text-white shadow-md flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold transition disabled:opacity-50">
                       <span className="material-icons-round text-base">save</span> Save
                    </button>
                 </div>
              </div>

              <div className="flex-1 relative overflow-hidden">
                <TransformWrapper initialScale={1} minScale={0.2} maxScale={2} panning={{ excluded: ["nodrag"] }} doubleClick={{ disabled: true }}>
                  {() => (
                     <TransformComponent wrapperClass="w-full h-full cursor-grab active:cursor-grabbing" contentClass="w-[3000px] h-[3000px] relative">
                         
                         <div className="absolute inset-0 opacity-30 dark:opacity-[0.05]" style={{ backgroundImage: `radial-gradient(#94a3b8 1px, transparent 1px)`, backgroundSize: '24px 24px' }} />

                         {/* SVG Edges Layer */}
                         <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                            {edges.map(e => {
                                const sNode = nodes.find(n => n.id === e.source_node_id);
                                const tNode = nodes.find(n => n.id === e.target_node_id);
                                if (!sNode || !tNode) return null;
                                const sPort = getNodePorts(sNode.type).find(p => p.id === e.source_port);
                                const tPort = getNodePorts(tNode.type).find(p => p.id === e.target_port);
                                if (!sPort || !tPort) return null;
                                return renderEdge(sNode, sPort, tNode, tPort, `${e.source_node_id}-${e.source_port}-${e.target_node_id}-${e.target_port}`);
                            })}
                            
                            {/* Floating Edge while connecting */}
                            {connectingFrom && (() => {
                                const sNode = nodes.find(n => n.id === connectingFrom.nodeId);
                                if (!sNode) return null;
                                const sPort = getNodePorts(sNode.type).find(p => p.id === connectingFrom.portId);
                                if (!sPort) return null;
                                return renderEdge(sNode, sPort, {x: (sNode.config.ui?.x || 0) + sPort.offset.x + 20, y: (sNode.config.ui?.y || 0) + sPort.offset.y + 100}, null, "hover", true);
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
                                className={`nodrag absolute rounded-2xl border-2 cursor-move shadow-md transition-shadow bg-white dark:bg-slate-900 ${borderClasses} ${isSelected ? 'ring-4 ring-primary/20 shadow-xl' : 'hover:border-slate-400 dark:hover:border-slate-500'}`}
                                style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                                onMouseDown={(e) => startNodeDrag(e, node.id)}
                                onClick={(e) => { e.stopPropagation(); setSelectedNodeId(node.id); }}
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
                                 {ports.map((port, idx) => {
                                    const px = port.offset.x;
                                    const py = port.type === "in" ? -6 : NODE_HEIGHT - 6;
                                    return (
                                       <div key={port.id} title={port.label}
                                            className={`nodrag absolute w-3.5 h-3.5 rounded-full cursor-crosshair hover:scale-150 transition-transform shadow-sm
                                                bg-white border-2 border-slate-400 dark:bg-slate-900 dark:border-slate-500
                                                ${port.type === "in" ? 'hover:border-blue-500' : 'hover:border-amber-500'}`}
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
                  )}
                </TransformWrapper>
              </div>
            </section>

            {/* Right Panel: Inspector */}
            <aside className="w-full lg:w-80 shrink-0 border-l border-slate-200 bg-surface-light dark:border-slate-700 dark:bg-surface-dark overflow-y-auto">
               <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Node Properties</span>
                  {selectedNodeId && (
                     <button onClick={removeSelectedNode} className="text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/50 p-1.5 rounded-lg transition"><span className="material-icons-round text-sm">delete</span></button>
                  )}
               </div>
               
               {selectedNodeId ? (() => {
                   const node = nodes.find(n => n.id === selectedNodeId);
                   if (!node) return null;
                   
                   const updateConfig = (key: string, val: any) => {
                       setNodes(prev => prev.map(n => n.id === node.id ? { ...n, config: { ...n.config, props: { ...n.config.props, [key]: val } } } : n));
                   };
                   const updateNode = (key: keyof AutomationGraphNode, val: any) => {
                       setNodes(prev => prev.map(n => n.id === node.id ? { ...n, [key]: val } : n));
                   };

                   return (
                     <div className="p-5 space-y-6">
                         <label className="block">
                             <span className="text-xs font-bold text-slate-500 block mb-1">Label</span>
                             <input value={node.label || ""} onChange={(e) => updateNode('label', e.target.value)} className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary" />
                         </label>
                         
                         <label className="block">
                             <span className="text-xs font-bold text-slate-500 block mb-1">Logic Kind</span>
                             <select value={node.kind} onChange={(e) => updateNode('kind', e.target.value)} className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono text-xs">
                                 {node.type === "trigger" && <><option value="manual">manual</option><option value="device_state">device_state</option><option value="schedule_time">schedule_time</option></>}
                                 {node.type === "condition" && <><option value="device_state">device_state</option><option value="time_between">time_between</option></>}
                                 {node.type === "action" && <><option value="send_command">send_command</option><option value="send_notification">send_notification</option></>}
                             </select>
                         </label>

                         {/* Dynamic Configs based on kind */}
                         {node.kind === "device_state" || node.kind === "send_command" ? (
                             <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                                 <label className="block">
                                     <span className="text-xs font-bold text-slate-500 block mb-1">Target Device</span>
                                     <select value={node.config.props?.device_id || ""} onChange={(e) => updateConfig('device_id', e.target.value)} className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary">
                                        <option value="">Select a device...</option>
                                        {devices.map(d => <option key={d.device_id} value={d.device_id}>{d.name}</option>)}
                                     </select>
                                 </label>
                                 <label className="block">
                                     <span className="text-xs font-bold text-slate-500 block mb-1">Target Pin / Function</span>
                                     <input value={node.config.props?.pin || ""} onChange={(e) => updateConfig('pin', e.target.value)} placeholder="e.g. 5 or RELAY_1" className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono" />
                                 </label>
                                 
                                 {node.kind === "device_state" && (
                                    <div className="flex gap-2">
                                        <label className="block w-1/3">
                                            <span className="text-xs font-bold text-slate-500 block mb-1">Op</span>
                                            <select value={node.config.props?.operator || "=="} onChange={(e) => updateConfig('operator', e.target.value)} className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-2 outline-none font-mono">
                                                <option value="==">==</option><option value="!=">!=</option><option value=">">&gt;</option><option value="<">&lt;</option>
                                            </select>
                                        </label>
                                        <label className="flex-1 block">
                                            <span className="text-xs font-bold text-slate-500 block mb-1">Value</span>
                                            <input value={node.config.props?.value || ""} onChange={(e) => updateConfig('value', e.target.value)} placeholder="e.g. HIGH or 45" className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono" />
                                        </label>
                                    </div>
                                 )}

                                 {node.kind === "send_command" && (
                                     <label className="block">
                                        <span className="text-xs font-bold text-slate-500 block mb-1">Payload</span>
                                        <input value={node.config.props?.payload || ""} onChange={(e) => updateConfig('payload', e.target.value)} placeholder="e.g. 1" className="w-full text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-primary font-mono" />
                                     </label>
                                 )}
                             </div>
                         ) : null}

                         {/* Debug display of ID */}
                         <div className="pt-8 mb-4 border-t border-slate-200 dark:border-slate-800">
                             <span className="text-[10px] font-mono text-slate-400">Node ID: {node.id}</span>
                         </div>
                     </div>
                   );
               })() : (
                   <div className="p-8 text-center text-slate-400 text-sm">
                       Select a node to inspect its properties.
                   </div>
               )}

               {/* Last run result inside right panel bottom */}
               {lastResult && selectedAutomation && !selectedNodeId && (
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
