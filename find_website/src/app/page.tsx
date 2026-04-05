/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useSyncExternalStore } from "react";
import { useScanner } from "@/hooks/useScanner";
import { ScannerRadar } from "@/components/ScannerRadar";
import { Server, ArrowRight, MonitorPlay } from "lucide-react";
import { buildWebappBaseUrl } from "@/lib/scanner";
import { cn } from "@/lib/utils";

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

export default function Home() {
  const { isScanning, startScan, foundDevices, scanError, hasScannedOnce } = useScanner();
  const isHttps = useSyncExternalStore(
    () => () => {},
    () => window.location.protocol === "https:",
    () => false,
  );

  const handleStartScan = () => {
    void startScan({ interactive: isHttps });
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans text-slate-900">
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-6 pb-4 pt-6 backdrop-blur sm:px-12">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-2">
            <HubIcon className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">E-Connect Web Assistant</h1>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Local Network Discovery</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center p-6 sm:p-12">
        <div className="flex min-h-[400px] w-full flex-1 flex-col items-center justify-center">
          {(isScanning || foundDevices.length === 0) && (
            <ScannerRadar isScanning={isScanning} className="mb-10 scale-125" />
          )}

          {!hasScannedOnce && !isScanning && foundDevices.length === 0 ? (
            <div className="w-full max-w-2xl text-center">
              <h2 className="mb-4 text-2xl font-medium text-slate-900">Ready to Scan</h2>
              <div className="mb-8 flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <MonitorPlay className="mb-4 h-12 w-12 text-slate-400" />
                <h3 className="mb-2 text-lg font-medium text-slate-800">Scan your LAN from this browser</h3>
                <p className="max-w-sm text-slate-500">
                  Open this page from a device on the same LAN as your E-Connect server, then start the scan.
                </p>
                {isHttps ? (
                  <p className="mt-3 max-w-sm text-sm text-slate-500">
                    We may open a small local window to find your server on this network. If your browser asks, please
                    allow it.
                  </p>
                ) : null}
              </div>
              <button
                onClick={handleStartScan}
                className="rounded-full bg-blue-600 px-8 py-3 font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500"
              >
                {isHttps ? "Start LAN Scan" : "Scan LAN"}
              </button>
            </div>
          ) : isScanning || foundDevices.length === 0 ? (
            <div className="w-full max-w-2xl text-center">
              {isScanning ? (
                <div>
                  <h2 className="mb-8 animate-pulse text-xl font-medium text-blue-600">
                    Waiting for searching E-Connect server...
                  </h2>
                </div>
              ) : scanError ? (
                <div>
                  <h2 className="mb-4 text-2xl font-medium text-slate-900">Scan Failed</h2>
                  <div className="mb-8 flex flex-col items-center rounded-2xl border border-rose-200 bg-rose-50 p-8">
                    <MonitorPlay className="mb-4 h-12 w-12 text-rose-400" />
                    <h3 className="mb-2 text-lg font-medium text-rose-700">The browser scanner failed</h3>
                    <p className="max-w-sm text-rose-700/80">{scanError}</p>
                  </div>
                  <button
                    onClick={handleStartScan}
                    className="rounded-full bg-blue-600 px-8 py-3 font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500"
                  >
                    {isHttps ? "Scan LAN Again" : "Retry Scan"}
                  </button>
                </div>
              ) : (
                <div>
                  <h2 className="mb-4 text-2xl font-medium text-slate-900">Scan Complete</h2>
                  <div className="mb-8 flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                    <MonitorPlay className="mb-4 h-12 w-12 text-slate-400" />
                    <h3 className="mb-2 text-lg font-medium text-slate-800">No E-Connect Servers Found</h3>
                    <p className="max-w-sm text-slate-500">
                      Please check if the server is turned on, your device is connected to the right LAN, and the LAN
                      can resolve <span className="font-mono">econnect.local</span> if you plan to use that shortcut.
                    </p>
                    {isHttps ? (
                      <p className="mt-3 max-w-sm text-sm text-slate-500">
                        If you opened this public page through HTTPS or Cloudflare Tunnel, retry in Chrome or Edge on
                        the same LAN and keep the tab open until the scan completes.
                      </p>
                    ) : null}
                  </div>
                  <button
                    onClick={handleStartScan}
                    className="rounded-full bg-blue-600 px-8 py-3 font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500"
                  >
                    {isHttps ? "Scan LAN Again" : "Retry Scan"}
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {foundDevices.length > 0 && !isScanning ? (
            <div className="mt-4 w-full max-w-3xl">
              <div className="mb-6 flex items-center justify-between px-1">
                <h3 className="flex items-center gap-2 text-lg font-medium text-slate-700">
                  <Server className="h-5 w-5 text-slate-400" />
                  Scan Results ({foundDevices.length})
                </h3>
                <button
                  onClick={handleStartScan}
                  className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50"
                >
                  {isHttps ? "Scan LAN Again" : "Scan Again"}
                </button>
              </div>
              <div className="flex flex-col gap-3">
                {foundDevices.map((device) => {
                  const href = `${buildWebappBaseUrl(device.launchHost, device.protocol, device.port)}/`;
                  const isWebsiteOnline = device.websiteStatus === "online";
                  const initializedLabel =
                    device.initialized === true ? "Initialized" : device.initialized === false ? "Setup required" : "Unknown";
                  const showsAdvertisedAlias = Boolean(
                    device.advertisedHost && device.advertisedHost !== device.displayHost,
                  );
                  const showsFallbackHost = device.displayHost !== device.launchHost;
                  const cardClassName = cn(
                    "group relative flex items-center justify-between overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300",
                    isWebsiteOnline ? "hover:border-blue-500/40 hover:bg-blue-50/30 hover:shadow-md" : "opacity-90",
                  );

                  const cardContent = (
                    <>
                      <div
                        className={cn(
                          "absolute left-0 top-0 h-full w-1 rounded-l-xl transition-opacity",
                          isWebsiteOnline ? "bg-blue-500 opacity-0 group-hover:opacity-100" : "bg-rose-500/70 opacity-100",
                        )}
                      />

                      <div className="flex items-center gap-4">
                        <div
                          className={cn(
                            "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors",
                            isWebsiteOnline
                              ? "border-slate-200 bg-slate-100 group-hover:border-blue-500/30 group-hover:bg-blue-500/10"
                              : "border-rose-200 bg-rose-50",
                          )}
                        >
                          <Server
                            className={cn(
                              "h-6 w-6 transition-colors",
                              isWebsiteOnline ? "text-slate-500 group-hover:text-blue-600" : "text-rose-500",
                            )}
                          />
                        </div>
                        <div>
                          <h4
                            className={cn(
                              "text-lg font-medium transition-colors",
                              isWebsiteOnline ? "text-slate-900 group-hover:text-blue-600" : "text-slate-900",
                            )}
                          >
                            Local Server
                          </h4>
                          <p className="font-mono text-sm text-slate-500">{device.displayHost}</p>
                          {showsAdvertisedAlias ? (
                            <p className="text-xs text-slate-400">
                              Advertised as <span className="font-mono">{device.advertisedHost}</span>
                            </p>
                          ) : null}
                          {!showsAdvertisedAlias && showsFallbackHost ? (
                            <p className="text-xs text-slate-400">
                              Reachable at <span className="font-mono">{device.launchHost}</span>
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="mr-4 hidden items-center gap-6 sm:flex">
                          <div className="text-right">
                            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Database</span>
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-sm capitalize text-slate-700">{device.database}</span>
                              <div
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  device.database === "ok" ? "bg-blue-500" : "bg-amber-500",
                                )}
                              />
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                              Initialized
                            </span>
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-sm text-slate-700">{initializedLabel}</span>
                              <div
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  device.initialized === true
                                    ? "bg-blue-500"
                                    : device.initialized === false
                                      ? "bg-amber-500"
                                      : "bg-slate-300",
                                )}
                              />
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                              MQTT Broker
                            </span>
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-sm capitalize text-slate-700">{device.mqtt}</span>
                              <div
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  device.mqtt === "connected" ? "bg-blue-500" : "bg-amber-500",
                                )}
                              />
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Web App</span>
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-sm capitalize text-slate-700">{device.websiteStatus}</span>
                              <div
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  isWebsiteOnline ? "bg-blue-500" : "bg-rose-500",
                                )}
                              />
                            </div>
                          </div>
                        </div>
                        <div
                          className={cn(
                            "rounded-full border p-2 transition-colors",
                            isWebsiteOnline
                              ? "border-slate-200 bg-white group-hover:border-blue-500/30 group-hover:bg-blue-500/10"
                              : "border-slate-200 bg-white",
                          )}
                        >
                          <ArrowRight
                            className={cn(
                              "h-5 w-5",
                              isWebsiteOnline ? "text-slate-500 group-hover:text-blue-600" : "text-slate-400",
                            )}
                          />
                        </div>
                      </div>
                    </>
                  );

                  if (isWebsiteOnline) {
                    return (
                      <a
                        key={`${device.displayHost}:${device.port ?? ""}`}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className={cardClassName}
                      >
                        {cardContent}
                      </a>
                    );
                  }

                  return (
                    <div key={`${device.displayHost}:${device.port ?? ""}`} className={cardClassName}>
                      {cardContent}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </main>

      <footer className="mt-auto border-t border-slate-200 py-6 text-center text-sm text-slate-500">
        &copy; {new Date().getFullYear()} E-Connect System. All rights reserved.
      </footer>
    </div>
  );
}
