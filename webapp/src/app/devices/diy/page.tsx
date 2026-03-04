"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { API_URL } from "@/lib/api";
import type { PinMode } from "@/types/device";
import {
  BOARD_FAMILIES,
  BOARD_PROFILES,
  COMPONENT_TEMPLATES,
  MODE_METADATA,
  getBoardFamily,
  getBoardProfile,
  type BoardPin,
  type BoardProfile,
  type Esp32ChipFamily,
} from "@/features/diy/board-profiles";
import {
  type PinMapping,
  type FirmwareUploadState,
  type ValidationResult,
  type FlashManifest,
  MODE_ORDER,
  MODE_BADGE_STYLES,
  PIN_FILL,
  sanitizePins,
} from "@/features/diy/types";

import { Step1Board } from "@/features/diy/components/Step1Board";
import { Step2Pins } from "@/features/diy/components/Step2Pins";
import { Step3Validate } from "@/features/diy/components/Step3Validate";
import { Step4Flash } from "@/features/diy/components/Step4Flash";

const FLASHER_SCRIPT =
  "https://unpkg.com/esp-web-tools@10.1.0/dist/web/install-button.js?module";
const DRAFT_STORAGE_KEY = "econnect:diy-svg-builder:v2";
const DEFAULT_BOARD_ID = "dfrobot-beetle-esp32-c3";

