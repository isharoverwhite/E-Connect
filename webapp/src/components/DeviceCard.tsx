import React, { useState, useEffect } from "react";
import { sendDeviceCommand } from "@/lib/api";
import { getActivePinConfigurations, getStatePins as readStatePins } from "@/lib/device-config";
import { DeviceConfig, DeviceStatePin, DeviceStateSnapshot, PinConfig } from "@/types/device";

export const getCardMinHeight = (config: DeviceConfig) => {
  if (config.provider) {
    return 210; // Extension Card
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
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  loading: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const trackClass = loading
    ? "bg-sky-100 border-sky-400 dark:bg-sky-900/40 dark:border-sky-600"
    : checked
      ? "bg-primary border-primary/70"
      : "bg-slate-300 border-slate-300 dark:bg-slate-600 dark:border-slate-600";

  return (
    <div className="flex flex-col items-end gap-1">
      <label
        className={`relative inline-flex h-6 w-11 items-center ${
          disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"
        }`}
        htmlFor={id}
      >
        <input
          checked={checked}
          className="sr-only"
          disabled={disabled}
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
      {loading ? (
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-600 dark:text-sky-300">
          Syncing...
        </span>
      ) : null}
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
  if (typeof pinState?.brightness === "number") {
    return pinState.brightness;
  }
  const numericValue = getNumericStateValue(pinState?.value);
  if (numericValue !== null) {
    return numericValue;
  }
  return fallback;
}

export function PinControlItem({ config, pin, isOnline }: { config: DeviceConfig, pin: PinConfig, isOnline: boolean }) {
  const [requestPending, setRequestPending] = useState(false);
  const [pendingCmdId, setPendingCmdId] = useState<string | null>(null);
  const [optimisticToggleState, setOptimisticToggleState] = useState<boolean | null>(null);
  const [optimisticSliderValue, setOptimisticSliderValue] = useState<number | null>(null);

  const deliveryForPendingCommand = Boolean(
    config.last_delivery && pendingCmdId && config.last_delivery.command_id === pendingCmdId
  );
  const failedPendingCommand =
    deliveryForPendingCommand && config.last_delivery?.status === "failed";

  const pwmMin = pin.extra_params?.min_value ?? 0;
  const pwmMax = pin.extra_params?.max_value ?? 255;
  const pwmRangeMin = Math.min(pwmMin, pwmMax);
  const pwmRangeMax = Math.max(pwmMin, pwmMax);
  const pwmSliderStyle = pwmMin > pwmMax ? { direction: "rtl" as const } : undefined;

  const pinState = getStatePin(config.last_state, pin.mode === 'I2C' ? null : pin.gpio_pin);
  const baselineToggleState = getBinaryState(config.last_state, pin.gpio_pin);
  const baselineSliderValue = getBrightnessState(config.last_state, pin.gpio_pin, pwmMin);

  const toggleTargetMatched =
    optimisticToggleState !== null && baselineToggleState === optimisticToggleState;
  const sliderTargetMatched =
    optimisticSliderValue !== null && baselineSliderValue === optimisticSliderValue;
  const commandStateSynced =
    (optimisticToggleState === null || toggleTargetMatched) &&
    (optimisticSliderValue === null || sliderTargetMatched);

  const pending = requestPending || (pendingCmdId !== null && !deliveryForPendingCommand && !commandStateSynced);
  const toggleLoading = optimisticToggleState !== null && !toggleTargetMatched && !failedPendingCommand;
  const sliderLoading = optimisticSliderValue !== null && !sliderTargetMatched && !failedPendingCommand;

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

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(isChecked);
    
    if (pin.mode === 'PWM') {
      setOptimisticSliderValue(!isChecked ? pwmMin : (sliderValue === pwmMin ? pwmMax : sliderValue));
    }
    
    try {
      const payload: { kind: string; pin: number; value: number; brightness?: number } = { kind: "action", pin: pin.gpio_pin, value: isChecked ? 1 : 0 };
      if (pin.mode === 'PWM' && isChecked && sliderValue === pwmMin) {
        payload.brightness = pwmMax;
      }
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

  const handleSliderCommit = async (rawValue: number) => {
    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(null);
    setOptimisticSliderValue(rawValue);
    try {
      const payload = { kind: "action", pin: pin.gpio_pin, brightness: rawValue };
      const response = await sendDeviceCommand(config.device_id, payload);
      setRequestPending(false);
      if (response && response.status === "failed") {
        setOptimisticSliderValue(null);
      } else {
        setPendingCmdId(response?.command_id || null);
      }
    } catch {
      setRequestPending(false);
      setOptimisticSliderValue(null);
    }
  };

  const label = pin.function || pin.label || `${pin.mode} Pin ${pin.gpio_pin}`;

  if (pin.mode === 'OUTPUT') {
    return (
      <div className="flex justify-between items-center py-3 border-t border-slate-100 dark:border-slate-800/50">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <DeviceToggle
          checked={toggleState}
          disabled={pending || !isOnline}
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
             <span className="text-xs font-bold text-primary">
               {sliderLoading && <span className="text-[10px] uppercase font-normal text-primary/70 mr-1 animate-pulse">Syncing...</span>}
               {sliderValue}
             </span>
             <DeviceToggle
                checked={toggleState}
                disabled={pending || !isOnline}
                id={`pin-toggle-${config.device_id}-${pin.gpio_pin}`}
                loading={toggleLoading}
                onChange={handleToggle}
             />
          </div>
        </div>
        <input
          type="range"
          className="w-full accent-primary h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
          min={pwmRangeMin}
          max={pwmRangeMax}
          value={sliderValue}
          disabled={pending || !isOnline}
          style={pwmSliderStyle}
          onChange={(e) => setOptimisticSliderValue(parseInt(e.target.value))}
          onMouseUp={(e) => void handleSliderCommit(parseInt(e.currentTarget.value))}
          onTouchEnd={(e) => void handleSliderCommit(parseInt(e.currentTarget.value))}
        />
      </div>
    );
  }

  if (pin.mode === 'ADC' || pin.mode === 'INPUT') {
    const inputType = pin.extra_params?.input_type;
    const isSwitch = inputType === "switch";
    const isTach = inputType === "tachometer";
    const numValue = getNumericStateValue(pinState?.value);
    
    let displayValue: React.ReactNode = numValue ?? '--';
    let unit = pinState?.unit;

    if (isSwitch) {
      displayValue = numValue === 1 ? 'ON' : (numValue === 0 ? 'OFF' : '--');
    } else if (isTach) {
      unit = unit || "RPM";
    }

    return (
      <div className="flex justify-between items-center py-3 border-t border-slate-100 dark:border-slate-800/50">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <div className="flex items-baseline space-x-1">
          <span className={`text-lg font-bold ${isSwitch && numValue === 1 ? 'text-green-600 dark:text-green-400' : 'text-slate-800 dark:text-white'}`}>
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

export function ExtensionCard({ config, isOnline }: { config: DeviceConfig, isOnline: boolean }) {
  const [requestPending, setRequestPending] = useState(false);
  const [pendingCmdId, setPendingCmdId] = useState<string | null>(null);
  const [optimisticToggleState, setOptimisticToggleState] = useState<boolean | null>(null);
  const [optimisticSliderValue, setOptimisticSliderValue] = useState<number | null>(null);

  const deliveryForPendingCommand = Boolean(
    config.last_delivery && pendingCmdId && config.last_delivery.command_id === pendingCmdId
  );
  const failedPendingCommand =
    deliveryForPendingCommand && config.last_delivery?.status === "failed";

  const baselineToggleState = getBinaryState(config.last_state);
  const baselineSliderValue = getBrightnessState(config.last_state, null, 0);

  const toggleTargetMatched =
    optimisticToggleState !== null && baselineToggleState === optimisticToggleState;
  const sliderTargetMatched =
    optimisticSliderValue !== null && baselineSliderValue === optimisticSliderValue;
  const commandStateSynced =
    (optimisticToggleState === null || toggleTargetMatched) &&
    (optimisticSliderValue === null || sliderTargetMatched);

  const pending = requestPending || (pendingCmdId !== null && !deliveryForPendingCommand && !commandStateSynced);
  const toggleLoading = optimisticToggleState !== null && !toggleTargetMatched && !failedPendingCommand;
  const sliderLoading = optimisticSliderValue !== null && !sliderTargetMatched && !failedPendingCommand;

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
      }, failedPendingCommand ? 0 : 500);
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

  const handleSliderCommit = async (rawValue: number) => {
    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(null);
    setOptimisticSliderValue(rawValue);
    try {
      const payload = { kind: "action", pin: 0, brightness: rawValue };
      const response = await sendDeviceCommand(config.device_id, payload);
      setRequestPending(false);
      if (response && response.status === "failed") {
        setOptimisticSliderValue(null);
      } else {
        setPendingCmdId(response?.command_id || null);
      }
    } catch {
      setRequestPending(false);
      setOptimisticSliderValue(null);
    }
  };

  return (
    <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-indigo-100 dark:border-indigo-900/50 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-y-auto w-full h-full flex flex-col">
      <div className="absolute top-0 right-0">
        <div className="bg-indigo-500 text-white text-[10px] px-2 py-1 rounded-bl-lg rounded-tr text-xs font-bold flex items-center shadow-sm z-20">
          <span className="material-icons-round text-[14px] mr-1">extension</span> EXT
        </div>
      </div>
      <div className="flex justify-between items-start mb-2 mt-1">
        <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
          <span className="material-icons-round">wb_incandescent</span>
        </div>
        <DeviceToggle
          checked={toggleState}
          disabled={pending || !isOnline}
          id={`ext-${config.device_id}`}
          loading={toggleLoading}
          onChange={handleToggle}
        />
      </div>
      <div className="mb-5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
        <p className="text-xs text-slate-500 truncate" title={config.room_name || 'Chưa gán phòng'}>{config.room_name || 'Chưa gán phòng'}</p>
      </div>
      <div className="mb-4">
        <div className="flex justify-between items-end mb-2">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            Brightness
            {sliderLoading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />}
          </label>
          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
            {sliderLoading && <span className="text-[10px] tracking-wide text-indigo-500/80 animate-pulse font-normal uppercase">Syncing...</span>}
            {sliderValue}
          </span>
        </div>
        <input
          type="range"
          className="w-full accent-primary h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
          min={0}
          max={255}
          value={sliderValue}
          disabled={pending || !isOnline}
          onChange={(e) => setOptimisticSliderValue(parseInt(e.target.value))}
          onMouseUp={(e) => void handleSliderCommit(parseInt(e.currentTarget.value))}
          onTouchEnd={(e) => void handleSliderCommit(parseInt(e.currentTarget.value))}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
        <span className="flex items-center text-indigo-600 dark:text-indigo-400 font-medium">Source: {config.provider}</span>
        {config.is_external && !isOnline ? (
          <span className="text-[10px] uppercase tracking-[0.16em] text-amber-600 dark:text-amber-300">
            Runtime pending
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function DynamicDeviceCard({ config, isOnline }: { config: DeviceConfig, isOnline: boolean }) {
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
}
