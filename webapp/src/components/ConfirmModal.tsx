/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import React from "react";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "warning" | "info";
  isLoading?: boolean;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  cancelText = "Cancel",
  type = "danger",
  isLoading = false,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const getTypeStyles = () => {
    switch (type) {
      case "danger":
        return "bg-rose-500 hover:bg-rose-600 shadow-rose-500/20";
      case "warning":
        return "bg-amber-500 hover:bg-amber-600 shadow-amber-500/20";
      default:
        return "bg-primary hover:bg-primary-dark shadow-primary/20";
    }
  };

  const getIcon = () => {
    switch (type) {
      case "danger": return "report_problem";
      case "warning": return "warning";
      default: return "help_outline";
    }
  };

  const getIconColor = () => {
    switch (type) {
      case "danger": return "text-rose-500 bg-rose-50 dark:bg-rose-500/10";
      case "warning": return "text-amber-500 bg-amber-50 dark:bg-amber-500/10";
      default: return "text-primary bg-primary/10";
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={onCancel}
      />
      
      <div className="relative w-full max-w-md scale-100 transform overflow-hidden rounded-2xl bg-white p-6 shadow-2xl transition-all dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${getIconColor()}`}>
            <span className="material-icons-round text-2xl">{getIcon()}</span>
          </div>
          
          <div className="flex-1">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              {title}
            </h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
          >
            {cancelText}
          </button>
          
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all disabled:opacity-50 ${getTypeStyles()}`}
          >
            {isLoading ? (
              <span className="material-icons-round animate-spin text-lg">refresh</span>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
