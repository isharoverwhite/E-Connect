import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildCandidateHosts,
  buildDiscoveryBridgeUrl,
  buildDiscoveryScriptUrl,
  buildWebappBaseUrl,
  COMMON_HOST_ALIASES,
  DEFAULT_WEBAPP_PORT,
  DEFAULT_WEBAPP_PROTOCOL,
  DISCOVERY_BRIDGE_TIMEOUT_MS,
  DISCOVERY_BRIDGE_STORAGE_KEY,
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
  resolveWebappProbeTransports,
  resolveWebappTransport,
  WEBSITE_PROBE_TIMEOUT_MS,
  type DeviceInfo,
  type DiscoveryScriptPayload,
  type WebappTransport,
} from "@/lib/scanner";

const FOUND_SCAN_TIMEOUT_MS = 15000;
const EMPTY_SCAN_TIMEOUT_MS = 15000;
const BATCH_SIZE = 40;
const SECURE_AUTO_SCAN_DELAY_MS = 500;
const SECURE_HTTP_WEBSITE_RETRY_DELAY_MS = 400;

type WindowWithDynamicCallbacks = Window & Record<string, unknown>;
type DiscoveryBridgeMessage = {
  type: "econnect.discovery.bridge";
  requestId: string;
  host: string;
  payload: DiscoveryScriptPayload;
};
type StartScanOptions = {
  interactive?: boolean;
};

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

function isDiscoveryBridgeMessage(value: unknown, requestId: string): value is DiscoveryBridgeMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "econnect.discovery.bridge" &&
    candidate.requestId === requestId &&
    typeof candidate.host === "string" &&
    isDiscoveryPayloadCandidate(candidate.payload)
  );
}

function decodeDiscoveryBridgePayload(value: string, requestId: string): DiscoveryBridgeMessage | null {
  try {
    const normalizedValue = value.replace(/-/g, "+").replace(/_/g, "/");
    const paddedValue = normalizedValue.padEnd(Math.ceil(normalizedValue.length / 4) * 4, "=");
    const decodedValue = atob(paddedValue);
    const candidate = JSON.parse(decodedValue) as unknown;
    return isDiscoveryBridgeMessage(candidate, requestId) ? candidate : null;
  } catch {
    return null;
  }
}

async function probeWebsite(baseUrl: string, signal: AbortSignal): Promise<DeviceInfo["websiteStatus"]> {
  const probeUrl = `${baseUrl}/favicon.ico?_dc=${Date.now()}`;

  if (isSecureScannerPage() && baseUrl.startsWith("http://") && isLikelyPrivateDiscoveryHost(baseUrl)) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      const timeoutId = window.setTimeout(abortRequest, WEBSITE_PROBE_TIMEOUT_MS);

      signal.addEventListener("abort", abortRequest, { once: true });

      try {
        await fetch(probeUrl, {
          mode: "no-cors",
          signal: requestController.signal,
        });
        return "online";
      } catch {
        if (attempt === 2 || signal.aborted) {
          return "offline";
        }
      } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener("abort", abortRequest);
      }

      await waitBeforeRetry(signal, SECURE_HTTP_WEBSITE_RETRY_DELAY_MS);
    }
  }

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
    image.src = probeUrl;
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

  const advertisedTransport = resolveWebappTransport(payload.webapp, payload.firmware_network);
  const transportCandidates = resolveWebappProbeTransports(payload.webapp, payload.firmware_network, {
    securePage: isSecureScannerPage(),
    probeHost: host,
  });
  const primaryTransport = transportCandidates[0] ?? advertisedTransport;
  const probeHost = host.trim();
  const displayHost = resolveDiscoveryHost(host, payload.firmware_network, payload.server_ip);
  const advertisedHostCandidate = resolveDiscoveryAliasHost(host, payload.firmware_network);
  const advertisedHost =
    advertisedHostCandidate && advertisedHostCandidate !== displayHost ? advertisedHostCandidate : null;
  const launchHostCandidates: string[] = [];
  const appendLaunchHostCandidate = (candidate: string | null | undefined) => {
    const normalizedCandidate = normalizeDiscoveryHost(candidate);
    if (!normalizedCandidate || launchHostCandidates.includes(normalizedCandidate)) {
      return;
    }

    launchHostCandidates.push(normalizedCandidate);
  };

  appendLaunchHostCandidate(resolveDiscoveryLanHost(host, payload.firmware_network, payload.server_ip));
  appendLaunchHostCandidate(resolveDiscoveryHost(host, payload.firmware_network));
  appendLaunchHostCandidate(host);

  const composeHttpFallbackTransport = transportCandidates.find(
    (transport) => transport.protocol === DEFAULT_WEBAPP_PROTOCOL && transport.port === DEFAULT_WEBAPP_PORT,
  );
  const canAssumeComposeHttpWebsite =
    isSecureScannerPage() &&
    advertisedTransport.protocol === "https" &&
    advertisedTransport.port === DEFAULT_WEBAPP_PORT &&
    composeHttpFallbackTransport !== undefined;
  let selectedTransport: WebappTransport = primaryTransport;
  let launchHost = launchHostCandidates[0] ?? displayHost;
  let websiteStatus: DeviceInfo["websiteStatus"] = "offline";

  if (canAssumeComposeHttpWebsite && composeHttpFallbackTransport) {
    selectedTransport = composeHttpFallbackTransport;
    launchHost = launchHostCandidates[0] ?? displayHost;
    websiteStatus = "online";

    return {
      displayHost,
      launchHost,
      probeHost,
      advertisedHost,
      database: payload.database?.trim() || "unknown",
      mqtt: payload.mqtt?.trim() || "unknown",
      initialized: typeof payload.initialized === "boolean" ? payload.initialized : null,
      protocol: selectedTransport.protocol,
      port: selectedTransport.port,
      websiteStatus,
    };
  }

  for (const transport of transportCandidates) {
    selectedTransport = transport;
    for (const candidateHost of launchHostCandidates) {
      launchHost = candidateHost;
      websiteStatus = await probeWebsite(
        buildWebappBaseUrl(candidateHost, transport.protocol, transport.port),
        signal,
      );
      if (websiteStatus === "online") {
        break;
      }
    }

    if (websiteStatus === "online") {
      break;
    }
  }

  if (websiteStatus !== "online" && canAssumeComposeHttpWebsite && composeHttpFallbackTransport) {
    selectedTransport = composeHttpFallbackTransport;
    launchHost = launchHostCandidates[0] ?? displayHost;
    websiteStatus = "online";
  }

  return {
    displayHost,
    launchHost,
    probeHost,
    advertisedHost,
    database: payload.database?.trim() || "unknown",
    mqtt: payload.mqtt?.trim() || "unknown",
    initialized: typeof payload.initialized === "boolean" ? payload.initialized : null,
    protocol: selectedTransport.protocol,
    port: selectedTransport.port,
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

    pageWindow[callbackName] = (payload: DiscoveryScriptPayload) => {
      clearTimeout(timeoutId);
      window.setTimeout(() => {
        if (signal.aborted) {
          finalize(null);
          return;
        }

        void (async () => {
          finalize(await buildDeviceFromPayload(host, payload, signal));
        })();
      }, 0);
    };

    script.async = true;
    script.onerror = () => finalize(null);
    script.src = buildDiscoveryScriptUrl(host, callbackName);

    signal.addEventListener("abort", handleAbort, { once: true });
    document.body.appendChild(script);
  });
}

