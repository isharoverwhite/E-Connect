"use client";

import Link from "next/link";
import { useState } from "react";

type TemplateStatus =
  | "artifact_ready"
  | "building"
  | "validation_error"
  | "server_error";
type EditorTab = "logic" | "handoff";
type LogTone = "muted" | "info" | "success" | "warning" | "error";
type StepTone = "done" | "active" | "blocked" | "upcoming";

interface LogLine {
  tone: LogTone;
  text: string;
}

interface StepCard {
  title: string;
  detail: string;
  tone: StepTone;
}

interface AutomationTemplate {
  id: string;
  name: string;
  path: string;
  language: string;
  chip: string;
  icon: string;
  accentClass: string;
  status: TemplateStatus;
  summary: string;
  outcome: string;
  buildJob: string;
  manifestPath: string | null;
  statusCopy: string;
  validationCopy: string;
  serverCopy: string;
  logicCode: string;
  terminalLines: LogLine[];
}

const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "green-trigger",
    name: "Green Trigger",
    path: "/automation/green_trigger.ino",
    language: "Arduino C++",
    chip: "ESP32-C3",
    icon: "eco",
    accentClass:
      "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
    status: "artifact_ready",
    summary:
      "Soil-moisture automation with a finished server build and manifest ready for browser flashing.",
    outcome: "Ready for ESP32-webflasher",
    buildJob: "build-5f29a",
    manifestPath: "/api/v1/diy/build/build-5f29a/artifact",
    statusCopy:
      "The firmware bundle is compiled, the manifest is published, and the UI can hand off to ESP32-webflasher.",
    validationCopy:
      "GPIO map is valid and the automation passed the pre-build checks for the selected ESP32-C3 board.",
    serverCopy:
      "Server build finished successfully. Keep the manifest URL durable so the browser flasher can reuse it safely.",
    logicCode: `#include <Arduino.h>
#include "EConnectAutomation.h"

static constexpr uint8_t SOIL_PIN = 2;
static constexpr uint8_t PUMP_RELAY_PIN = 10;
static constexpr uint16_t DRY_THRESHOLD = 2150;

EConnectAutomation automation("green-trigger", "ESP32-C3");

void setup() {
  Serial.begin(115200);
  pinMode(PUMP_RELAY_PIN, OUTPUT);
  digitalWrite(PUMP_RELAY_PIN, LOW);
  automation.begin();
}

void loop() {
  automation.poll();

  const int soilValue = analogRead(SOIL_PIN);
  const bool canWaterNow = automation.isWithinWindow("06:00", "06:15");
  const bool shouldWater = soilValue > DRY_THRESHOLD && canWaterNow;

  if (shouldWater) {
    digitalWrite(PUMP_RELAY_PIN, HIGH);
    automation.publishMetric("soil_raw", soilValue);
    automation.log("Pump enabled for 3 seconds");
    delay(3000);
  }

  digitalWrite(PUMP_RELAY_PIN, LOW);
  automation.sleepMs(1000);
}`,
    terminalLines: [
      { tone: "muted", text: "[10:41:02] POST /api/v1/diy/build project=green-trigger" },
      { tone: "info", text: "[10:41:03] Validation passed: pin map + board profile resolved." },
      { tone: "success", text: "[10:41:08] Build status -> artifact_ready" },
      {
        tone: "success",
        text: "[10:41:08] Manifest published: /api/v1/diy/build/build-5f29a/artifact",
      },
      {
        tone: "warning",
        text: "[10:41:09] Browser flash remains gated until the WebUI mounts <esp-web-install-button>.",
      },
    ],
  },
  {
    id: "climate-guard",
    name: "Climate Guard",
    path: "/automation/climate_guard.cpp",
    language: "PlatformIO C++",
    chip: "ESP32-S3",
    icon: "device_thermostat",
    accentClass:
      "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
    status: "building",
    summary:
      "Cooling automation that is already validated and currently building on the server.",
    outcome: "Server build in progress",
    buildJob: "build-b1e30",
    manifestPath: null,
    statusCopy:
      "The UI should show a live building state while polling the server job until artifact_ready.",
    validationCopy:
      "Board profile, pin map, and feature flags are valid. The remaining work is server-side compilation.",
    serverCopy:
      "Poll the build endpoint and unlock flashing only after the job returns artifact_ready plus a manifest URL.",
    logicCode: `#include <Arduino.h>
#include "ClimateRuntime.h"

static constexpr uint8_t AC_RELAY_PIN = 12;
static constexpr uint8_t SENSOR_PIN = 4;
static constexpr float TARGET_C = 24.5f;

ClimateRuntime runtime("climate-guard", "ESP32-S3");

void setup() {
  Serial.begin(115200);
  pinMode(AC_RELAY_PIN, OUTPUT);
  digitalWrite(AC_RELAY_PIN, LOW);
  runtime.begin();
}

void loop() {
  runtime.poll();

  const float roomTemp = runtime.readTemperatureC(SENSOR_PIN);
  const bool shouldCool = roomTemp > TARGET_C && runtime.allowAction("living-room");

  digitalWrite(AC_RELAY_PIN, shouldCool ? HIGH : LOW);
  runtime.publishMetric("room_temp_c", roomTemp);
  runtime.sleepMs(1500);
}`,
    terminalLines: [
      { tone: "muted", text: "[11:12:10] POST /api/v1/diy/build project=climate-guard" },
      { tone: "info", text: "[11:12:11] Build accepted, job id build-b1e30" },
      { tone: "info", text: "[11:12:14] Polling /api/v1/diy/build/build-b1e30" },
      { tone: "warning", text: "[11:12:14] Status -> building (toolchain resolving dependencies)" },
      { tone: "muted", text: "[11:12:15] Keep flash UI disabled until artifact_ready." },
    ],
  },
  {
    id: "night-lock",
    name: "Night Lock",
    path: "/automation/night_lock.cpp",
    language: "Arduino C++",
    chip: "ESP32",
    icon: "shield_lock",
    accentClass:
      "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
    status: "validation_error",
    summary:
      "Door lock automation blocked before build because the current pin map conflicts with the selected relay.",
    outcome: "Fix validation blockers first",
    buildJob: "not-started",
    manifestPath: null,
    statusCopy:
      "Validation errors should stop the build button and clearly tell the user what must be fixed first.",
    validationCopy:
      "GPIO 5 and GPIO 18 are both mapped to the relay latch. Resolve the pin conflict before queueing the server build.",
    serverCopy:
      "Do not create a build job or a flash manifest while validation is red. The browser flasher must stay blocked.",
    logicCode: `#include <Arduino.h>
#include "LockRuntime.h"

static constexpr uint8_t LOCK_RELAY_PIN = 5;
static constexpr uint8_t STATUS_LED_PIN = 18;

LockRuntime runtime("night-lock", "ESP32");

void setup() {
  Serial.begin(115200);
  pinMode(LOCK_RELAY_PIN, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  runtime.begin();
}

void loop() {
  runtime.poll();

  if (runtime.afterHour(22)) {
    runtime.lockDoor(LOCK_RELAY_PIN);
    digitalWrite(STATUS_LED_PIN, HIGH);
  }

  runtime.sleepMs(500);
}`,
    terminalLines: [
      { tone: "muted", text: "[12:08:01] Validation request started for night-lock" },
      { tone: "error", text: "[12:08:01] validation.error = gpio_conflict" },
      { tone: "error", text: "[12:08:01] GPIO 5 and GPIO 18 cannot drive the same relay latch." },
      { tone: "warning", text: "[12:08:01] Build queue skipped because the validation gate failed." },
      { tone: "muted", text: "[12:08:02] Flash contract remains unavailable." },
    ],
  },
  {
    id: "pump-failover",
    name: "Pump Failover",
    path: "/automation/pump_failover.cpp",
    language: "PlatformIO C++",
    chip: "ESP32-C6",
    icon: "water_pump",
    accentClass:
      "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
    status: "server_error",
    summary:
      "Validation passed, but the last build failed on the server and needs a code or dependency fix.",
    outcome: "Server error surfaced",
    buildJob: "build-e72d1",
    manifestPath: null,
    statusCopy:
      "Server failures must be observable and must not be misreported as a flash issue in the WebUI.",
    validationCopy:
      "The configuration is safe to build, but the source package did not compile into a binary artifact.",
    serverCopy:
      "Expose build logs, keep the flash CTA disabled, and ask the user to fix firmware logic before retrying.",
    logicCode: `#include <Arduino.h>
#include "PumpCluster.h"

PumpCluster cluster("pump-failover", "ESP32-C6");

void setup() {
  Serial.begin(115200);
  cluster.begin();
}

void loop() {
  cluster.poll();

  if (cluster.primaryPumpOffline()) {
    cluster.startSecondaryPump();
    cluster.log("Fallback pump enabled");
  }

  cluster.sleepMs(1200);
}`,
    terminalLines: [
      { tone: "muted", text: "[13:32:44] POST /api/v1/diy/build project=pump-failover" },
      { tone: "info", text: "[13:32:45] Validation passed and toolchain started." },
      { tone: "error", text: "[13:32:49] build_failed: unknown type name 'PumpCluster'" },
      { tone: "error", text: "[13:32:49] See build log /artifacts/build-e72d1/compile.log" },
      { tone: "warning", text: "[13:32:50] Manifest not generated, browser flash remains locked." },
    ],
  },
];

