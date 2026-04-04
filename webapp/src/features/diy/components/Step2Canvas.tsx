import { useEffect, useMemo, useState } from "react";
import { Rnd } from "react-rnd";

import { getCardMinHeight } from "@/components/DeviceCard";
import { fetchDashboardDevices } from "@/lib/api";
import type { DeviceConfig, PinConfig } from "@/types/device";

import type { BoardPin, BoardProfile } from "../board-profiles";
import type {
  PinMapping,
  PortableDashboardCard,
  PortableDashboardCardLayout,
  PortableDashboardConfig,
  ProjectSyncState,
} from "../types";

const SCREEN_WIDTH = 480;
const SCREEN_HEIGHT = 272;
const SIDEBAR_WIDTH = 72;
const PREVIEW_SCALE = 2;
const PREVIEW_WIDTH = SCREEN_WIDTH * PREVIEW_SCALE;
const PREVIEW_HEIGHT = SCREEN_HEIGHT * PREVIEW_SCALE;
const PREVIEW_SIDEBAR_WIDTH = SIDEBAR_WIDTH * PREVIEW_SCALE;
const GRID_SIZE = 8;
const PREVIEW_WIFI_NETWORKS = [
  { ssid: "E-Connect Lab", detail: "-42 dBm / lock" },
  { ssid: "Workshop 5G", detail: "-51 dBm / lock" },
  { ssid: "PortableControl", detail: "-63 dBm / open" },
  { ssid: "Guest IoT", detail: "-68 dBm / lock" },
];
const PREVIEW_KEYBOARD_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

type PortableRuntimePreview = "wifi" | "password" | "pairing" | "dashboard";

export interface Step2CanvasProps {
  pins: PinMapping[];
  setPins: React.Dispatch<React.SetStateAction<PinMapping[]>>;
  portableDashboard: PortableDashboardConfig;
  setPortableDashboard: React.Dispatch<React.SetStateAction<PortableDashboardConfig>>;
  board: BoardProfile;
  boardPins: BoardPin[];
  selectedPinId: string | null;
  setSelectedPinId: React.Dispatch<React.SetStateAction<string | null>>;
  projectName: string;
  configBusy?: boolean;
  projectSyncState: ProjectSyncState;
  onExportConfig?: () => void | Promise<void>;
  onNext: () => void;
  onBack: () => void;
}

function toPortableCardPins(pinConfigurations: PinConfig[]) {
  return pinConfigurations.map((pin) => ({
    gpio_pin: pin.gpio_pin,
    mode: pin.mode,
    function: pin.function,
    label: pin.label,
    extra_params: pin.extra_params ?? undefined,
  }));
}

function clampLayout(layout: PortableDashboardCardLayout): PortableDashboardCardLayout {
  const clampedWidth = Math.min(Math.max(Math.round(layout.w), 116), SCREEN_WIDTH - SIDEBAR_WIDTH - 12);
  const clampedHeight = Math.min(Math.max(Math.round(layout.h), 84), SCREEN_HEIGHT - 12);
  const maxX = SCREEN_WIDTH - SIDEBAR_WIDTH - clampedWidth;
  const maxY = SCREEN_HEIGHT - clampedHeight;

  return {
    x: Math.min(Math.max(Math.round(layout.x), 0), Math.max(0, maxX)),
    y: Math.min(Math.max(Math.round(layout.y), 0), Math.max(0, maxY)),
    w: clampedWidth,
    h: clampedHeight,
  };
}

function normalizePortableDashboard(config: PortableDashboardConfig): PortableDashboardConfig {
  return {
    variant: "jc3827w543-ctp",
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    sidebar_width: SIDEBAR_WIDTH,
    cards: config.cards.map((card) => ({
      ...card,
      layout: clampLayout(card.layout),
      pins: toPortableCardPins(card.pins),
    })),
  };
}

function createPortableCard(device: DeviceConfig, index: number): PortableDashboardCard {
  const minHeight = Math.max(92, Math.min(150, Math.round(getCardMinHeight(device) * 0.78)));

  return {
    device_id: device.device_id,
    name: device.name,
    room_name: device.room_name,
    mode: device.mode,
    provider: device.provider,
    layout: clampLayout({
      x: 16 + (index % 2) * 92,
      y: 16 + Math.floor(index / 2) * 76,
      w: 174,
      h: minHeight,
    }),
    pins: toPortableCardPins(device.pin_configurations),
  };
}

