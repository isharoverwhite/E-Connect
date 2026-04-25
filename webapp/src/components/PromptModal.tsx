/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import React, { useState, useEffect, useRef } from "react";

interface PromptModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  initialValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  type?: "info" | "primary";
  isLoading?: boolean;
}

export default function PromptModal({
  isOpen,
  title,
  message,
  initialValue = "",
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  cancelText = "Cancel",
  type = "primary",
  isLoading = false,
}: PromptModalProps) {
  const [inputValue, setInputValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInputValue(initialValue);
      // focus slightly after render
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  const getTypeStyles = () => {
    switch (type) {
      case "primary":
      default:
        return "bg-primary hover:bg-primary-dark shadow-primary/20";
    }
  };

  const getIcon = () => {
    return "edit_note";
  };

  const getIconColor = () => {
    return "text-primary bg-primary/10";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    onConfirm(inputValue);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={onCancel}
      />
      
      <div className="relative w-full max-w-md scale-100 transform overflow-hidden rounded-2xl bg-white p-6 shadow-2xl transition-all dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        <form onSubmit={handleSubmit}>
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

          <div className="mt-6">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-slate-600 dark:bg-slate-700/50 dark:text-white dark:focus:border-primary"
              placeholder={title}
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
            >
              {cancelText}
            </button>
            
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className={`flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all disabled:opacity-50 ${getTypeStyles()}`}
            >
              {isLoading ? (
                <span className="material-icons-round animate-spin text-lg">refresh</span>
              ) : (
                confirmText
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
