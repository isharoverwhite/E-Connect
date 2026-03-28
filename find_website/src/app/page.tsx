"use client";

import { useEffect, useState, useRef } from "react";
import { useScanner } from "@/hooks/useScanner";
import { ScannerRadar } from "@/components/ScannerRadar";
import { Server, ArrowRight, ShieldAlert, MonitorPlay } from "lucide-react";

const HubIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}>
    <g fill="currentColor">
      <circle cx="12" cy="12" r="3.5" />
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="12" y1="12" x2="12" y2="3" />
        <line x1="12" y1="12" x2="20.56" y2="9.22" />
        <line x1="12" y1="12" x2="17.29" y2="19.28" />
        <line x1="12" y1="12" x2="6.71" y2="19.28" />
        <line x1="12" y1="12" x2="3.44" y2="9.22" />
      </g>
      <circle cx="12" cy="3" r="2.5" />
      <circle cx="20.56" cy="9.22" r="2.5" />
      <circle cx="17.29" cy="19.28" r="2.5" />
      <circle cx="6.71" cy="19.28" r="2.5" />
      <circle cx="3.44" cy="9.22" r="2.5" />
    </g>
  </svg>
);
import { cn } from "@/lib/utils";

export default function Home() {
  const { isScanning, startScan, foundDevices } = useScanner();
  const [hasStarted, setHasStarted] = useState(true);
  const [mounted, setMounted] = useState(false);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line
    setMounted(true);

    if (!hasAutoStarted.current) {
      hasAutoStarted.current = true;
      startScan();
    }
  }, [startScan]);

  const isHttps = mounted && window.location.protocol === "https:";

  const handleStartScan = () => {
    setHasStarted(true);
    startScan();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans">
      <header className="border-b border-slate-800/60 bg-slate-900/50 backdrop-blur pb-4 pt-6 px-6 sm:px-12 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/20 p-2 rounded-lg border border-emerald-500/30">
            <HubIcon className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">E-Connect Web Assistant</h1>
            <p className="text-xs text-slate-400 font-medium tracking-wide uppercase">Local Network Discovery</p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-6 sm:p-12 flex flex-col items-center">
        {isHttps && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-8 w-full flex items-start gap-4">
            <ShieldAlert className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-200/90 leading-relaxed">
              <strong className="text-amber-400 block mb-1">Browser Security Warning (Mixed Content)</strong>
              You are accessing this tool over a secure HTTPS connection. The browser might automatically block scanning devices on your Local Network (HTTP). If you cannot find any E-Connect servers, consider accessing this website via <strong>http://</strong> instead of <strong>https://</strong>.
            </div>
          </div>
        )}

        <div className="w-full flex-1 flex flex-col items-center justify-center min-h-[400px]">
          {(isScanning || foundDevices.length === 0) && (
            <ScannerRadar isScanning={isScanning} className="mb-10 scale-125" />
          )}

          {!hasStarted && !isScanning ? (
            <div className="text-center max-w-lg">
              <h2 className="text-3xl font-semibold mb-4 text-white">Find E-Connect Devices</h2>
              <p className="text-slate-400 mb-8 leading-relaxed">
                The system will scan your local network to find available E-Connect Servers across common subnets. Ensure you are connected to the same Wi-Fi or LAN as the server!
              </p>
              <button
                onClick={handleStartScan}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-8 py-3 rounded-full transition-all hover:scale-105 active:scale-95 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40"
              >
                Start Scanning
              </button>
            </div>
          ) : (isScanning || foundDevices.length === 0) ? (
            <div className="text-center w-full max-w-2xl">
              {isScanning ? (
                <div>
                  <h2 className="text-xl font-medium mb-8 text-emerald-400 animate-pulse">Waiting for searching E-Connect server...</h2>
                </div>
              ) : (
                <div>
                  <h2 className="text-2xl font-medium mb-4 text-white">Scan Complete</h2>
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col items-center mb-8">
                    <MonitorPlay className="w-12 h-12 text-slate-600 mb-4" />
                    <h3 className="text-lg font-medium text-slate-300 mb-2">No E-Connect Servers Found</h3>
                    <p className="text-slate-500 max-w-sm">Please check if the server is turned on and your device is connected to the right LAN. Firewall rules might also be blocking the connection.</p>
                  </div>
                  <button
                    onClick={handleStartScan}
                    className="bg-slate-800 hover:bg-slate-700 text-white font-medium px-8 py-3 rounded-full border border-slate-700 hover:border-slate-600 transition-all shadow-lg"
                  >
                    Scan LAN Again
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {foundDevices.length > 0 && (
            <div className="w-full max-w-3xl mt-4">
              <div className="flex items-center justify-between mb-6 px-1">
                <h3 className="text-lg font-medium text-slate-300 flex items-center gap-2">
                  <Server className="w-5 h-5 text-slate-400" />
                  Scan Results ({foundDevices.length})
                </h3>
                {!isScanning && (
                  <button
                    onClick={handleStartScan}
                    className="text-sm bg-slate-800 hover:bg-slate-700 text-white font-medium px-5 py-2 rounded-full border border-slate-700 hover:border-slate-600 transition-all"
                  >
                    Scan Again
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {foundDevices.map((device) => {
                  const portSegment = device.port && device.port !== "80" && device.port !== "443" ? `:${device.port}` : "";
                  const href = `${device.protocol}://${device.ip}${portSegment}/`;
                  // ...rest of link rendering
                  return (
                  <a
                    key={device.ip}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="group bg-slate-900/50 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-800/50 rounded-xl p-4 transition-all duration-300 flex items-center justify-between overflow-hidden relative"
                  >
                    <div className="absolute top-0 left-0 w-1 rounded-l-xl h-full bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/10 border border-slate-700 group-hover:border-emerald-500/30 transition-colors">
                        <Server className="w-6 h-6 text-slate-400 group-hover:text-emerald-400 transition-colors" />
                      </div>
                      <div>
                        <h4 className="text-lg font-medium text-white group-hover:text-emerald-400 transition-colors">Local Server</h4>
                        <p className="text-slate-400 font-mono text-sm flex items-center gap-2">
                          {device.ip}
                          {isScanning && (
                            <span className="flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="hidden sm:flex items-center gap-6 mr-4">
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">Database</span>
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="text-sm text-slate-300 capitalize">{device.database}</span>
                            <div className={cn("w-2 h-2 rounded-full", device.database === "ok" ? "bg-emerald-500" : "bg-amber-500")} />
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">MQTT Broker</span>
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="text-sm text-slate-300 capitalize">{device.mqtt}</span>
                            <div className={cn("w-2 h-2 rounded-full", device.mqtt === "connected" ? "bg-emerald-500" : "bg-amber-500")} />
                          </div>
                        </div>
                      </div>
                      <div className="bg-slate-950 p-2 rounded-full border border-slate-800 group-hover:border-emerald-500/30 group-hover:bg-emerald-500/10 transition-colors">
                        <ArrowRight className="w-5 h-5 text-slate-500 group-hover:text-emerald-400" />
                      </div>
                    </div>
                  </a>
                );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
      
      <footer className="py-6 text-center text-slate-500 text-sm border-t border-slate-800/50 mt-auto">
        &copy; {new Date().getFullYear()} E-Connect System. All rights reserved.
      </footer>
    </div>
  );
}
