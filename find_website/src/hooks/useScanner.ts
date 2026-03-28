import { useState, useCallback, useRef } from "react";
import { generateSubnetIps, COMMON_SUBNETS, type DeviceInfo } from "@/lib/scanner";

export const useScanner = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [foundDevices, setFoundDevices] = useState<DeviceInfo[]>([]);
  const [progress, setProgress] = useState(0);
  const [scannedCount, setScannedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const globalTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startScan = useCallback(async () => {
    setIsScanning(true);
    setFoundDevices([]);
    setProgress(0);
    setScannedCount(0);
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    if (globalTimeoutRef.current) {
      clearTimeout(globalTimeoutRef.current);
    }
    
    globalTimeoutRef.current = setTimeout(() => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setIsScanning(false);
    }, 10000);

    const extraIps = ["127.0.0.1", "localhost"];
    if (typeof window !== "undefined" && window.location.hostname) {
      extraIps.push(window.location.hostname);
    }
    
    // Combine explicit IPs with generated subnet IPs, filtering duplicates
    const allIps = Array.from(new Set([...extraIps, ...COMMON_SUBNETS.flatMap(generateSubnetIps)]));
    
    setTotalCount(allIps.length);
    const total = allIps.length;
    let checked = 0;

    // Scan in chunks so we don't overwhelm the browser network queue
    const BATCH_SIZE = 50; 
    
    for (let i = 0; i < allIps.length; i += BATCH_SIZE) {
      if (signal.aborted) break;
      const batch = allIps.slice(i, i + BATCH_SIZE);
      
      const promises = batch.map(async (ip) => {
        try {
          // We use a short timeout because local networks respond very fast for alive hosts
          // Dead hosts will hang or take seconds to reject, we do not want to wait that long.
          const timeoutController = new AbortController();
          const timeoutId = setTimeout(() => timeoutController.abort(), 1500);
          
          // E-Connect backend is at :8000
          const response8000 = await fetch(`http://${ip}:8000/health`, {
            signal: timeoutController.signal,
          });
          
          if (response8000.ok || response8000.status === 503) {
            const data = await response8000.json();
            // E-connect always returns status ok or degraded inside payload
            if (data && (data.status === "ok" || data.status === "degraded")) {
              // Extract webapp protocol/port from backend if available
              let protocol = "http";
              let port = "3000";
              if (data.firmware_network?.api_base_url) {
                try {
                  const url = new URL(data.firmware_network.api_base_url);
                  protocol = url.protocol.replace(':', '');
                  port = url.port || (protocol === 'https' ? '443' : '80');
                } catch {
                  // Fallback to defaults
                }
              }

              // Verify frontend is also up
              try {
                // Using no-cors mode prevents CORS errors and checks connection. 
                // For HTTPS, this throws immediately due to self-signed cert on local IPs.
                await fetch(`${protocol}://${ip}:${port}/`, {
                  mode: "no-cors",
                  signal: timeoutController.signal,
                }).catch(() => {
                  if (protocol === 'https') {
                    // Browser fetch strictly rejects local self-signed HTTPS without bypassing,
                    // but finding the backend + it advertising HTTPS is enough proof it's running.
                    return true; 
                  }
                  throw new Error("HTTP connection failed");
                });
                
                // If it succeeds (or is trusted HTTPS), both are considered open
                setFoundDevices((prev) => {
                  if (!prev.find((d) => d.ip === ip)) {
                    return [...prev, { ip, protocol, port, database: data.database, mqtt: data.mqtt }];
                  }
                  return prev;
                });
              } catch {
                // Connection was refused or timed out, so web app is not actually running.
              }
            }
          }
          
          clearTimeout(timeoutId);
        } catch {
          // Ignore timeouts and connection errors
        } finally {
          checked++;
          if (checked % 10 === 0 || checked === total) {
             setScannedCount(checked);
             setProgress(Math.round((checked / total) * 100));
          }
        }
      });
      
      await Promise.all(promises);
    }
    
    if (globalTimeoutRef.current) {
      clearTimeout(globalTimeoutRef.current);
    }
    setIsScanning(false);
  }, []);

  const stopScan = useCallback(() => {
    if (globalTimeoutRef.current) {
      clearTimeout(globalTimeoutRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsScanning(false);
  }, []);

  return { isScanning, startScan, stopScan, foundDevices, progress, scannedCount, totalCount };
};