const API_CHECKPOINTS = [
  "POST /api/v1/diy/build",
  "GET /api/v1/diy/build/{job_id}",
  "GET /api/v1/diy/build/{job_id}/artifact",
] as const;

function getStatusMeta(status: TemplateStatus) {
  switch (status) {
    case "artifact_ready":
      return {
        label: "artifact ready",
        shortLabel: "Ready",
        pillClass:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
        dotClass: "bg-emerald-500",
        emphasisClass:
          "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
      };
    case "building":
      return {
        label: "building",
        shortLabel: "Building",
        pillClass:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
        dotClass: "bg-amber-400",
        emphasisClass:
          "border-amber-200 bg-amber-50/80 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
      };
    case "validation_error":
      return {
        label: "validation blocked",
        shortLabel: "Blocked",
        pillClass:
          "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
        dotClass: "bg-rose-500",
        emphasisClass:
          "border-rose-200 bg-rose-50/80 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
      };
    default:
      return {
        label: "server failed",
        shortLabel: "Failed",
        pillClass:
          "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
        dotClass: "bg-rose-500",
        emphasisClass:
          "border-rose-200 bg-rose-50/80 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
      };
  }
}

function getLogToneClass(tone: LogTone) {
  switch (tone) {
    case "info":
      return "text-sky-300";
    case "success":
      return "text-emerald-300";
    case "warning":
      return "text-amber-300";
    case "error":
      return "text-rose-300";
    default:
      return "text-slate-500";
  }
}

