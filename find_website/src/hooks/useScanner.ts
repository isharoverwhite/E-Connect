import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildCandidateHosts,
  buildDiscoveryScriptUrl,
  buildWebappBaseUrl,
  COMMON_HOST_ALIASES,
  DISCOVERY_HEALTH_PATH,
  DISCOVERY_SCRIPT_PORT,
  generateSubnetIps,
  isDiscoveryPayloadCandidate,
  isLikelyPrivateDiscoveryHost,
  normalizeDiscoveryHost,
  resolveDiscoveryAliasHost,
  resolvePrivateIpv4SubnetPrefix,
  resolveDiscoveryAttemptBudget,
  resolveDiscoveryHost,
  resolveDiscoveryLanHost,
  resolveWebappTransport,
  WEBSITE_PROBE_TIMEOUT_MS,
  type DeviceInfo,
  type DiscoveryScriptPayload,
} from "@/lib/scanner";

const FOUND_SCAN_TIMEOUT_MS = 7000;
const EMPTY_SCAN_TIMEOUT_MS = 15000;
const BATCH_SIZE = 40;

type WindowWithDynamicCallbacks = Window & Record<string, unknown>;

function getDynamicWindow(): WindowWithDynamicCallbacks | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window as unknown as WindowWithDynamicCallbacks;
}

function isSecureScannerPage(): boolean {
  const pageWindow = getDynamicWindow();
  return pageWindow?.location.protocol === "https:";
}

async function probeWebsite(baseUrl: string, signal: AbortSignal): Promise<DeviceInfo["websiteStatus"]> {
  return new Promise((resolve) => {
    const image = new Image();
    let finished = false;

    const finalize = (status: DeviceInfo["websiteStatus"]) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", handleAbort);
      resolve(status);
    };

    const handleAbort = () => finalize("offline");
    const timeoutId = window.setTimeout(() => finalize("offline"), WEBSITE_PROBE_TIMEOUT_MS);

    signal.addEventListener("abort", handleAbort, { once: true });
    image.onload = () => finalize("online");
    image.onerror = () => finalize("offline");
    image.src = `${baseUrl}/favicon.ico?_dc=${Date.now()}`;
  });
}

async function buildDeviceFromPayload(
  host: string,
  payload: DiscoveryScriptPayload,
  signal: AbortSignal,
): Promise<DeviceInfo | null> {
  if (!isDiscoveryPayloadCandidate(payload)) {
    return null;
  }

  const { protocol, port } = resolveWebappTransport(payload.firmware_network);
  const probeHost = host.trim();
  const lanHost = resolveDiscoveryLanHost(host, payload.firmware_network);
  const displayHost = lanHost ?? resolveDiscoveryHost(host, payload.firmware_network);
  const advertisedHost = lanHost ? resolveDiscoveryAliasHost(host, payload.firmware_network) : null;
  let launchHost = displayHost;
  let websiteStatus = await probeWebsite(buildWebappBaseUrl(launchHost, protocol, port), signal);

  if (!lanHost && launchHost !== probeHost && websiteStatus === "offline") {
    const fallbackStatus = await probeWebsite(buildWebappBaseUrl(probeHost, protocol, port), signal);
    launchHost = probeHost;
    websiteStatus = fallbackStatus;
  }

  return {
    displayHost,
    launchHost,
    probeHost,
    advertisedHost,
    database: payload.database?.trim() || "unknown",
    mqtt: payload.mqtt?.trim() || "unknown",
    protocol,
    port,
    websiteStatus,
  };
}

