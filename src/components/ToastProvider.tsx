"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

const ICONS: Record<string, string> = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
const COLORS: Record<string, string> = {
  success: "bg-success/15 border-success/30 text-success",
  error: "bg-danger/15 border-danger/30 text-danger",
  warning: "bg-warning/15 border-warning/30 text-warning",
  info: "bg-accent/15 border-accent/30 text-accent",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newToast = { ...toast, id };
    setToasts((prev) => [...prev.slice(-4), newToast]); // max 5 toasts
    const dur = toast.duration ?? (toast.type === "error" ? 8000 : 4000);
    if (dur > 0) setTimeout(() => removeToast(id), dur);
  }, [removeToast]);

  const success = useCallback((title: string, message?: string) => addToast({ type: "success", title, message }), [addToast]);
  const error = useCallback((title: string, message?: string) => addToast({ type: "error", title, message, duration: 8000 }), [addToast]);
  const warning = useCallback((title: string, message?: string) => addToast({ type: "warning", title, message }), [addToast]);
  const info = useCallback((title: string, message?: string) => addToast({ type: "info", title, message }), [addToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
      {children}

      {/* Toast container — fixed bottom-right */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto animate-fade-in border rounded-xl p-4 shadow-xl backdrop-blur-sm ${COLORS[toast.type]}`}
          >
            <div className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0">{ICONS[toast.type]}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{toast.title}</p>
                {toast.message && <p className="text-xs mt-0.5 opacity-80 whitespace-pre-wrap">{toast.message}</p>}
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="text-xs opacity-50 hover:opacity-100 flex-shrink-0 mt-0.5"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
