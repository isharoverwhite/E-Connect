"use client";

import React from "react";
import { Toast, ToastType } from "./ToastContext";

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const getIcon = (type: ToastType) => {
    switch (type) {
      case "success": return "check_circle";
      case "error": return "error";
      case "warning": return "warning";
      default: return "info";
    }
  };

  const getTypeStyles = (type: ToastType) => {
    switch (type) {
      case "success":
        return "bg-emerald-500/90 text-white shadow-emerald-500/20";
      case "error":
        return "bg-rose-500/90 text-white shadow-rose-500/20";
      case "warning":
        return "bg-amber-500/90 text-white shadow-amber-500/20";
      default:
        return "bg-blue-500/90 text-white shadow-blue-500/20";
    }
  };

  return (
    <div
      className={`
        pointer-events-auto
        flex items-center gap-3 px-4 py-3 min-w-[300px] max-w-md
        rounded-xl shadow-xl backdrop-blur-md border border-white/20
        animate-slide-in
        ${getTypeStyles(toast.type)}
      `}
    >
      <span className="material-icons-round text-2xl">
        {getIcon(toast.type)}
      </span>
      <div className="flex-1 text-sm font-medium leading-tight">
        {toast.message}
      </div>
      <button 
        onClick={() => onRemove(toast.id)}
        className="ml-2 p-1 rounded-full hover:bg-white/20 transition-colors"
      >
        <span className="material-icons-round text-lg">close</span>
      </button>
    </div>
  );
}
