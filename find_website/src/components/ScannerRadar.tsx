import React from "react";
import { cn } from "@/lib/utils";
import { Radar } from "lucide-react";

interface ScannerRadarProps {
  isScanning: boolean;
  className?: string;
}

export function ScannerRadar({ isScanning, className }: ScannerRadarProps) {
  return (
    <div className={cn("relative flex items-center justify-center h-48 w-48", className)}>
      {/* Outer ripples */}
      {isScanning && (
        <>
          <div className="absolute inset-0 rounded-full border-2 border-emerald-500/30 animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_infinite]" />
          <div className="absolute inset-4 rounded-full border-2 border-emerald-400/40 animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_0.5s_infinite]" />
          <div className="absolute inset-8 rounded-full border-2 border-emerald-300/50 animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_1s_infinite]" />
        </>
      )}

      {/* Core */}
      <div 
        className={cn(
          "relative flex items-center justify-center h-24 w-24 rounded-full bg-slate-800 border-4 border-slate-700 z-10 shadow-2xl transition-all duration-500",
          isScanning ? "shadow-emerald-500/20 border-emerald-500/50" : ""
        )}
      >
        <Radar 
          className={cn(
            "w-10 h-10 transition-colors duration-500",
            isScanning ? "text-emerald-400 animate-pulse" : "text-slate-500"
          )} 
        />
      </div>
    </div>
  );
}
