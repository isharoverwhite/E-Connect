/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { DeviceCommandResponse, sendDeviceCommand } from "@/lib/api";
import { getActivePinConfigurations, getStatePins as readStatePins } from "@/lib/device-config";
import { DeviceConfig, DeviceStatePin, DeviceStateSnapshot, PinConfig } from "@/types/device";

export const getCardMinHeight = (config: DeviceConfig) => {
  if (config.provider) {
    return 450; // Extension Card
  }
  
  const pins = getActivePinConfigurations(config);
  if (pins.length === 0) return 130; // empty state
  
  let h = 100; // Base: Header (~80px) + bottom padding (~20px)
  let i2c = false;
  
  for (const p of pins) {
    if (p.mode === 'I2C') {
      if (!i2c) {
        h += 55;
        i2c = true;
      }
    } else if (p.extra_params?.input_type === "dht") {
      h += 92;
    } else if (p.mode === 'PWM') {
      h += 75; // PWM slider UI takes more vertical space
    } else {
      h += 55; // Standard toggle/status row
    }
  }
  return Math.ceil(h * 1.05);
};

export function DeviceToggle({
  id,
  checked,
  disabled,
  loading,
  readOnly,
  hideSyncLabel,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  loading: boolean;
  readOnly?: boolean;
  hideSyncLabel?: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const trackClass = loading
    ? "bg-sky-100 border-sky-400 dark:bg-sky-900/40 dark:border-sky-600"
    : checked
      ? (readOnly ? "bg-emerald-500 border-emerald-500/70" : "bg-primary border-primary/70")
      : (readOnly ? "bg-slate-200 border-slate-200 dark:bg-slate-700 dark:border-slate-700" : "bg-slate-300 border-slate-300 dark:bg-slate-600 dark:border-slate-600");

  const cursorClass = disabled ? "cursor-not-allowed opacity-70" : (readOnly ? "cursor-default" : "cursor-pointer");

  return (
    <div className="flex items-center gap-2">
      {!hideSyncLabel && loading ? (
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-600 dark:text-sky-300 animate-pulse">
          Syncing...
        </span>
      ) : null}
      <label
        className={`relative inline-flex h-6 w-11 items-center ${cursorClass}`}
        htmlFor={id}
      >
        <input
          checked={checked}
          className="sr-only"
          disabled={disabled || readOnly}
          id={id}
          onChange={onChange}
          type="checkbox"
          aria-busy={loading}
        />
        <span
          className={`absolute inset-0 rounded-full border transition-colors duration-300 ${
            loading ? "animate-pulse" : ""
          } ${trackClass}`}
        />
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full border border-slate-200 bg-white shadow-sm transition-all duration-300 ${
            checked ? "translate-x-5" : "translate-x-0"
          } ${loading ? "opacity-0" : ""}`}
        />
        {loading ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-600 border-t-transparent dark:border-sky-300" />
          </span>
        ) : null}
      </label>
    </div>
  );
}

export function getStatePin(state: DeviceStateSnapshot | null | undefined, gpioPin?: number | null): DeviceStatePin | null {
  if (!state) {
    return null;
  }

  if (typeof gpioPin === "number") {
    const matchedPin = readStatePins(state).find((pin) => pin.pin === gpioPin);
    if (matchedPin) {
      return matchedPin;
    }
  }

  if (typeof state.pin === "number" && (gpioPin == null || state.pin === gpioPin)) {
    return {
      pin: state.pin,
      value: state.value,
      brightness: state.brightness,
      temperature: state.temperature,
      humidity: state.humidity,
      restore_value: state.restore_value,
      restore_brightness: state.restore_brightness,
      trend: state.trend,
      unit: state.unit,
    };
  }

  if (gpioPin == null) {
    return readStatePins(state)[0] ?? null;
  }

  return null;
}

export function getNumericStateValue(value: number | boolean | undefined): number | null {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number") {
    return value;
  }
  return null;
}

const REALTIME_RANGE_COMMAND_INTERVAL_MS = 75;

function useRealtimeRangeCommand({
  deviceId,
  buildPayload,
  onLatestAccepted,
  onLatestRejected,
  intervalMs = REALTIME_RANGE_COMMAND_INTERVAL_MS,
}: {
  deviceId: string;
  buildPayload: (value: number) => Record<string, unknown>;
  onLatestAccepted: (response: DeviceCommandResponse) => void;
  onLatestRejected: () => void;
  intervalMs?: number;
}) {
  const activeRef = useRef(true);
  const latestIntentRef = useRef<{ seq: number; value: number } | null>(null);
  const queuedIntentRef = useRef<{ seq: number; value: number } | null>(null);
  const inFlightIntentsRef = useRef(new Map<number, number>());
  const lastCompletedIntentRef = useRef<{ seq: number; status: "fulfilled" | "rejected" } | null>(null);
  const nextSequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const lastDispatchAtRef = useRef(0);

  const dispatchQueuedValue = useCallback(async () => {
    if (!activeRef.current) {
      return;
    }

    const nextIntent = queuedIntentRef.current;
    if (nextIntent === null) {
      return;
    }

    queuedIntentRef.current = null;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    lastDispatchAtRef.current = Date.now();
    inFlightIntentsRef.current.set(nextIntent.seq, nextIntent.value);

    try {
      const response = await sendDeviceCommand(deviceId, buildPayload(nextIntent.value));
      lastCompletedIntentRef.current = {
        seq: nextIntent.seq,
        status: response.status === "failed" ? "rejected" : "fulfilled",
      };
      if (!activeRef.current) {
        return;
      }

      const isLatestIntent = latestIntentRef.current?.seq === nextIntent.seq && queuedIntentRef.current === null;
      if (response.status === "failed") {
        if (isLatestIntent) {
          onLatestRejected();
        }
      } else if (isLatestIntent) {
        onLatestAccepted(response);
      }
    } catch {
      lastCompletedIntentRef.current = { seq: nextIntent.seq, status: "rejected" };
      if (activeRef.current && latestIntentRef.current?.seq === nextIntent.seq && queuedIntentRef.current === null) {
        onLatestRejected();
      }
    } finally {
      inFlightIntentsRef.current.delete(nextIntent.seq);

      if (!activeRef.current || queuedIntentRef.current === null) {
        return;
      }

      const elapsed = Date.now() - lastDispatchAtRef.current;
      const delay = Math.max(0, intervalMs - elapsed);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void dispatchQueuedValue();
      }, delay);
    }
  }, [buildPayload, deviceId, intervalMs, onLatestAccepted, onLatestRejected]);

  const queueValue = useCallback((value: number, options?: { immediate?: boolean }) => {
    if (!activeRef.current) {
      return;
    }

    const queuedIntent = queuedIntentRef.current;
    if (queuedIntent?.value === value) {
      if (options?.immediate && timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          void dispatchQueuedValue();
        }, 0);
      }
      return;
    }

    const latestIntent = latestIntentRef.current;
    const latestIntentInFlight = latestIntent !== null && inFlightIntentsRef.current.has(latestIntent.seq);
    if (latestIntent?.value === value && latestIntentInFlight && queuedIntent === null) {
      return;
    }

    const latestIntentCompletedSuccessfully =
      latestIntent?.value === value &&
      queuedIntent === null &&
      !latestIntentInFlight &&
      lastCompletedIntentRef.current?.seq === latestIntent.seq &&
      lastCompletedIntentRef.current.status === "fulfilled";
    if (latestIntentCompletedSuccessfully) {
      return;
    }

    const nextIntent = { seq: nextSequenceRef.current + 1, value };
    nextSequenceRef.current = nextIntent.seq;
    latestIntentRef.current = nextIntent;
    queuedIntentRef.current = nextIntent;

    if (timerRef.current !== null) {
      if (!options?.immediate) {
        return;
      }
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const elapsed = Date.now() - lastDispatchAtRef.current;
    const delay = options?.immediate ? 0 : Math.max(0, intervalMs - elapsed);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void dispatchQueuedValue();
    }, delay);
  }, [dispatchQueuedValue, intervalMs]);

  useEffect(() => {
    activeRef.current = true;
    const inFlightIntents = inFlightIntentsRef.current;
    return () => {
      activeRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      latestIntentRef.current = null;
      queuedIntentRef.current = null;
      inFlightIntents.clear();
      lastCompletedIntentRef.current = null;
    };
  }, []);

  return { queueValue };
}

function formatClimateReading(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }
  return value.toFixed(1);
}

function getDhtTemperatureValue(pinState: DeviceStatePin | null): number | null {
  if (typeof pinState?.temperature === "number") {
    return pinState.temperature;
  }

  const legacyValue = getNumericStateValue(pinState?.value);
  if (legacyValue === null) {
    return null;
  }

  return legacyValue / 10;
}

function getDhtHumidityValue(pinState: DeviceStatePin | null): number | null {
  if (typeof pinState?.humidity === "number") {
    return pinState.humidity;
  }

  return null;
}

export function getBinaryState(state: DeviceStateSnapshot | null | undefined, gpioPin?: number | null): boolean {
  const pinState = getStatePin(state, gpioPin);
  const numericValue = getNumericStateValue(pinState?.value);
  if (numericValue !== null) {
    return numericValue !== 0;
  }
  if (typeof pinState?.brightness === "number") {
    return pinState.brightness > 0;
  }
  return false;
}

export function getBrightnessState(
  state: DeviceStateSnapshot | null | undefined,
  gpioPin: number | null | undefined,
  fallback: number,
): number {
  const pinState = getStatePin(state, gpioPin);
  const numericValue = getNumericStateValue(pinState?.value);
  const restoreBrightness =
    typeof pinState?.restore_brightness === "number"
      ? pinState.restore_brightness
      : getNumericStateValue(pinState?.restore_value);

  if (numericValue === 0 && restoreBrightness !== null) {
    return restoreBrightness;
  }
  if (typeof pinState?.brightness === "number") {
    return pinState.brightness;
  }
  if (numericValue !== null) {
    return numericValue;
  }
  if (restoreBrightness !== null) {
    return restoreBrightness;
  }
  return fallback;
}

function isConfirmedStateSnapshot(state: DeviceStateSnapshot | null | undefined): boolean {
  if (!state) {
    return false;
  }
  if (state.predicted === true) {
    return false;
  }
  return state.kind !== "action";
}

export function PinControlItem({ config, pin, isOnline }: { config: DeviceConfig, pin: PinConfig, isOnline: boolean }) {
  const [requestPending, setRequestPending] = useState(false);
  const [pendingCmdId, setPendingCmdId] = useState<string | null>(null);
  const [optimisticToggleState, setOptimisticToggleState] = useState<boolean | null>(null);
  const [optimisticSliderValue, setOptimisticSliderValue] = useState<number | null>(null);

  const deliveryForPendingCommand = Boolean(
    config.last_delivery && pendingCmdId && config.last_delivery.command_id === pendingCmdId
  );
  const acknowledgedPendingCommand =
    deliveryForPendingCommand && config.last_delivery?.status === "acknowledged";
  const failedPendingCommand =
    deliveryForPendingCommand && config.last_delivery?.status === "failed";

  const pwmMin = pin.extra_params?.min_value ?? 0;
  const pwmMax = pin.extra_params?.max_value ?? 255;
  const pwmRangeMin = Math.min(pwmMin, pwmMax);
  const pwmRangeMax = Math.max(pwmMin, pwmMax);
  const pwmOffValue = pwmMin > pwmMax ? pwmMin : 0;
  const pwmSliderStyle = pwmMin > pwmMax ? { direction: "rtl" as const } : undefined;
  const hasConfirmedState = isConfirmedStateSnapshot(config.last_state);

  const pinState = getStatePin(config.last_state, pin.mode === 'I2C' ? null : pin.gpio_pin);
  const baselineToggleState = getBinaryState(config.last_state, pin.gpio_pin);
  const baselineSliderValue = getBrightnessState(config.last_state, pin.gpio_pin, pwmMin);

  const toggleTargetMatched =
    optimisticToggleState !== null && hasConfirmedState && baselineToggleState === optimisticToggleState;
  const sliderTargetMatched =
    optimisticSliderValue !== null && hasConfirmedState && baselineSliderValue === optimisticSliderValue;
  const commandStateSynced =
    (optimisticToggleState === null || toggleTargetMatched) &&
    (optimisticSliderValue === null || sliderTargetMatched);

  const commandPending = pendingCmdId !== null && !deliveryForPendingCommand && !commandStateSynced;
  const toggleDisabled = requestPending || commandPending || !isOnline;
  const sliderDisabled = requestPending || !isOnline;
  const toggleLoading =
    optimisticToggleState !== null &&
    !toggleTargetMatched &&
    !acknowledgedPendingCommand &&
    !failedPendingCommand;
  const sliderLoading =
    optimisticSliderValue !== null &&
    !sliderTargetMatched &&
    !acknowledgedPendingCommand &&
    !failedPendingCommand;

  const toggleState = optimisticToggleState !== null ? optimisticToggleState : baselineToggleState;
  const sliderValue = optimisticSliderValue !== null ? optimisticSliderValue : baselineSliderValue;

  useEffect(() => {
    if ((optimisticToggleState !== null || optimisticSliderValue !== null) && commandStateSynced) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setPendingCmdId(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [commandStateSynced, optimisticToggleState, optimisticSliderValue]);

  useEffect(() => {
    if (deliveryForPendingCommand || failedPendingCommand) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setPendingCmdId(null);
      }, failedPendingCommand ? 0 : 2000);
      return () => window.clearTimeout(timer);
    }
  }, [deliveryForPendingCommand, failedPendingCommand]);

  useEffect(() => {
    if (pendingCmdId !== null) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setPendingCmdId(null);
      }, 3000);
      return () => window.clearTimeout(timer);
    }
  }, [pendingCmdId]);

  const applyPersistedState = (state: DeviceStateSnapshot | null | undefined) => {
    if (!state) {
      setOptimisticToggleState(null);
      setOptimisticSliderValue(null);
      return;
    }

    setOptimisticToggleState(getBinaryState(state, pin.gpio_pin));
    if (pin.mode === "PWM") {
      setOptimisticSliderValue(getBrightnessState(state, pin.gpio_pin, pwmMin));
    } else {
      setOptimisticSliderValue(null);
    }
  };

  const { queueValue: queueRealtimeSliderValue } = useRealtimeRangeCommand({
    deviceId: config.device_id,
    buildPayload: (rawValue) => ({ kind: "action", pin: pin.gpio_pin, brightness: rawValue }),
    onLatestAccepted: (response) => {
      setPendingCmdId(response.command_id || null);
    },
    onLatestRejected: () => {
      setOptimisticToggleState(null);
      setOptimisticSliderValue(null);
      setPendingCmdId(null);
    },
  });

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(isChecked);

    try {
      const payload: { kind: string; pin: number; value: number; brightness?: number } = { kind: "action", pin: pin.gpio_pin, value: isChecked ? 1 : 0 };
      if (pin.mode === "PWM" && isChecked) {
        payload.brightness = sliderValue === pwmOffValue ? pwmMax : sliderValue;
      }
      const response = await sendDeviceCommand(config.device_id, payload);
      setRequestPending(false);
      if (response && response.status === "failed") {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
      } else {
        applyPersistedState(response.last_state);
        setPendingCmdId(response?.command_id || null);
      }
    } catch {
      setRequestPending(false);
      setOptimisticToggleState(null);
      setOptimisticSliderValue(null);
    }
  };

  const scheduleSliderValue = (rawValue: number, immediate = false) => {
    setPendingCmdId(null);
    setOptimisticToggleState(rawValue !== pwmOffValue);
    setOptimisticSliderValue(rawValue);
    queueRealtimeSliderValue(rawValue, immediate ? { immediate: true } : undefined);
  };

  const label = pin.function || pin.label || `${pin.mode} Pin ${pin.gpio_pin}`;

  if (pin.mode === 'OUTPUT') {
    return (
      <div className="flex justify-between items-center py-3 border-t border-slate-100 dark:border-slate-800/50">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <DeviceToggle
          checked={toggleState}
          disabled={toggleDisabled}
          id={`pin-${config.device_id}-${pin.gpio_pin}`}
          loading={toggleLoading}
          onChange={handleToggle}
        />
      </div>
    );
  }

  if (pin.mode === 'PWM') {
    return (
      <div className="py-3 border-t border-slate-100 dark:border-slate-800/50">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
          <div className="flex items-center gap-3">
             {sliderLoading ? (
               <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-600 dark:text-sky-300 animate-pulse">
                 Syncing...
               </span>
             ) : (
               <span className="text-xs font-bold text-primary">
                 {sliderValue}
               </span>
             )}
             <DeviceToggle
                checked={toggleState}
                disabled={toggleDisabled}
                id={`pin-toggle-${config.device_id}-${pin.gpio_pin}`}
                loading={toggleLoading || sliderLoading}
                hideSyncLabel={true}
                onChange={handleToggle}
             />
          </div>
        </div>
        <input
          type="range"
          className={`w-full h-2 rounded-lg appearance-none cursor-pointer outline-none transition-colors
            ${(toggleState && isOnline) ? 'bg-primary/20 dark:bg-primary/30' : 'bg-slate-200 dark:bg-slate-700'}
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-colors
            ${(toggleState && isOnline) ? '[&::-webkit-slider-thumb]:bg-primary' : '[&::-webkit-slider-thumb]:bg-slate-400 dark:[&::-webkit-slider-thumb]:bg-slate-500'}
            [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-colors
            ${(toggleState && isOnline) ? '[&::-moz-range-thumb]:bg-primary' : '[&::-moz-range-thumb]:bg-slate-400 dark:[&::-moz-range-thumb]:bg-slate-500'}
          `}
          min={pwmRangeMin}
          max={pwmRangeMax}
          value={sliderValue}
          disabled={sliderDisabled}
          style={pwmSliderStyle}
          onChange={(e) => scheduleSliderValue(parseInt(e.target.value, 10))}
          onMouseUp={(e) => scheduleSliderValue(parseInt(e.currentTarget.value, 10), true)}
          onTouchEnd={(e) => scheduleSliderValue(parseInt(e.currentTarget.value, 10), true)}
        />
      </div>
    );
  }

  if (pin.mode === 'ADC' || pin.mode === 'INPUT') {
    const inputType = pin.extra_params?.input_type;
    const isDht = inputType === "dht";
    const isSwitch = inputType === "switch";
    const isTach = inputType === "tachometer";
    const numValue = getNumericStateValue(pinState?.value);
    
    const displayValue: React.ReactNode = numValue ?? '--';
    let unit = pinState?.unit;

    if (isSwitch) {
      return (
        <div className="flex justify-between items-center py-3 border-t border-slate-100 dark:border-slate-800/50">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
          <DeviceToggle
            id={`input-switch-${config.device_id}-${pin.gpio_pin}`}
            checked={numValue === 1}
            disabled={!isOnline}
            loading={false}
            readOnly={true}
            onChange={() => {}}
          />
        </div>
      );
    }
    
    if (isTach) {
      unit = unit || "RPM";
    }

    if (isDht) {
      const temperature = getDhtTemperatureValue(pinState);
      const humidity = getDhtHumidityValue(pinState);

      return (
        <div className="py-3 border-t border-slate-100 dark:border-slate-800/50">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Temperature</span>
            <div className="flex items-baseline space-x-1">
              <span className="text-lg font-bold text-slate-800 dark:text-white">
                {formatClimateReading(temperature)}
              </span>
              <span className="text-xs font-medium text-slate-500">°C</span>
            </div>
          </div>
          <div className="mt-3 flex justify-between items-center border-t border-slate-100 pt-3 dark:border-slate-800/50">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Humidity</span>
            <div className="flex items-baseline space-x-1">
              <span className="text-lg font-bold text-slate-800 dark:text-white">
                {formatClimateReading(humidity)}
              </span>
              <span className="text-xs font-medium text-slate-500">%</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-between items-center py-3 border-t border-slate-100 dark:border-slate-800/50">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <div className="flex items-baseline space-x-1">
          <span className="text-lg font-bold text-slate-800 dark:text-white">
            {displayValue}
          </span>
          {unit && <span className="text-xs font-medium text-slate-500 ml-1">{unit}</span>}
        </div>
      </div>
    );
  }

  if (pin.mode === 'I2C') {
    return (
      <div className="py-3 border-t border-slate-100 dark:border-slate-800/50">
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
            <span className="text-[10px] text-slate-400">I2C &middot; {pin.extra_params?.i2c_address || 'Auto'}</span>
          </div>
          <div className="flex items-baseline space-x-1">
            <span className="text-lg font-bold text-slate-800 dark:text-white">
              {getNumericStateValue(pinState?.value) ?? '--'}
            </span>
            {pinState?.unit && <span className="text-xs font-medium text-slate-500">{pinState.unit}</span>}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// Helper functions for Color Conversion
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const l = Math.max(r, g, b);
  const s = l - Math.min(r, g, b);
  const h = s
    ? l === r
      ? (g - b) / s
      : l === g
      ? 2 + (b - r) / s
      : 4 + (r - g) / s
    : 0;
  return [
    Math.round(60 * h < 0 ? 60 * h + 360 : 60 * h),
    Math.round(100 * (s ? (l <= 0.5 ? s / (2 * l - s) : s / (2 - (2 * l - s))) : 0)),
    Math.round((100 * (2 * l - s)) / 2),
  ];
}

function ColorWheel({ rgb, onChange, disabled }: { rgb: [number, number, number], onChange: (rgb: [number, number, number]) => void, disabled: boolean }) {
  const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  
  const handleColorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const radius = Math.min(rect.width, rect.height) / 2;
    const distance = Math.sqrt(x * x + y * y);
    if (distance <= radius) {
      let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
      if (angle < 0) angle += 360;
      const saturation = Math.min(100, Math.round((distance / radius) * 100));
      onChange(hslToRgb(angle, saturation, 50)); // lock lightness at 50%
    }
  };

  return (
    <div className={`relative w-40 h-40 rounded-full mx-auto cursor-crosshair transform transition-all shadow-inner ${disabled ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:scale-[1.02]'}`}
         style={{ background: 'conic-gradient(from 90deg, red, yellow, lime, aqua, blue, magenta, red)' }}
         onClick={handleColorClick}>
       {/* Saturation Overlays */}
       <div className="absolute inset-0 rounded-full bg-slate-100 dark:bg-slate-900 mix-blend-screen opacity-10 pointer-events-none"></div>
       <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,1)_0%,rgba(255,255,255,0)_100%)] pointer-events-none"></div>

      {/* Thumb Indicator */}
      <div className="absolute w-5 h-5 rounded-full border-2 border-white shadow-md transform -translate-x-1/2 -translate-y-1/2 transition-all duration-200"
           style={{
             backgroundColor: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
             left: `calc(50% + ${Math.sin(h * (Math.PI / 180)) * (s / 100) * 50}%)`,
             top: `calc(50% - ${Math.cos(h * (Math.PI / 180)) * (s / 100) * 50}%)`
           }}>
      </div>
    </div>
  );
}