function getStepToneClass(tone: StepTone) {
  switch (tone) {
    case "done":
      return "border-emerald-200 bg-white/95 text-slate-800 shadow-lg shadow-emerald-500/10 dark:border-emerald-500/20 dark:bg-navy-800/95 dark:text-slate-100";
    case "active":
      return "border-primary/40 bg-blue-50/95 text-slate-900 shadow-lg shadow-blue-500/15 dark:border-primary/40 dark:bg-navy-800/95 dark:text-white";
    case "blocked":
      return "border-rose-200 bg-rose-50/95 text-slate-900 shadow-lg shadow-rose-500/10 dark:border-rose-500/25 dark:bg-navy-800/95 dark:text-white";
    default:
      return "border-slate-200 bg-white/90 text-slate-500 shadow-sm dark:border-slate-700 dark:bg-navy-800/80 dark:text-slate-400";
  }
}

function getWorkflowCards(template: AutomationTemplate): StepCard[] {
  if (template.status === "validation_error") {
    return [
      {
        title: "Write logic",
        detail: "Author firmware behavior and keep lifecycle transitions explicit.",
        tone: "done",
      },
      {
        title: "Validate board + pins",
        detail: template.validationCopy,
        tone: "blocked",
      },
      {
        title: "Queue server build",
        detail: "Blocked until validation returns a safe config.",
        tone: "upcoming",
      },
      {
        title: "Mount ESP32-webflasher",
        detail: "Enable only after artifact_ready and manifest publication.",
        tone: "upcoming",
      },
    ];
  }

  if (template.status === "server_error") {
    return [
      {
        title: "Write logic",
        detail: "Source package is complete enough to validate.",
        tone: "done",
      },
      {
        title: "Validate board + pins",
        detail: "Pre-build checks passed for the selected profile.",
        tone: "done",
      },
      {
        title: "Queue server build",
        detail: template.serverCopy,
        tone: "blocked",
      },
      {
        title: "Mount ESP32-webflasher",
        detail: "Still locked because no manifest was generated.",
        tone: "upcoming",
      },
    ];
  }

  if (template.status === "building") {
    return [
      {
        title: "Write logic",
        detail: "Starter firmware is ready for compilation.",
        tone: "done",
      },
      {
        title: "Validate board + pins",
        detail: template.validationCopy,
        tone: "done",
      },
      {
        title: "Queue server build",
        detail: "Poll the build job until it reaches artifact_ready.",
        tone: "active",
      },
      {
        title: "Mount ESP32-webflasher",
        detail: "Prepare the browser handoff but keep it disabled for now.",
        tone: "upcoming",
      },
    ];
  }

  return [
    {
      title: "Write logic",
      detail: "User-authored automation lives in a real source file, not in transient UI state.",
      tone: "done",
    },
    {
      title: "Validate board + pins",
      detail: template.validationCopy,
      tone: "done",
    },
    {
      title: "Queue server build",
      detail: "Build logs and durable artifacts are already traceable by job id.",
      tone: "done",
    },
    {
      title: "Mount ESP32-webflasher",
      detail: "The manifest is ready. The WebUI can now hand off to the browser flasher.",
      tone: "active",
    },
  ];
}