async function probeCandidateHostViaBridgeWindow(
  bridgeWindowRef: { current: Window | null },
  host: string,
  requestId: string,
  signal: AbortSignal,
  options?: {
    bridgeUrl?: string;
    openPopup?: () => Window | null;
    skipNavigation?: boolean;
  },
): Promise<DeviceInfo | null> {
  const pageWindow = getDynamicWindow();
  if (!pageWindow || signal.aborted) {
    return null;
  }

  const bridgeUrl = options?.bridgeUrl ?? buildDiscoveryBridgeUrl(host, pageWindow.location.origin, requestId);

  return new Promise((resolve) => {
    let finished = false;

    const finalize = (device: DeviceInfo | null) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", handleAbort);
      pageWindow.removeEventListener("message", handleMessage);
      pageWindow.removeEventListener("storage", handleStorage);
      resolve(device);
    };

    const handleAbort = () => finalize(null);
    const resolveBridgeMessage = (bridgeMessage: DiscoveryBridgeMessage, eventOrigin?: string) => {
      const eventOriginHost = eventOrigin ? normalizeDiscoveryHost(eventOrigin) : normalizeDiscoveryHost(bridgeMessage.host);
      const expectedHost = normalizeDiscoveryHost(host);
      if (expectedHost && eventOriginHost && eventOriginHost !== expectedHost) {
        return;
      }

      clearTimeout(timeoutId);
      void (async () => {
        try {
          finalize(await buildDeviceFromPayload(bridgeMessage.host || host, bridgeMessage.payload, signal));
        } catch {
          finalize(null);
        }
      })();
    };
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== bridgeWindowRef.current || !isDiscoveryBridgeMessage(event.data, requestId)) {
        return;
      }

      resolveBridgeMessage(event.data, event.origin);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== DISCOVERY_BRIDGE_STORAGE_KEY || typeof event.newValue !== "string") {
        return;
      }

      const bridgeMessage = decodeDiscoveryBridgePayload(event.newValue, requestId);
      if (!bridgeMessage) {
        return;
      }

      try {
        pageWindow.localStorage.removeItem(DISCOVERY_BRIDGE_STORAGE_KEY);
      } catch {
        // Ignore storage cleanup failures and still accept the bridge result.
      }

      resolveBridgeMessage(bridgeMessage);
    };
    const timeoutId = window.setTimeout(() => finalize(null), DISCOVERY_BRIDGE_TIMEOUT_MS);

    signal.addEventListener("abort", handleAbort, { once: true });
    pageWindow.addEventListener("message", handleMessage);
    pageWindow.addEventListener("storage", handleStorage);

    try {
      pageWindow.localStorage.removeItem(DISCOVERY_BRIDGE_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures before the bridge attempt.
    }

    if (options?.openPopup) {
      try {
        bridgeWindowRef.current = options.openPopup();
      } catch {
        finalize(null);
        return;
      }

      if (!bridgeWindowRef.current) {
        finalize(null);
        return;
      }
    }

    const bridgeWindow = bridgeWindowRef.current;
    if (!bridgeWindow) {
      finalize(null);
      return;
    }

    if (!options?.skipNavigation) {
      try {
        bridgeWindow.location.href = bridgeUrl;
      } catch {
        finalize(null);
      }
    }
  });
}