function getExtensionSchemaDisplay(config: DeviceConfig): Record<string, unknown> | null {
  if (!config.schema_snapshot || typeof config.schema_snapshot !== "object" || Array.isArray(config.schema_snapshot)) {
    return null;
  }

  const rawDisplay = (config.schema_snapshot as Record<string, unknown>).display;
  if (!rawDisplay || typeof rawDisplay !== "object" || Array.isArray(rawDisplay)) {
    return null;
  }

  return rawDisplay as Record<string, unknown>;
}

function getExtensionSchemaCapabilities(config: DeviceConfig): string[] {
  const display = getExtensionSchemaDisplay(config);
  if (!display || !Array.isArray(display.capabilities)) {
    return [];
  }

  return display.capabilities.filter((capability): capability is string => typeof capability === "string");
}

function getExtensionSchemaTemperatureRange(config: DeviceConfig): { min: number; max: number } | null {
  const display = getExtensionSchemaDisplay(config);
  const rawRange = display?.temperature_range;
  if (!rawRange || typeof rawRange !== "object" || Array.isArray(rawRange)) {
    return null;
  }

  const min = (rawRange as Record<string, unknown>).min;
  const max = (rawRange as Record<string, unknown>).max;
  if (typeof min !== "number" || typeof max !== "number" || min >= max) {
    return null;
  }

  return { min, max };
}