async function probeCandidateHostViaHealth(host: string, signal: AbortSignal, timeoutMs: number): Promise<DeviceInfo | null> {
  if (isSecureScannerPage()) {
    return null;
  }

  const pageWindow = getDynamicWindow();
  if (!pageWindow || signal.aborted) {
    return null;
  }

  const requestController = new AbortController();
  const abortRequest = () => requestController.abort();
  const timeoutId = window.setTimeout(abortRequest, timeoutMs);

  signal.addEventListener("abort", abortRequest, { once: true });

  try {
    const response = await fetch(`http://${host.trim()}:${DISCOVERY_SCRIPT_PORT}${DISCOVERY_HEALTH_PATH}`, {
      signal: requestController.signal,
    });
    const payload = (await response.json()) as DiscoveryScriptPayload;
    return await buildDeviceFromPayload(host, payload, signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", abortRequest);
  }
}

async function probeCandidateHostOnce(host: string, signal: AbortSignal, timeoutMs: number): Promise<DeviceInfo | null> {
  const pageWindow = getDynamicWindow();
  if (!pageWindow || signal.aborted) {
    return null;
  }

  return new Promise((resolve) => {
    let finished = false;
    const callbackName = `__econnectDiscovery_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");

    const finalize = (device: DeviceInfo | null) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", handleAbort);
      script.onload = null;
      script.onerror = null;
      script.remove();
      delete pageWindow[callbackName];
      resolve(device);
    };

    const handleAbort = () => finalize(null);
    const timeoutId = window.setTimeout(() => finalize(null), timeoutMs);

    pageWindow[callbackName] = async (payload: DiscoveryScriptPayload) => {
      clearTimeout(timeoutId);
      finalize(await buildDeviceFromPayload(host, payload, signal));
    };

    script.async = true;
    script.onerror = () => finalize(null);
    script.src = buildDiscoveryScriptUrl(host, callbackName);

    signal.addEventListener("abort", handleAbort, { once: true });
    document.body.appendChild(script);
  });
}

async function waitBeforeRetry(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const finalize = () => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    };
    const handleAbort = () => {
      clearTimeout(timeoutId);
      finalize();
    };
    const timeoutId = window.setTimeout(finalize, delayMs);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function probeCandidateHost(host: string, signal: AbortSignal): Promise<DeviceInfo | null> {
  const { timeoutMs, attempts } = resolveDiscoveryAttemptBudget(host);
  const secureScannerPage = isSecureScannerPage();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!secureScannerPage) {
      const directDevice = await probeCandidateHostViaHealth(host, signal, timeoutMs);
      if (directDevice || signal.aborted || attempt === attempts) {
        return directDevice;
      }
    } else {
      const device = await probeCandidateHostOnce(host, signal, timeoutMs);
      if (device || signal.aborted || attempt === attempts) {
        return device;
      }
    }

    await waitBeforeRetry(signal, 250);
  }

  return null;
}

export const useScanner = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [foundDevices, setFoundDevices] = useState<DeviceInfo[]>([]);
  const [progress, setProgress] = useState(0);
  const [scannedCount, setScannedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const globalTimeoutRef = useRef<number | null>(null);
  const scanStartedAtRef = useRef<number | null>(null);
  const pendingDevicesRef = useRef<Map<string, DeviceInfo>>(new Map());
  const hasDetectedServerRef = useRef(false);
  const hasAutoStartedRef = useRef(false);
  const scanTimedOutRef = useRef(false);

  const clearGlobalTimeout = useCallback(() => {
    if (globalTimeoutRef.current !== null) {
      window.clearTimeout(globalTimeoutRef.current);
      globalTimeoutRef.current = null;
    }
  }, []);

  const finalizeScan = useCallback(() => {
    clearGlobalTimeout();
    scanStartedAtRef.current = null;
    setFoundDevices(Array.from(pendingDevicesRef.current.values()));
    setIsScanning(false);
  }, [clearGlobalTimeout]);

  const scheduleScanAbort = useCallback(
    (delayMs: number) => {
      clearGlobalTimeout();
      globalTimeoutRef.current = window.setTimeout(() => {
        scanTimedOutRef.current = true;
        abortControllerRef.current?.abort();
      }, Math.max(0, delayMs));
    },
    [clearGlobalTimeout],
  );

  const waitForScanDeadline = useCallback(async (signal: AbortSignal) => {
    if (signal.aborted || !scanStartedAtRef.current) {
      return;
    }

    const timeoutMs = hasDetectedServerRef.current ? FOUND_SCAN_TIMEOUT_MS : EMPTY_SCAN_TIMEOUT_MS;
    const remainingMs = scanStartedAtRef.current + timeoutMs - Date.now();
    if (remainingMs <= 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      const handleAbort = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      const timeoutId = window.setTimeout(() => {
        signal.removeEventListener("abort", handleAbort);
        resolve();
      }, remainingMs);

      signal.addEventListener("abort", handleAbort, { once: true });
    });
  }, []);

  const shortenScanAfterDetection = useCallback(() => {
    if (hasDetectedServerRef.current) {
      return;
    }

    hasDetectedServerRef.current = true;
    if (!scanStartedAtRef.current) {
      return;
    }

    const remainingMs = scanStartedAtRef.current + FOUND_SCAN_TIMEOUT_MS - Date.now();
    if (remainingMs <= 0) {
      abortControllerRef.current?.abort();
      return;
    }

    scheduleScanAbort(remainingMs);
  }, [scheduleScanAbort]);

  const startScan = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }

    abortControllerRef.current?.abort();
    clearGlobalTimeout();

    setIsScanning(true);
    setFoundDevices([]);
    setProgress(0);
    setScannedCount(0);
    setScanError(null);
    scanTimedOutRef.current = false;
    pendingDevicesRef.current = new Map();
    hasDetectedServerRef.current = false;
    scanStartedAtRef.current = Date.now();

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    scheduleScanAbort(EMPTY_SCAN_TIMEOUT_MS);

    const preferredHosts = Array.from(
      new Set([
        ...(isLikelyPrivateDiscoveryHost(window.location.hostname)
          ? [normalizeDiscoveryHost(window.location.hostname) ?? window.location.hostname]
          : []),
        ...(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? ["127.0.0.1", "localhost"]
          : []),
        ...COMMON_HOST_ALIASES,
      ]),
    );
    const currentSubnetHosts = (() => {
      const subnetPrefix = resolvePrivateIpv4SubnetPrefix(window.location.hostname);
      if (!subnetPrefix) {
        return [];
      }

      const preferredHostSet = new Set(preferredHosts);
      return generateSubnetIps(subnetPrefix).filter((host) => !preferredHostSet.has(host));
    })();
    const discoveredSubnetHosts = buildCandidateHosts([...preferredHosts, ...currentSubnetHosts]);
    const subnetHosts = [...currentSubnetHosts, ...discoveredSubnetHosts];
    const candidateHosts = [...preferredHosts, ...subnetHosts];

    setTotalCount(candidateHosts.length);
    let checked = 0;

    const runBatch = async (batch: string[]) => {
      const results = await Promise.all(
        batch.map(async (host) => {
          const device = await probeCandidateHost(host, signal);

          checked += 1;
          if (checked % 10 === 0 || checked === candidateHosts.length) {
            setScannedCount(checked);
            setProgress(Math.round((checked / candidateHosts.length) * 100));
          }

          return device;
        }),
      );

      for (const device of results) {
        if (!device) {
          continue;
        }

        pendingDevicesRef.current.set(`${device.launchHost}:${device.port ?? ""}`, device);
        shortenScanAfterDetection();
      }
    };

    try {
      if (preferredHosts.length > 0) {
        await runBatch(preferredHosts);
      }

      if (pendingDevicesRef.current.size > 0) {
        checked = candidateHosts.length;
        setScannedCount(candidateHosts.length);
        setProgress(100);
        await waitForScanDeadline(signal);
        return;
      }

      for (let index = 0; index < subnetHosts.length; index += BATCH_SIZE) {
        if (signal.aborted) {
          break;
        }

        const batch = subnetHosts.slice(index, index + BATCH_SIZE);
        await runBatch(batch);
      }

      await waitForScanDeadline(signal);

      if (pendingDevicesRef.current.size === 0 && isSecureScannerPage() && scanTimedOutRef.current) {
        setScanError(
          "This public HTTPS page scans from your current browser session on the same LAN. If the browser blocks local discovery, retry in Chrome or Edge on that LAN and keep the tab open until the scan completes.",
        );
      }
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "The browser scanner failed unexpectedly.");
    } finally {
      finalizeScan();
    }
  }, [clearGlobalTimeout, finalizeScan, scheduleScanAbort, shortenScanAfterDetection, waitForScanDeadline]);

  const stopScan = useCallback(() => {
    clearGlobalTimeout();
    scanTimedOutRef.current = false;
    abortControllerRef.current?.abort();
  }, [clearGlobalTimeout]);

  useEffect(() => {
    if (hasAutoStartedRef.current) {
      return;
    }

    hasAutoStartedRef.current = true;
    void startScan();
  }, [startScan]);

  useEffect(() => () => stopScan(), [stopScan]);

  return {
    isScanning,
    startScan,
    stopScan,
    foundDevices,
    progress,
    scannedCount,
    totalCount,
    scanError,
  };
};