async function probePreferredAliasesViaBridge(signal: AbortSignal): Promise<DeviceInfo | null> {
  const pageWindow = getDynamicWindow();
  if (!pageWindow || signal.aborted) {
    return null;
  }

  const bridgeHosts = COMMON_HOST_ALIASES.filter((host) => host.endsWith(".local"));
  if (bridgeHosts.length === 0) {
    return null;
  }

  const createBridgeAttempt = (host: string) => {
    const requestId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return {
      requestId,
      bridgeUrl: buildDiscoveryBridgeUrl(host, pageWindow.location.origin, requestId),
    };
  };
  const bridgeWindowName = `econnect-discovery-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [firstBridgeHost, ...remainingBridgeHosts] = bridgeHosts;
  const firstBridgeAttempt = createBridgeAttempt(firstBridgeHost);
  const bridgeWindowRef: { current: Window | null } = { current: null };

  try {
    if (!signal.aborted) {
      const firstDevice = await probeCandidateHostViaBridgeWindow(
        bridgeWindowRef,
        firstBridgeHost,
        firstBridgeAttempt.requestId,
        signal,
        {
          bridgeUrl: firstBridgeAttempt.bridgeUrl,
          openPopup: () =>
            pageWindow.open(
              firstBridgeAttempt.bridgeUrl,
              bridgeWindowName,
              "popup,width=420,height=640",
            ),
          skipNavigation: true,
        },
      );
      if (firstDevice) {
        return firstDevice;
      }
    }

    const bridgeWindow = bridgeWindowRef.current;
    if (!bridgeWindow) {
      return null;
    }

    for (const host of remainingBridgeHosts) {
      if (signal.aborted || bridgeWindow.closed) {
        return null;
      }

      const bridgeAttempt = createBridgeAttempt(host);
      const device = await probeCandidateHostViaBridgeWindow(
        bridgeWindowRef,
        host,
        bridgeAttempt.requestId,
        signal,
        {
          bridgeUrl: bridgeAttempt.bridgeUrl,
        },
      );
      if (device) {
        return device;
      }
    }
  } finally {
    const bridgeWindow = bridgeWindowRef.current;
    if (bridgeWindow && !bridgeWindow.closed) {
      bridgeWindow.close();
    }
  }

  return null;
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
  const [hasScannedOnce, setHasScannedOnce] = useState(false);

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

  const startScan = useCallback(async (options?: StartScanOptions) => {
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
    setHasScannedOnce(true);
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
      if (isSecureScannerPage() && options?.interactive) {
        setTotalCount(COMMON_HOST_ALIASES.length);
        const bridgedDevice = await probePreferredAliasesViaBridge(signal);
        if (bridgedDevice) {
          pendingDevicesRef.current.set(`${bridgedDevice.launchHost}:${bridgedDevice.port ?? ""}`, bridgedDevice);
          shortenScanAfterDetection();
          setScannedCount(COMMON_HOST_ALIASES.length);
          setProgress(100);
          return;
        }

        setScannedCount(COMMON_HOST_ALIASES.length);
      }

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
    if (hasAutoStartedRef.current || typeof window === "undefined") {
      return;
    }

    hasAutoStartedRef.current = true;

    const secureScannerPage = isSecureScannerPage();
    let timeoutId: number | null = null;

    const scheduleStart = () => {
      timeoutId = window.setTimeout(
        () => {
          timeoutId = null;
          void startScan({ interactive: secureScannerPage });
        },
        secureScannerPage ? SECURE_AUTO_SCAN_DELAY_MS : 0,
      );
    };

    if (document.readyState === "complete") {
      scheduleStart();
      return () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      };
    }

    const handleLoad = () => {
      window.removeEventListener("load", handleLoad);
      scheduleStart();
    };

    window.addEventListener("load", handleLoad, { once: true });

    return () => {
      window.removeEventListener("load", handleLoad);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
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
    hasScannedOnce,
  };
};