export default function DIYBuilderPage() {
  const router = useRouter();
  useAuth();

  const [currentStep, setCurrentStep] = useState<number>(1);

  const [projectName, setProjectName] = useState("Living Room Relay Node");
  const [family, setFamily] = useState<Esp32ChipFamily>("ESP32-C3");
  const [boardId, setBoardId] = useState(DEFAULT_BOARD_ID);
  const [pins, setPins] = useState<PinMapping[]>([]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [flashSource, setFlashSource] = useState<"demo" | "upload">("demo");
  const [uploadState, setUploadState] = useState<FirmwareUploadState>({
    bootloader: null,
    partitions: null,
    firmware: null,
  });
  const [manifestUrl, setManifestUrl] = useState<string | null>(null);
  const [browserSupportsSerial, setBrowserSupportsSerial] = useState(false);
  const [eraseFirst, setEraseFirst] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);

  const familyOptions = useMemo(
    () => BOARD_PROFILES.filter((profile) => profile.family === family),
    [family],
  );
  const board = getBoardProfile(boardId) ?? familyOptions[0] ?? BOARD_PROFILES[0];
  const boardPins = useMemo(() => [...board.leftPins, ...board.rightPins], [board]);

  const validation = validateMappings(board, pins);
  const draftConfig = {
    project_name: projectName,
    board: board.name,
    family: board.family,
    pins: pins.map((mapping) => ({
      gpio: mapping.gpio_pin,
      mode: mapping.mode,
      function: mapping.function ?? MODE_METADATA[mapping.mode].defaultFunction,
      label: mapping.label ?? `GPIO ${mapping.gpio_pin}`,
    })),
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (document.querySelector('script[data-esp-web-tools="true"]')) {
      return;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.src = FLASHER_SCRIPT;
    script.dataset.espWebTools = "true";
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setBrowserSupportsSerial("serial" in navigator);

    const rawDraft = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!rawDraft) {
      setDraftLoaded(true);
      return;
    }

    try {
      const parsed = JSON.parse(rawDraft) as {
        projectName?: string;
        family?: Esp32ChipFamily;
        boardId?: string;
        pins?: PinMapping[];
        flashSource?: "demo" | "upload";
      };

      const nextBoard = parsed.boardId && getBoardProfile(parsed.boardId)
        ? parsed.boardId
        : DEFAULT_BOARD_ID;
      const nextProfile = getBoardProfile(nextBoard) ?? getBoardProfile(DEFAULT_BOARD_ID) ?? BOARD_PROFILES[0];

      setProjectName(parsed.projectName || "Living Room Relay Node");
      setFamily(parsed.family && getBoardFamily(parsed.family) ? parsed.family : nextProfile.family);
      setBoardId(nextProfile.id);
      setPins(Array.isArray(parsed.pins) ? sanitizePins(parsed.pins, MODE_METADATA) : []);
      setFlashSource(
        parsed.flashSource === "upload" || !nextProfile.demoFirmware ? "upload" : "demo",
      );
    } catch (error) {
      console.warn("Failed to restore DIY builder draft:", error);
    } finally {
      setDraftLoaded(true);
    }
  }, []);

  useEffect(() => {
    const nextOptions = BOARD_PROFILES.filter((profile) => profile.family === family);
    if (!nextOptions.some((profile) => profile.id === boardId)) {
      setBoardId(nextOptions[0]?.id ?? BOARD_PROFILES[0].id);
    }
  }, [family, boardId]);

  useEffect(() => {
    const validPins = new Set(boardPins.map((pin) => pin.gpio));
    setPins((previous) => previous.filter((mapping) => validPins.has(mapping.gpio_pin)));

    if (selectedPinId && !boardPins.some((pin) => pin.id === selectedPinId)) {
      setSelectedPinId(null);
    }

    if (!board.demoFirmware && flashSource === "demo") {
      setFlashSource("upload");
    }
  }, [boardId, selectedPinId, flashSource, board.demoFirmware, boardPins]);


  useEffect(() => {
    if (!draftLoaded || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        projectName,
        family,
        boardId,
        pins,
        flashSource,
      }),
    );
  }, [draftLoaded, projectName, family, boardId, pins, flashSource]);

  useEffect(() => {
    let manifestObjectUrl: string | null = null;
    const uploadObjectUrls: string[] = [];

    const manifest = buildFlashManifest({
      board,
      projectName,
      flashSource,
      uploadState,
      createFileUrl: (file) => {
        const url = URL.createObjectURL(file);
        uploadObjectUrls.push(url);
        return url;
      },
    });

    if (manifest) {
      manifestObjectUrl = URL.createObjectURL(
        new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
      );
      setManifestUrl(manifestObjectUrl);
    } else {
      setManifestUrl(null);
    }

    return () => {
      if (manifestObjectUrl) {
        URL.revokeObjectURL(manifestObjectUrl);
      }
      uploadObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [board, flashSource, projectName, uploadState]);


  const generateConfig = async () => {
    setConfigBusy(true);

    try {
      const token = window.localStorage.getItem("econnect_token");
      const response = await fetch(`${API_URL}/diy/config/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          board: board.name,
          pins,
          wifi_ssid: "",
          wifi_password: "",
          mqtt_broker: "",
        }),
      });

      const payload = (await response.json()) as { config?: object; detail?: string };

      if (!response.ok || !payload.config) {
        throw new Error(payload.detail || "Unable to generate config.");
      }

      const blob = new Blob([JSON.stringify(payload.config, null, 2)], {
        type: "application/json",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${slugify(projectName || board.name)}.config.json`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error(error);
    } finally {
      setConfigBusy(false);
    }
  };

  const resetDraft = () => {
    if (!window.confirm("Reset the current SVG builder draft?")) {
      return;
    }

    setProjectName("Living Room Relay Node");
    setFamily("ESP32-C3");
    setBoardId(DEFAULT_BOARD_ID);
    setPins([]);
    setSelectedPinId(null);
    setFlashSource("demo");
    setUploadState({
      bootloader: null,
      partitions: null,
      firmware: null,
    });
    setEraseFirst(false);
    setCurrentStep(1);
  };

  const flashLockedReason = getFlashLockedReason({
    validation,
    browserSupportsSerial,
    manifestUrl,
    flashSource,
    board,
  });

  if (!draftLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-500">Loading SVG builder...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 transition-colors dark:bg-[#0b1120] dark:text-slate-100">
      <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">build_circle</span>
              Interactive Setup
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <span className="px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-xs font-bold text-slate-500 uppercase tracking-widest hidden sm:inline-block">
              {projectName || board.name}
            </span>
            <button
              onClick={resetDraft}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              title="Restart setup"
            >
              <span className="material-symbols-outlined">restart_alt</span>
            </button>
            <button
              onClick={() => router.push("/devices")}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              title="Close setup"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {/* Progress Bar Container */}
        <div className="w-full h-1 bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full bg-primary transition-all duration-300 ease-in-out"
            style={{ width: `${(currentStep / 4) * 100}%` }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        {currentStep === 1 && (
          <Step1Board
            projectName={projectName}
            setProjectName={setProjectName}
            family={family}
            setFamily={setFamily}
            board={board}
            setBoardId={setBoardId}
            familyOptions={familyOptions}
            onNext={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 2 && (
          <Step2Pins
            board={board}
            boardPins={boardPins}
            pins={pins}
            setPins={setPins}
            selectedPinId={selectedPinId}
            setSelectedPinId={setSelectedPinId}
            projectName={projectName}
            onBack={() => setCurrentStep(1)}
            onNext={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 3 && (
          <Step3Validate
            validation={validation}
            pins={pins}
            isReady={validation.errors.length === 0}
            onBack={() => setCurrentStep(2)}
            onNext={() => setCurrentStep(4)}
          />
        )}

        {currentStep === 4 && (
          <Step4Flash
            board={board}
            projectName={projectName}
            flashSource={flashSource}
            setFlashSource={setFlashSource}
            uploadState={uploadState}
            setUploadState={setUploadState}
            eraseFirst={eraseFirst}
            setEraseFirst={setEraseFirst}
            manifestUrl={manifestUrl}
            flashLockedReason={flashLockedReason}
            configBusy={configBusy}
            draftConfig={draftConfig}
            generateConfig={generateConfig}
            pinsLength={pins.length}
            onBack={() => setCurrentStep(3)}
          />
        )}
      </main>
    </div>
  );
}


function validateMappings(board: BoardProfile, pins: PinMapping[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownPins = new Map<number, BoardPin>(
    [...board.leftPins, ...board.rightPins].map((pin) => [pin.gpio, pin]),
  );
  const usedLabels = new Map<string, number>();
  let i2cPins = 0;

  if (pins.length === 0) {
    errors.push("Map at least one GPIO before generating config or flashing firmware.");
  }

  for (const mapping of pins) {
    const boardPin = knownPins.get(mapping.gpio_pin);

    if (!boardPin) {
      errors.push(`GPIO ${mapping.gpio_pin} is not exposed by the selected board profile.`);
      continue;
    }

    if (!boardPin.capabilities.includes(mapping.mode)) {
      errors.push(`GPIO ${mapping.gpio_pin} does not support ${mapping.mode} on ${board.name}.`);
    }

    if (boardPin.inputOnly && mapping.mode !== "INPUT" && mapping.mode !== "ADC") {
      errors.push(`GPIO ${mapping.gpio_pin} is input-only and cannot drive outputs.`);
    }

    if (boardPin.reserved && mapping.mode !== "INPUT" && mapping.mode !== "ADC") {
      errors.push(
        `GPIO ${mapping.gpio_pin} is reserved or tightly coupled to boot / USB functions on ${board.name}.`,
      );
    }

    if (boardPin.bootSensitive && (mapping.mode === "OUTPUT" || mapping.mode === "PWM")) {
      warnings.push(
        `GPIO ${mapping.gpio_pin} is boot-sensitive. Confirm the connected circuit will not pull the line during reset.`,
      );
    }

    if (mapping.mode === "I2C") {
      i2cPins += 1;
    }

    const normalizedLabel = (mapping.label || "").trim().toLowerCase();
    if (normalizedLabel) {
      usedLabels.set(normalizedLabel, (usedLabels.get(normalizedLabel) ?? 0) + 1);
    }
  }

  if (i2cPins === 1) {
    errors.push("I2C needs both SDA and SCL. Map two I2C-capable pins before flashing.");
  }

  for (const [label, count] of usedLabels.entries()) {
    if (count > 1) {
      warnings.push(`The label "${label}" is used on multiple GPIOs. Rename them to avoid widget confusion.`);
    }
  }

  return { errors, warnings };
}

function buildFlashManifest({
  board,
  projectName,
  flashSource,
  uploadState,
  createFileUrl,
}: {
  board: BoardProfile;
  projectName: string;
  flashSource: "demo" | "upload";
  uploadState: FirmwareUploadState;
  createFileUrl: (file: File) => string;
}): FlashManifest | null {
  if (flashSource === "demo") {
    if (!board.demoFirmware) {
      return null;
    }

    return {
      name: `${projectName || board.name} (${board.name})`,
      version: "local-demo",
      builds: [
        {
          chipFamily: board.family,
          parts: board.demoFirmware.parts.map((part) => ({
            path: part.path,
            offset: part.offset,
          })),
        },
      ],
    };
  }

  if (!uploadState.bootloader || !uploadState.partitions || !uploadState.firmware) {
    return null;
  }

  return {
    name: `${projectName || board.name} (${board.name})`,
    version: "upload-bundle",
    builds: [
      {
        chipFamily: board.family,
        parts: [
          { path: createFileUrl(uploadState.bootloader), offset: 0 },
          { path: createFileUrl(uploadState.partitions), offset: 32768 },
          { path: createFileUrl(uploadState.firmware), offset: 65536 },
        ],
      },
    ],
  };
}

function getFlashLockedReason({
  validation,
  browserSupportsSerial,
  manifestUrl,
  flashSource,
  board,
}: {
  validation: ValidationResult;
  browserSupportsSerial: boolean;
  manifestUrl: string | null;
  flashSource: "demo" | "upload";
  board: BoardProfile;
}) {
  if (validation.errors.length > 0) {
    return "Fix the blocking GPIO validation errors before the web flasher becomes available.";
  }

  if (!browserSupportsSerial) {
    return "This browser does not expose Web Serial. Use a current Chromium-based browser for ESP Web Tools.";
  }

  if (!manifestUrl) {
    return flashSource === "demo"
      ? `No demo manifest is available for ${board.name}. Switch to "Upload build" and provide your compiled binaries.`
      : "Upload bootloader, partitions, and firmware binaries to build a flasher manifest.";
  }

  return null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