function getRuntimeStateCapabilities(config: DeviceConfig): string[] {
  const runtimeCaps = Array.isArray(config.last_state?.capabilities)
    ? config.last_state.capabilities.filter((capability): capability is string => typeof capability === "string")
    : [];

  const normalized = new Set(runtimeCaps.map((capability) => capability.trim().toLowerCase()).filter(Boolean));
  if (config.last_state?.rgb) {
    normalized.add("rgb");
  }
  if (typeof config.last_state?.color_temperature === "number") {
    normalized.add("color_temperature");
  }

  return Array.from(normalized);
}

function getExtensionCompatibilityCapabilities(config: DeviceConfig): string[] {
  const provider = config.provider?.trim().toLowerCase();
  if (provider !== "yeelight") {
    return [];
  }

  switch (config.device_schema_id) {
    case "yeelight_ambient_light":
      return ["power", "brightness", "color_temperature"];
    case "yeelight_color_light":
    case "yeelight_full_spectrum_light":
      return ["power", "brightness", "rgb", "color_temperature"];
    case "yeelight_white_light":
      return ["power", "brightness"];
    default:
      return [];
  }
}

function getEffectiveExtensionCapabilities(config: DeviceConfig): string[] {
  const runtimeCaps = getRuntimeStateCapabilities(config);
  const schemaCaps = getExtensionSchemaCapabilities(config);
  const compatibilityCaps = getExtensionCompatibilityCapabilities(config);
  const preferred = runtimeCaps.length > 0 ? runtimeCaps : schemaCaps;
  return Array.from(new Set([...preferred, ...compatibilityCaps]));
}