function buildHandoffCode(template: AutomationTemplate) {
  const buildBody =
    template.status === "validation_error"
      ? `{
  project_id: "${template.id}",
  board_profile: "${template.chip.toLowerCase()}",
  source_code: logic,
  // return early when validation.error exists
}`
      : `{
  project_id: "${template.id}",
  board_profile: "${template.chip.toLowerCase()}",
  source_code: logic,
}`;

  return `import { useState } from "react";

export function AutomationBuildHandoff({ logic }: { logic: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [manifestUrl, setManifestUrl] = useState<string | null>(null);

  async function queueBuild() {
    const response = await fetch("/api/v1/diy/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(${buildBody}),
    });

    const payload = await response.json();
    if (payload.error) return payload;

    setJobId(payload.job_id);
    return payload.job_id;
  }

  async function refreshBuild(nextJobId = jobId) {
    if (!nextJobId) return;

    const response = await fetch(\`/api/v1/diy/build/\${nextJobId}\`);
    const build = await response.json();

    if (build.status === "artifact_ready") {
      setManifestUrl(\`/api/v1/diy/build/\${nextJobId}/artifact\`);
    }
  }

  return manifestUrl ? (
    <esp-web-install-button manifest={manifestUrl} />
  ) : (
    <p>Wait for artifact_ready before opening ESP32-webflasher.</p>
  );
}`;
}

function EditorTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-fit border-r px-4 py-2.5 text-sm transition-colors ${
        active
          ? "border-slate-200 bg-white text-primary dark:border-navy-700 dark:bg-[#0d1117]"
          : "border-slate-200/80 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:border-navy-700 dark:text-slate-400 dark:hover:bg-navy-800 dark:hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function StepCardView({ step }: { step: StepCard }) {
  return (
    <div
      className={`rounded-2xl border p-4 backdrop-blur ${getStepToneClass(
        step.tone,
      )}`}
    >
      <p className="text-sm font-semibold">{step.title}</p>
      <p className="mt-2 text-xs leading-5 opacity-80">{step.detail}</p>
    </div>
  );
}

export default function AutomationEditor() {
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    AUTOMATION_TEMPLATES[0].id,
  );
  const [activeTab, setActiveTab] = useState<EditorTab>("logic");

  const selectedTemplate =
    AUTOMATION_TEMPLATES.find((template) => template.id === selectedTemplateId) ??
    AUTOMATION_TEMPLATES[0];
  const statusMeta = getStatusMeta(selectedTemplate.status);
  const code =
    activeTab === "logic"
      ? selectedTemplate.logicCode
      : buildHandoffCode(selectedTemplate);
  const codeLines = code.split("\n");
  const workflowCards = getWorkflowCards(selectedTemplate);

  return (
    <div className="flex min-h-screen flex-col bg-background-light text-slate-800 selection:bg-primary/30 selection:text-white dark:bg-background-dark dark:text-slate-200">
      <header className="sticky top-0 z-30 border-b border-border-light bg-panel-light/95 backdrop-blur dark:border-border-dark dark:bg-panel-dark/95">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xl font-bold tracking-tight text-primary">
              <span className="material-icons-round text-3xl">smart_toy</span>
              <span>E-Connect</span>
            </div>
            <div className="hidden h-6 w-px bg-slate-300 dark:bg-navy-700 sm:block"></div>
            <nav className="hidden gap-1 sm:flex">
              <Link
                href="/"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-primary dark:text-slate-400 dark:hover:bg-navy-700"
              >
                Dashboard
              </Link>
              <Link
                href="/automation"
                className="rounded-md border border-primary/20 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
              >
                Automation
              </Link>
              <Link
                href="/devices"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-primary dark:text-slate-400 dark:hover:bg-navy-700"
              >
                Devices
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 md:flex">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"></span>
              Build contract ready
            </div>
            <Link
              href="/devices/diy"
              className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-600"
            >
              <span className="material-icons-round text-sm">usb</span>
              Open Web Flasher
            </Link>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="w-full shrink-0 border-b border-border-light bg-panel-light dark:border-border-dark dark:bg-navy-900 lg:w-72 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-border-light px-4 py-4 dark:border-border-dark">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Starter Files
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Code samples for write, build, and flash flows
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-400 dark:border-slate-700 dark:bg-navy-950 dark:text-slate-500">
              <span className="material-icons-round text-lg">auto_awesome</span>
            </div>
          </div>

          <div className="flex gap-3 overflow-x-auto p-3 lg:flex-col lg:overflow-y-auto">
            {AUTOMATION_TEMPLATES.map((template) => {
              const templateStatus = getStatusMeta(template.status);

              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(template.id)}
                  className={`group min-w-[250px] rounded-2xl border p-4 text-left transition-all lg:min-w-0 ${
                    template.id === selectedTemplate.id
                      ? "border-primary/60 bg-blue-50/70 shadow-md dark:border-primary/50 dark:bg-navy-800"
                      : "border-slate-200 bg-white hover:border-primary/40 hover:shadow-sm dark:border-navy-700 dark:bg-navy-800/80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`rounded-xl p-2 ${template.accentClass}`}>
                        <span className="material-icons-round text-base">
                          {template.icon}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {template.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {template.chip}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${templateStatus.dotClass}`}
                      ></span>
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${templateStatus.pillClass}`}
                      >
                        {templateStatus.shortLabel}
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {template.summary}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="border-t border-border-light bg-slate-50 px-4 py-4 dark:border-border-dark dark:bg-navy-950/60">
            <div className="rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                No custom automations yet
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                This tab now previews the empty state as well: start from a starter
                file, then wire your own persistence for user-created automation
                source later.
              </p>
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col border-b border-border-light dark:border-border-dark lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-light bg-panel-light px-4 py-3 dark:border-border-dark dark:bg-panel-dark">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusMeta.pillClass}`}
                >
                  {statusMeta.label}
                </span>
                <span className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {selectedTemplate.language}
                </span>
                <span className="rounded-full border border-slate-200 px-3 py-1 font-mono text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {selectedTemplate.buildJob}
                </span>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {selectedTemplate.name}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {selectedTemplate.path}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {API_CHECKPOINTS.map((checkpoint) => (
                <span
                  key={checkpoint}
                  className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-700"
                >
                  {checkpoint}
                </span>
              ))}
            </div>
          </div>

          <div className="flex border-b border-border-light bg-slate-100/80 dark:border-border-dark dark:bg-[#151b2c]">
            <EditorTabButton
              active={activeTab === "logic"}
              label={`${selectedTemplate.name.toLowerCase().replace(/\s+/g, "_")}.cpp`}
              onClick={() => setActiveTab("logic")}
            />
            <EditorTabButton
              active={activeTab === "handoff"}
              label="webui_handoff.tsx"
              onClick={() => setActiveTab("handoff")}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-[#0d1117]">
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex w-12 shrink-0 flex-col border-r border-slate-100 bg-slate-50 py-4 pr-3 text-right font-mono text-xs text-slate-300 dark:border-navy-800 dark:bg-[#0d1117] dark:text-navy-600">
                {codeLines.map((_, index) => (
                  <span key={`line-${index + 1}`} className="leading-6">
                    {index + 1}
                  </span>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
                <pre className="font-mono text-sm leading-6 text-slate-800 dark:text-slate-300">
                  <code>
                    {codeLines.map((line, index) => (
                      <div key={`${selectedTemplate.id}-${activeTab}-${index}`}>
                        {line || " "}
                      </div>
                    ))}
                  </code>
                </pre>
              </div>
            </div>

            <div className="border-t border-border-light bg-navy-950 dark:border-border-dark">
              <div className="flex items-center justify-between border-b border-navy-800 px-4 py-2">
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-navy-500">
                  Build & Validation Output
                </span>
                <span className="text-xs text-slate-500">
                  {selectedTemplate.outcome}
                </span>
              </div>
              <div className="space-y-1 p-3 font-mono text-xs">
                {selectedTemplate.terminalLines.map((line, index) => (
                  <div key={`${selectedTemplate.id}-log-${index}`} className={getLogToneClass(line.tone)}>
                    {line.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="w-full shrink-0 bg-slate-100 dark:bg-navy-950 lg:w-[26rem]">
          <div className="flex items-center justify-between border-b border-border-light px-4 py-3 dark:border-border-dark">
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-navy-800">
              <span className="rounded-lg p-2 text-slate-500 dark:text-slate-400">
                <span className="material-icons-round text-base">polyline</span>
              </span>
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <span className="material-icons-round text-base">deployed_code</span>
              </span>
              <span className="rounded-lg p-2 text-slate-500 dark:text-slate-400">
                <span className="material-icons-round text-base">usb</span>
              </span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:bg-navy-800 dark:text-slate-400">
              Build Handoff
            </div>
          </div>

          <div className="space-y-5 p-4">
            <div
              className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-navy-950/80"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.22) 1px, transparent 0)",
                backgroundSize: "18px 18px",
              }}
            >
              <div className="hidden h-[24rem] rounded-[1.4rem] border border-white/60 bg-transparent lg:block">
                <div className="relative h-full w-full">
                  <svg
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    viewBox="0 0 400 384"
                    fill="none"
                  >
                    <path
                      d="M202 76 C 158 112, 132 144, 120 188"
                      stroke="rgba(59,130,246,0.45)"
                      strokeWidth="2.5"
                      strokeDasharray="6 6"
                    />
                    <path
                      d="M202 76 C 248 112, 276 144, 286 188"
                      stroke="rgba(59,130,246,0.45)"
                      strokeWidth="2.5"
                      strokeDasharray="6 6"
                    />
                    <path
                      d="M120 224 C 156 258, 182 274, 196 304"
                      stroke="rgba(34,197,94,0.35)"
                      strokeWidth="2.5"
                      strokeDasharray="6 6"
                    />
                    <path
                      d="M286 224 C 252 258, 224 274, 208 304"
                      stroke="rgba(34,197,94,0.35)"
                      strokeWidth="2.5"
                      strokeDasharray="6 6"
                    />
                  </svg>

                  <div className="absolute left-1/2 top-5 w-[12.75rem] -translate-x-1/2">
                    <StepCardView step={workflowCards[0]} />
                  </div>
                  <div className="absolute left-4 top-[9.6rem] w-[10.9rem]">
                    <StepCardView step={workflowCards[1]} />
                  </div>
                  <div className="absolute right-4 top-[9.6rem] w-[10.9rem]">
                    <StepCardView step={workflowCards[2]} />
                  </div>
                  <div className="absolute left-1/2 bottom-5 w-[14rem] -translate-x-1/2">
                    <StepCardView step={workflowCards[3]} />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:hidden">
                {workflowCards.map((step) => (
                  <StepCardView key={step.title} step={step} />
                ))}
              </div>
            </div>

            <div
              className={`rounded-2xl border p-4 ${statusMeta.emphasisClass}`}
            >
              <div className="flex items-start gap-3">
                <span className="material-icons-round mt-0.5 text-base">
                  {selectedTemplate.status === "artifact_ready"
                    ? "task_alt"
                    : selectedTemplate.status === "building"
                      ? "progress_activity"
                      : "warning"}
                </span>
                <div>
                  <p className="text-sm font-semibold">{selectedTemplate.outcome}</p>
                  <p className="mt-2 text-xs leading-5">{selectedTemplate.statusCopy}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-navy-900/60">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Integration checklist
              </h3>
              <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <div className="flex items-start gap-3">
                  <span className="material-icons-round text-base text-primary">
                    edit_square
                  </span>
                  <p>Persist the user-authored source in real storage before queueing builds.</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="material-icons-round text-base text-primary">
                    memory
                  </span>
                  <p>Build on the server and expose status plus logs by job id.</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="material-icons-round text-base text-primary">
                    description
                  </span>
                  <p>Publish a manifest only when the job reaches <span className="font-mono">artifact_ready</span>.</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="material-icons-round text-base text-primary">usb</span>
                  <p>Mount <span className="font-mono">&lt;esp-web-install-button /&gt;</span> only after the manifest exists.</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-navy-900/60">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Flash contract
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Reuse the same browser flasher contract as the DIY flow.
                  </p>
                </div>
                {selectedTemplate.manifestPath ? (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                    manifest ready
                  </span>
                ) : (
                  <span className="rounded-full border border-slate-200 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    manifest pending
                  </span>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-[#0d1117] p-4 font-mono text-xs leading-6 text-slate-300 dark:border-slate-800">
                <div>{'<esp-web-install-button'}</div>
                <div className="pl-4">
                  {selectedTemplate.manifestPath
                    ? `manifest="${selectedTemplate.manifestPath}"`
                    : "manifest={manifestUrl}"}
                </div>
                <div className="pl-4">{'erase-first="true"'}</div>
                <div>{'/>'}</div>
              </div>

              <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {selectedTemplate.serverCopy}
              </p>

              <Link
                href="/devices/diy"
                className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary transition hover:underline"
              >
                Open the existing DIY flash workspace
                <span className="material-icons-round text-sm">north_east</span>
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