function pinLabel(pin: PortableDashboardCard["pins"][number]) {
  return pin.label || pin.function || `GPIO ${pin.gpio_pin}`;
}

function DashboardPreviewCard({
  card,
  isOnline,
}: {
  card: PortableDashboardCard;
  isOnline: boolean;
}) {
  const visibleRows = Math.max(1, Math.floor((card.layout.h - 46) / 28));
  const visiblePins = card.pins.slice(0, visibleRows);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[20px] bg-[#17313f] text-white shadow-[0_18px_38px_rgba(2,6,23,0.35)] ring-1 ring-white/10">
      <div
        className={`pointer-events-none absolute inset-0 rounded-[20px] ring-2 ${isOnline ? "ring-cyan-300/40" : "ring-slate-300/20"
          }`}
      />
      <div className="relative flex h-full flex-col px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-[0.02em] text-white">
              {card.name}
            </div>
            <div className="mt-1 text-[9px] uppercase tracking-[0.22em] text-slate-300/65">
              {card.room_name || "Unassigned"}
            </div>
          </div>
          <div
            className={`rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] ${isOnline
                ? "bg-emerald-400/15 text-emerald-200"
                : "bg-slate-100/10 text-slate-300"
              }`}
          >
            {isOnline ? "online" : "offline"}
          </div>
        </div>

        <div className="mt-3 flex-1 space-y-2 overflow-hidden">
          {visiblePins.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-[11px] text-slate-300/75">
              No mapped actions saved for this card yet.
            </div>
          ) : (
            visiblePins.map((pin, index) => {
              const pwmMin = pin.extra_params?.min_value ?? 0;
              const pwmMax = pin.extra_params?.max_value ?? 255;
              const previewBrightness = Math.round((Math.min(pwmMin, pwmMax) + Math.max(pwmMin, pwmMax)) / 2);
              const outputActive = isOnline && index % 2 === 0;

              return (
                <div
                  key={`${card.device_id}-${pin.gpio_pin}-${index}`}
                  className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium text-white/95">
                        {pinLabel(pin)}
                      </div>
                      <div className="mt-1 text-[9px] uppercase tracking-[0.18em] text-slate-300/55">
                        {pin.mode}
                      </div>
                    </div>

                    {pin.mode === "OUTPUT" ? (
                      <div
                        className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${outputActive
                            ? "bg-cyan-400/15 text-cyan-100"
                            : "bg-slate-200/10 text-slate-300"
                          }`}
                      >
                        {outputActive ? "ON" : "OFF"}
                      </div>
                    ) : pin.mode === "PWM" ? (
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white/8 text-[12px] text-white/90">
                          -
                        </div>
                        <div className="min-w-10 text-center text-[11px] font-semibold text-cyan-100">
                          {previewBrightness}
                        </div>
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white/8 text-[12px] text-white/90">
                          +
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] font-medium text-slate-300">
                        {isOnline ? "1" : "0"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function Step2Canvas({
  pins,
  setPins,
  portableDashboard,
  setPortableDashboard,
  board,
  boardPins,
  configBusy = false,
  projectSyncState,
  onExportConfig,
  onNext,
  onBack,
}: Step2CanvasProps) {
  const [activeTab, setActiveTab] = useState<"canvas" | "jump">("canvas");
  const [previewScreen, setPreviewScreen] = useState<PortableRuntimePreview>("dashboard");
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void fetchDashboardDevices()
      .then((data) => {
        if (cancelled) {
          return;
        }
        setDevices(data.filter((device) => device.mode !== "portableDashboard"));
        setLoadingDevices(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingDevices(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const dashboard = useMemo(
    () => normalizePortableDashboard(portableDashboard),
    [portableDashboard],
  );
  const selectedCardIds = useMemo(
    () => new Set(dashboard.cards.map((card) => card.device_id)),
    [dashboard.cards],
  );
  const mappedPinCount = pins.length;
  const previewTabs: Array<{ id: PortableRuntimePreview; label: string; hint: string }> = [
    { id: "wifi", label: "Wi-Fi Scan", hint: "Boot screen after flash or replug." },
    { id: "password", label: "Password", hint: "Board-local keyboard entry." },
    { id: "pairing", label: "Pairing", hint: "Shown while Wi-Fi and MQTT pair." },
    { id: "dashboard", label: "Dashboard", hint: "Persistent sidebar and touch cards." },
  ];

  const updateDashboard = (
    updater: (previous: PortableDashboardConfig) => PortableDashboardConfig,
  ) => {
    setPortableDashboard((previous) => normalizePortableDashboard(updater(previous)));
  };

  const updateCardLayout = (deviceId: string, layout: PortableDashboardCardLayout) => {
    updateDashboard((previous) => ({
      ...previous,
      cards: previous.cards.map((card) =>
        card.device_id === deviceId ? { ...card, layout: clampLayout(layout) } : card,
      ),
    }));
  };

  const removeCard = (deviceId: string) => {
    updateDashboard((previous) => ({
      ...previous,
      cards: previous.cards.filter((card) => card.device_id !== deviceId),
    }));
  };

  const addCard = (device: DeviceConfig) => {
    if (selectedCardIds.has(device.device_id)) {
      return;
    }

    updateDashboard((previous) => ({
      ...previous,
      cards: [...previous.cards, createPortableCard(device, previous.cards.length)],
    }));
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-[#0b1120]">
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              PortableControl Canvas
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Design the JC3827W543 CTP dashboard at {SCREEN_WIDTH}x{SCREEN_HEIGHT}, then map the board key and jump pins.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-sky-100 px-3 py-1 font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                {dashboard.cards.length} control card{dashboard.cards.length === 1 ? "" : "s"}
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {mappedPinCount} mapped jump pin{mappedPinCount === 1 ? "" : "s"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Sync: {projectSyncState}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onExportConfig ? (
              <button
                type="button"
                onClick={() => void onExportConfig()}
                disabled={configBusy}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Export JSON
              </button>
            ) : null}
            <button
              type="button"
              onClick={onBack}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onNext}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600"
            >
              Validate Configuration
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-4 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            className={`border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${activeTab === "canvas"
                ? "border-primary text-primary"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-300"
              }`}
            onClick={() => setActiveTab("canvas")}
          >
            Canvas Builder
          </button>
          <button
            type="button"
            className={`border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${activeTab === "jump"
                ? "border-primary text-primary"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-300"
              }`}
            onClick={() => setActiveTab("jump")}
          >
            Jump Pins
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {activeTab === "canvas" ? (
          <div className="flex min-h-[640px] flex-col gap-6 xl:flex-row">
            <div className="flex min-w-0 flex-1 flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    Device Screen Preview
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Stored layout coordinates are written back in native board pixels. The board boots into Wi-Fi setup first, then reaches the dashboard after pairing.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  CTP Board C
                </div>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {previewTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPreviewScreen(tab.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${previewScreen === tab.id
                        ? "bg-sky-500 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                    title={tab.hint}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-1 items-center justify-center overflow-auto rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),_transparent_48%),linear-gradient(180deg,#111827_0%,#020617_100%)] p-6 dark:border-slate-800">
                <div
                  className="relative overflow-hidden rounded-[2rem] border border-slate-700 bg-[#0d1016] shadow-[0_30px_80px_rgba(15,23,42,0.5)]"
                  style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
                >
                  {previewScreen === "wifi" ? (
                    <div className="absolute inset-0 bg-[#0c2030] px-8 py-7 text-white">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[28px] font-semibold tracking-[0.02em] text-white">
                            PortableControl Wi-Fi
                          </div>
                          <p className="mt-2 text-[12px] text-slate-300">
                            Tap a network on the board to continue.
                          </p>
                        </div>
                        <div className="rounded-2xl bg-cyan-500 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-950">
                          Rescan
                        </div>
                      </div>

                      <div className="mt-7 space-y-3">
                        {PREVIEW_WIFI_NETWORKS.map((network, index) => (
                          <div
                            key={network.ssid}
                            className={`flex items-center justify-between rounded-[18px] px-5 py-4 ${index === 0 ? "bg-cyan-500/20" : "bg-white/6"
                              }`}
                          >
                            <div className="text-[16px] font-medium text-white">{network.ssid}</div>
                            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
                              {network.detail}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {previewScreen === "password" ? (
                    <div className="absolute inset-0 bg-[#0c2030] px-8 py-7 text-white">
                      <div className="text-[28px] font-semibold tracking-[0.02em] text-white">
                        Enter Wi-Fi Password
                      </div>
                      <div className="mt-2 text-[13px] text-cyan-300">E-Connect Lab</div>

                      <div className="mt-5 rounded-[18px] border border-white/12 bg-white/6 px-5 py-4 text-[14px] tracking-[0.24em] text-slate-200">
                        ************
                      </div>

                      <div className="mt-5 space-y-3">
                        {PREVIEW_KEYBOARD_ROWS.map((row) => (
                          <div key={row} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
                            {row.split("").map((key) => (
                              <div
                                key={`${row}-${key}`}
                                className="flex h-11 items-center justify-center rounded-xl bg-white/8 text-[14px] font-medium text-white"
                              >
                                {key}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 grid grid-cols-[56px_62px_1fr_76px_112px] gap-2">
                        {["#+=", "Shift", "Space", "Delete", "Connect"].map((key, index) => (
                          <div
                            key={key}
                            className={`flex h-11 items-center justify-center rounded-xl text-[12px] font-semibold ${index === 4
                                ? "bg-cyan-500 text-slate-950"
                                : index === 3
                                  ? "bg-rose-500/75 text-white"
                                  : "bg-white/8 text-white"
                              }`}
                          >
                            {key}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {previewScreen === "pairing" ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0c2030] px-10 text-center text-white">
                      <div className="text-[30px] font-semibold tracking-[0.02em] text-white">
                        Pairing PortableControl
                      </div>
                      <p className="mt-4 text-[14px] text-slate-300">
                        Connecting to Wi-Fi and server
                      </p>
                      <div className="mt-5 text-[32px] font-semibold tracking-[0.6em] text-cyan-300">
                        ...
                      </div>
                      <div className="mt-9 max-w-[620px] rounded-[20px] border border-white/10 bg-white/5 px-6 py-5 text-[12px] text-slate-300">
                        The board switches to the touch dashboard after secure pairing.
                      </div>
                    </div>
                  ) : null}

                  {previewScreen === "dashboard" ? (
                    <>
                      <div className="absolute inset-y-0 left-0 flex w-[144px] flex-col items-center gap-6 border-r border-white/10 bg-[#11131a] py-8">
                        <div className="rounded-2xl bg-cyan-400/12 p-4 text-cyan-300 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]">
                          <span className="material-icons-round text-[28px]">touch_app</span>
                        </div>
                        <div className="flex flex-col gap-3 text-center text-[10px] uppercase tracking-[0.24em] text-slate-500">
                          <span>CTL</span>
                          <span>AUTO</span>
                          <span>SET</span>
                        </div>
                        <div className="mt-auto rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                          LAN
                        </div>
                      </div>

                      <div
                        className="absolute inset-y-0 right-0 overflow-hidden bg-[#0c2030]"
                        style={{ left: PREVIEW_SIDEBAR_WIDTH }}
                      >
                        <div className="px-7 py-5">
                          <div className="text-[26px] font-semibold tracking-[0.02em] text-white">
                            PortableControl
                          </div>
                          <p className="mt-2 text-[12px] text-slate-300">
                            Touch the card controls to publish MQTT commands.
                          </p>
                        </div>

                        {dashboard.cards.length === 0 ? (
                          <div className="absolute inset-x-8 top-[124px] flex justify-center text-center">
                            <div className="rounded-[26px] border border-dashed border-white/10 bg-white/5 px-10 py-12">
                              <div className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-100/80">
                                PortableControl Ready
                              </div>
                              <p className="mt-3 text-sm text-slate-300">
                                Add approved server devices from the right panel to compose the on-board dashboard.
                              </p>
                            </div>
                          </div>
                        ) : (
                          dashboard.cards.map((card) => {
                            const liveDevice = devices.find((device) => device.device_id === card.device_id);

                            return (
                              <Rnd
                                key={card.device_id}
                                bounds="parent"
                                dragGrid={[GRID_SIZE, GRID_SIZE]}
                                resizeGrid={[GRID_SIZE, GRID_SIZE]}
                                size={{
                                  width: card.layout.w * PREVIEW_SCALE,
                                  height: card.layout.h * PREVIEW_SCALE,
                                }}
                                position={{
                                  x: card.layout.x * PREVIEW_SCALE,
                                  y: card.layout.y * PREVIEW_SCALE,
                                }}
                                minWidth={116 * PREVIEW_SCALE}
                                minHeight={84 * PREVIEW_SCALE}
                                onDragStop={(_event, data) => {
                                  updateCardLayout(card.device_id, {
                                    ...card.layout,
                                    x: Math.round(data.x / PREVIEW_SCALE),
                                    y: Math.round(data.y / PREVIEW_SCALE),
                                  });
                                }}
                                onResizeStop={(_event, _direction, ref, _delta, position) => {
                                  updateCardLayout(card.device_id, {
                                    x: Math.round(position.x / PREVIEW_SCALE),
                                    y: Math.round(position.y / PREVIEW_SCALE),
                                    w: Math.round(parseInt(ref.style.width, 10) / PREVIEW_SCALE),
                                    h: Math.round(parseInt(ref.style.height, 10) / PREVIEW_SCALE),
                                  });
                                }}
                                className="group !overflow-visible rounded-[20px] bg-transparent"
                              >
                                <button
                                  type="button"
                                  onClick={() => removeCard(card.device_id)}
                                  className="absolute -right-3 -top-3 z-50 flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-white opacity-0 shadow-lg transition group-hover:opacity-100"
                                  title={`Remove ${card.name}`}
                                >
                                  <span className="material-icons-round text-[16px]">close</span>
                                </button>
                                <DashboardPreviewCard
                                  card={card}
                                  isOnline={liveDevice?.conn_status === "online"}
                                />
                              </Rnd>
                            );
                          })
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex w-full shrink-0 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950 xl:w-[340px]">
              <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Available Dashboard Devices</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Each selected card stores a snapshot of the target device pins for the board-local runtime.
                </p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {loadingDevices ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Loading dashboard devices...
                  </div>
                ) : devices.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    No approved dashboard devices were returned by the server.
                  </div>
                ) : (
                  devices.map((device) => {
                    const isSelected = selectedCardIds.has(device.device_id);

                    return (
                      <button
                        key={device.device_id}
                        type="button"
                        onClick={() => addCard(device)}
                        disabled={isSelected}
                        className={`w-full rounded-2xl border p-4 text-left transition ${isSelected
                            ? "cursor-not-allowed border-slate-200 bg-slate-100/80 opacity-60 dark:border-slate-800 dark:bg-slate-900/70"
                            : "border-slate-200 bg-white hover:border-primary hover:bg-sky-50/50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-primary dark:hover:bg-slate-900"
                          }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">{device.name}</div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {device.room_name || "Unassigned room"}
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${device.conn_status === "online"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                              }`}
                          >
                            {device.conn_status}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                          <span>{device.pin_configurations.length} mapped pin{device.pin_configurations.length === 1 ? "" : "s"}</span>
                          <span>{isSelected ? "Added" : "Add to canvas"}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Jump Pins Mapping
                  </h3>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    The JC3827W543 keeps the display, touch, SD, USB, and backlight lines internal. Only the board key and exposed jump pins below are available for mapping.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Board</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{board.name}</div>
                </div>
              </div>

              <div className="space-y-3">
                {boardPins.map((pin) => {
                  const mapped = pins.find((entry) => entry.gpio_pin === pin.gpio);

                  return (
                    <div
                      key={pin.id}
                      className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                            GPIO {pin.gpio}
                          </div>
                          {pin.bootSensitive ? (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              Boot sensitive
                            </span>
                          ) : null}
                          {pin.inputOnly ? (
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              Input only
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{pin.label}</div>
                        {pin.note ? (
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{pin.note}</div>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-2 md:min-w-[360px] md:flex-row">
                        <select
                          value={mapped?.mode || "none"}
                          onChange={(event) => {
                            const mode = event.target.value;
                            if (mode === "none") {
                              setPins((previous) => previous.filter((entry) => entry.gpio_pin !== pin.gpio));
                              return;
                            }

                            const nextPin: PinMapping = {
                              gpio_pin: pin.gpio,
                              mode: mode as PinMapping["mode"],
                              function: mapped?.function ?? "",
                              label: mapped?.label ?? `${pin.label}`,
                              extra_params: mapped?.extra_params ?? {},
                            };

                            setPins((previous) => {
                              const filtered = previous.filter((entry) => entry.gpio_pin !== pin.gpio);
                              return [...filtered, nextPin].sort((left, right) => left.gpio_pin - right.gpio_pin);
                            });
                          }}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        >
                          <option value="none">Unused</option>
                          {pin.capabilities.map((capability) => (
                            <option key={capability} value={capability}>
                              {capability}
                            </option>
                          ))}
                        </select>

                        <input
                          type="text"
                          placeholder="Mapped function or label"
                          value={mapped?.function || ""}
                          disabled={!mapped}
                          onChange={(event) => {
                            setPins((previous) =>
                              previous.map((entry) =>
                                entry.gpio_pin === pin.gpio
                                  ? { ...entry, function: event.target.value, label: event.target.value || entry.label }
                                  : entry,
                              ),
                            );
                          }}
                          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