type ExtensionAdvancedMode = "color" | "temperature";

function getPreferredExtensionAdvancedMode(config: DeviceConfig): ExtensionAdvancedMode {
  const effectiveCaps = getEffectiveExtensionCapabilities(config);
  const supportsRgb = effectiveCaps.includes("rgb");
  const supportsTone = effectiveCaps.includes("color_temperature");

  if (supportsRgb && !supportsTone) {
    return "color";
  }
  if (!supportsRgb && supportsTone) {
    return "temperature";
  }

  const colorMode = typeof config.last_state?.color_mode === "number" ? config.last_state.color_mode : null;
  if (colorMode === 1 || colorMode === 3) {
    return "color";
  }
  return "temperature";
}

export function ExtensionCard({ config, isOnline }: { config: DeviceConfig, isOnline: boolean }) {
  const [requestPending, setRequestPending] = useState(false);
  const [pendingCmdId, setPendingCmdId] = useState<string | null>(null);
  const [optimisticToggleState, setOptimisticToggleState] = useState<boolean | null>(null);
  const [optimisticSliderValue, setOptimisticSliderValue] = useState<number | null>(null);
  const [optimisticRgb, setOptimisticRgb] = useState<[number, number, number] | null>(null);
  const [optimisticTone, setOptimisticTone] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [advancedModeOverride, setAdvancedModeOverride] = useState<ExtensionAdvancedMode | null>(null);

  const deliveryForPendingCommand = Boolean(
    config.last_delivery && pendingCmdId && config.last_delivery.command_id === pendingCmdId
  );
  const failedPendingCommand =
    deliveryForPendingCommand && config.last_delivery?.status === "failed";

  const baselineToggleState = getBinaryState(config.last_state);
  const baselineSliderValue = getBrightnessState(config.last_state, null, 0);
  
  // Extract RGB from state
  const rgbStateObj = config.last_state?.rgb;
  const baselineRgb: [number, number, number] = rgbStateObj 
    ? [rgbStateObj.r, rgbStateObj.g, rgbStateObj.b] 
    : [255, 255, 255]; // fallback logic
  const baselineTone = typeof config.last_state?.color_temperature === 'number' ? config.last_state.color_temperature : 4000;

  const toggleTargetMatched =
    optimisticToggleState !== null && baselineToggleState === optimisticToggleState;
  const sliderTargetMatched =
    optimisticSliderValue !== null && baselineSliderValue === optimisticSliderValue;
  const rgbTargetMatched =
    optimisticRgb !== null && baselineRgb[0] === optimisticRgb[0] && baselineRgb[1] === optimisticRgb[1] && baselineRgb[2] === optimisticRgb[2];
  const toneTargetMatched = 
    optimisticTone !== null && baselineTone === optimisticTone;

  const commandStateSynced =
    (optimisticToggleState === null || toggleTargetMatched) &&
    (optimisticSliderValue === null || sliderTargetMatched) &&
    (optimisticRgb === null || rgbTargetMatched) &&
    (optimisticTone === null || toneTargetMatched);

  const controlReady = isOnline || Boolean(config.is_external);
  const commandPending = pendingCmdId !== null && !deliveryForPendingCommand && !commandStateSynced;
  const toggleDisabled = requestPending || commandPending || !controlReady;
  const valueControlDisabled = requestPending || !controlReady;
  const toggleLoading = optimisticToggleState !== null && !toggleTargetMatched && !failedPendingCommand;
  const sliderLoading = optimisticSliderValue !== null && !sliderTargetMatched && !failedPendingCommand;
  const rgbLoading = optimisticRgb !== null && !rgbTargetMatched && !failedPendingCommand;
  const toneLoading = optimisticTone !== null && !toneTargetMatched && !failedPendingCommand;

  const toggleState = optimisticToggleState !== null ? optimisticToggleState : baselineToggleState;
  const sliderValue = optimisticSliderValue !== null ? optimisticSliderValue : baselineSliderValue;
  const rgbValue = optimisticRgb !== null ? optimisticRgb : baselineRgb;
  const toneValue = optimisticTone !== null ? optimisticTone : baselineTone;
  const effectiveCaps = getEffectiveExtensionCapabilities(config);
  const temperatureRange = getExtensionSchemaTemperatureRange(config);
  const supportsRgb = effectiveCaps.includes("rgb");
  const supportsTone = effectiveCaps.includes("color_temperature");
  const hasAdvanced = supportsRgb || supportsTone;
  const preferredAdvancedMode = getPreferredExtensionAdvancedMode(config);
  const statusLabel = isOnline ? "Online" : "Offline";
  const visibleAdvancedMode: ExtensionAdvancedMode = supportsRgb && !supportsTone
    ? "color"
    : !supportsRgb && supportsTone
      ? "temperature"
      : advancedModeOverride ?? preferredAdvancedMode;

  useEffect(() => {
    if ((optimisticToggleState !== null || optimisticSliderValue !== null || optimisticRgb !== null || optimisticTone !== null) && commandStateSynced) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setOptimisticRgb(null);
        setOptimisticTone(null);
        setPendingCmdId(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [commandStateSynced, optimisticToggleState, optimisticSliderValue, optimisticRgb, optimisticTone]);

  useEffect(() => {
    if (deliveryForPendingCommand || failedPendingCommand) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setOptimisticRgb(null);
        setOptimisticTone(null);
        setPendingCmdId(null);
      }, failedPendingCommand ? 0 : 500);
      return () => window.clearTimeout(timer);
    }
  }, [deliveryForPendingCommand, failedPendingCommand]);

  useEffect(() => {
    if (pendingCmdId !== null) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setOptimisticRgb(null);
        setOptimisticTone(null);
        setPendingCmdId(null);
      }, 3000);
      return () => window.clearTimeout(timer);
    }
  }, [pendingCmdId]);

  const { queueValue: queueRealtimeBrightnessValue } = useRealtimeRangeCommand({
    deviceId: config.device_id,
    buildPayload: (rawValue) => ({ kind: "action", pin: 0, brightness: Math.round(rawValue) }),
    onLatestAccepted: (response) => {
      setPendingCmdId(response.command_id || null);
    },
    onLatestRejected: () => {
      setOptimisticToggleState(null);
      setOptimisticSliderValue(null);
      setPendingCmdId(null);
    },
  });

  const { queueValue: queueRealtimeToneValue } = useRealtimeRangeCommand({
    deviceId: config.device_id,
    buildPayload: (rawValue) => ({ kind: "action", pin: 0, color_temperature: Math.round(rawValue) }),
    onLatestAccepted: (response) => {
      setPendingCmdId(response.command_id || null);
    },
    onLatestRejected: () => {
      setOptimisticTone(null);
      setPendingCmdId(null);
    },
  });

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(isChecked);
    setOptimisticSliderValue(!isChecked ? 0 : null);
    try {
      const payload = { kind: "action", pin: 0, value: isChecked ? 1 : 0 };
      const response = await sendDeviceCommand(config.device_id, payload);
      setRequestPending(false);
      if (response && response.status === "failed") {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
      } else {
        setPendingCmdId(response?.command_id || null);
      }
    } catch {
      setRequestPending(false);
      setOptimisticToggleState(null);
      setOptimisticSliderValue(null);
    }
  };

  const scheduleBrightnessValue = (rawValue: number, immediate = false) => {
    setPendingCmdId(null);
    setOptimisticToggleState(rawValue > 0);
    setOptimisticSliderValue(rawValue);
    queueRealtimeBrightnessValue(rawValue, immediate ? { immediate: true } : undefined);
  };
  
  const handleRgbCommit = async (rgb: [number, number, number]) => {
    setRequestPending(true);
    setPendingCmdId(null);
    setAdvancedModeOverride("color");
    setOptimisticRgb(rgb);
    try {
      const payload = { kind: "action", pin: 0, rgb: {r: rgb[0], g: rgb[1], b: rgb[2]} };
      const response = await sendDeviceCommand(config.device_id, payload);
      setRequestPending(false);
      if (response && response.status === "failed") {
        setOptimisticRgb(null);
      } else {
        setPendingCmdId(response?.command_id || null);
      }
    } catch {
      setRequestPending(false);
      setOptimisticRgb(null);
    }
  };

  const scheduleToneValue = (tone: number, immediate = false) => {
    setPendingCmdId(null);
    setAdvancedModeOverride("temperature");
    setOptimisticTone(tone);
    queueRealtimeToneValue(tone, immediate ? { immediate: true } : undefined);
  };

  return (
    <div className={`bg-surface-light dark:bg-surface-dark rounded-xl border border-indigo-100 dark:border-indigo-900/50 p-5 shadow-sm hover:shadow-md transition-all relative w-full flex flex-col ${isExpanded ? 'h-auto z-10' : 'h-full'}`}>
      <div className="absolute top-2 right-2">
         {/* Removed the 'EXT' text which was overlapping, kept a subtle extension icon */}
         <div className="text-indigo-400 dark:text-indigo-600/50 p-1 flex items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-900/20" title="Extension integration">
            <span className="material-icons-round text-[16px]">extension</span>
         </div>
      </div>
      
      {/* Header and Toggle */}
      <div className="flex justify-between items-start mb-2 mt-1">
        <div className="h-10 w-10 flex-shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
          <span className="material-icons-round">wb_incandescent</span>
        </div>
        <div className="flex flex-col items-end pr-8"> 
           {/* offset toggle to not overlap with the icon */}
          <DeviceToggle
            checked={toggleState}
            disabled={toggleDisabled}
            id={`ext-${config.device_id}`}
            loading={toggleLoading || sliderLoading || rgbLoading || toneLoading}
            onChange={handleToggle}
          />
        </div>
      </div>
      
      {/* Name and Room */}
      <div className="flex justify-between items-start mb-5">
        <div className="flex-1 min-w-0 pr-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
          <p className="text-xs text-slate-500 truncate" title={config.room_name || 'Chưa gán phòng'}>{config.room_name || 'Chưa gán phòng'}</p>
        </div>
        <span className="flex items-center text-xs text-slate-500 flex-shrink-0 mt-0.5">
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'} mr-1`}></span>
          {statusLabel}
        </span>
      </div>
      
      {/* Brightness Slider */}
      <div className="mb-4">
        <div className="flex justify-between items-end mb-2">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            Brightness
          </label>
          {sliderLoading ? (
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-600 dark:text-sky-300 animate-pulse">
              Syncing...
            </span>
          ) : (
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
              {sliderValue}
            </span>
          )}
        </div>
        <input
          type="range"
          className={`w-full h-2 rounded-lg appearance-none cursor-pointer outline-none transition-colors
            ${(toggleState && controlReady) ? 'bg-primary/20 dark:bg-primary/30' : 'bg-slate-200 dark:bg-slate-700'}
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-colors
            ${(toggleState && controlReady) ? '[&::-webkit-slider-thumb]:bg-primary' : '[&::-webkit-slider-thumb]:bg-slate-400 dark:[&::-webkit-slider-thumb]:bg-slate-500'}
            [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-colors
            ${(toggleState && controlReady) ? '[&::-moz-range-thumb]:bg-primary' : '[&::-moz-range-thumb]:bg-slate-400 dark:[&::-moz-range-thumb]:bg-slate-500'}
          `}
          min={0}
          max={255}
          value={sliderValue}
          disabled={valueControlDisabled}
          onChange={(e) => scheduleBrightnessValue(parseInt(e.target.value, 10))}
          onMouseUp={(e) => scheduleBrightnessValue(parseInt(e.currentTarget.value, 10), true)}
          onTouchEnd={(e) => scheduleBrightnessValue(parseInt(e.currentTarget.value, 10), true)}
        />
      </div>

      {hasAdvanced && (
          <div className="mt-auto flex justify-center pb-2">
              <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                disabled={!controlReady}
              >
                  <span className="material-icons-round text-[14px]">tune</span>
                  {isExpanded ? 'Show Less' : 'Tune'}
              </button>
          </div>
      )}

      {/* Expanded Advanced Controls */}
      <div className={`grid transition-all duration-300 ease-in-out ${isExpanded && hasAdvanced ? 'grid-rows-[1fr] opacity-100 mt-4' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="flex flex-col gap-6 pt-4 border-t border-slate-100 dark:border-slate-800">
            {supportsRgb && supportsTone ? (
              <div className="flex justify-center">
                <div className="inline-flex items-center rounded-full bg-slate-100 p-1 text-xs font-medium dark:bg-slate-800">
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1.5 transition-colors ${visibleAdvancedMode === "color" ? "bg-indigo-500 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"}`}
                    onClick={() => setAdvancedModeOverride("color")}
                    disabled={valueControlDisabled}
                  >
                    Color
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1.5 transition-colors ${visibleAdvancedMode === "temperature" ? "bg-amber-500 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"}`}
                    onClick={() => setAdvancedModeOverride("temperature")}
                    disabled={valueControlDisabled}
                  >
                    White
                  </button>
                </div>
              </div>
            ) : null}
            
            {/* RGB Color Wheel */}
            {supportsRgb && visibleAdvancedMode === "color" && (
              <div className="flex flex-col items-center">
                <div className="flex justify-between items-center w-full mb-3">
                   <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Color</label>
                </div>
                <ColorWheel 
                    rgb={rgbValue} 
                    onChange={handleRgbCommit} 
                    disabled={valueControlDisabled} 
                />
              </div>
            )}

            {/* Color Temperature (Tone) */}
            {supportsTone && visibleAdvancedMode === "temperature" && (
              <div className="mb-2 pb-2">
                  <div className="flex justify-between items-end mb-2">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      Light Temperature
                  </label>
                  {toneLoading ? (
                    <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-600 dark:text-sky-300 animate-pulse">
                      Syncing...
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                        {toneValue}K
                    </span>
                  )}
                  </div>
                  <input
                  type="range"
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-slate-200 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-slate-200"
                  style={{
                      background: 'linear-gradient(to right, #ff8c00, #ffddaa, #eef2ff, #aaccff)'
                  }}
                  min={temperatureRange?.min ?? 1700}
                  max={temperatureRange?.max ?? 6500}
                  step={50}
                  value={toneValue}
                  disabled={valueControlDisabled}
                  onChange={(e) => scheduleToneValue(parseInt(e.target.value, 10))}
                  onMouseUp={(e) => scheduleToneValue(parseInt(e.currentTarget.value, 10), true)}
                  onTouchEnd={(e) => scheduleToneValue(parseInt(e.currentTarget.value, 10), true)}
                  />
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Footer Info */}
      <div className={`flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 ${isExpanded ? 'mt-4 pt-4' : 'mt-auto pt-3'} border-t border-slate-100 dark:border-slate-800`}>
        <span className="flex items-center text-indigo-600 dark:text-indigo-400 font-medium">Source: {config.provider}</span>
      </div>
    </div>
  );
}

export const DynamicDeviceCard = memo(function DynamicDeviceCard({ config, isOnline }: { config: DeviceConfig, isOnline: boolean }) {
  if (config.provider) {
    return <ExtensionCard config={config} isOnline={isOnline} />;
  }

  if (config.mode === 'portableDashboard') {
    return (
      <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-y-auto w-full h-full flex flex-col pointer-events-auto">
        <div className="absolute top-0 right-0">
          <div className="bg-blue-500 text-white text-[10px] px-2 py-1 rounded-bl-lg rounded-tr text-xs font-bold flex items-center shadow-sm z-20">
            <span className="material-icons-round text-[14px] mr-1">touch_app</span> DASHBOARD
          </div>
        </div>
        <div className="flex justify-between items-start mb-4 mt-2">
          <div className="flex-1 min-w-0 pr-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
            <p className="text-xs text-slate-500 truncate" title={config.room_name || 'Chưa gán phòng'}>{config.room_name || 'Chưa gán phòng'}</p>
          </div>
          <span className="flex items-center text-xs text-slate-500 flex-shrink-0">
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'} mr-1`}></span>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        
        <div className="flex flex-col mt-auto pb-2 items-center justify-center text-center opacity-70">
           <span className="material-icons-round text-3xl mb-2 text-slate-400">important_devices</span>
           <p className="text-xs text-slate-500">Standalone controller</p>
           <p className="text-[10px] text-slate-400 mt-1">Configured via device screen</p>
        </div>
      </div>
    );
  }

  const activePinConfigurations = getActivePinConfigurations(config);
  
  const displayPins = [];
  let hasI2C = false;
  for (const p of activePinConfigurations) {
    if (p.mode === 'I2C') {
      if (!hasI2C) {
        displayPins.push(p);
        hasI2C = true;
      }
    } else {
      displayPins.push(p);
    }
  }

  return (
    <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-y-auto w-full h-full flex flex-col pointer-events-auto">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1 min-w-0 pr-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
          <p className="text-xs text-slate-500 truncate" title={config.room_name || 'Chưa gán phòng'}>{config.room_name || 'Chưa gán phòng'}</p>
        </div>
        <span className="flex items-center text-xs text-slate-500 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'} mr-1`}></span>
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      
      <div className="flex flex-col mt-2">
        {displayPins.length === 0 ? (
           <div className="py-4 text-xs text-slate-400 text-center border-t border-slate-100 dark:border-slate-800/50">No pins configured</div>
        ) : (
           displayPins.map(pin => (
             <PinControlItem key={pin.gpio_pin} config={config} pin={pin} isOnline={isOnline} />
           ))
        )}
      </div>
    </div>
  );
});
