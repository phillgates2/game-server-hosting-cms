"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

interface ToastItem {
  id: number;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toast: (type: ToastItem["type"], title: string, message?: string, duration?: number) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((type: ToastItem["type"], title: string, message?: string, duration?: number) => {
    const id = ++nextId;
    const dur = duration ?? (type === "error" ? 8000 : 4000);
    setToasts((prev) => [...prev.slice(-4), { id, type, title, message, duration: dur }]);
    if (dur > 0) setTimeout(() => removeToast(id), dur);
  }, [removeToast]);

  const value: ToastContextType = {
    toast,
    success: (title, message) => toast("success", title, message),
    error: (title, message) => toast("error", title, message),
    info: (title, message) => toast("info", title, message),
    warning: (title, message) => toast("warning", title, message),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2 pointer-events-none max-w-md w-full">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

const ICONS: Record<string, string> = { success: "✅", error: "❌", info: "ℹ️", warning: "⚠️" };
const COLORS: Record<string, string> = {
  success: "border-success/40 bg-success/10",
  error: "border-danger/40 bg-danger/10",
  info: "border-accent/40 bg-accent/10",
  warning: "border-warning/40 bg-warning/10",
};
const TEXT: Record<string, string> = { success: "text-success", error: "text-danger", info: "text-accent", warning: "text-warning" };

function ToastCard({ toast: t, onClose }: { toast: ToastItem; onClose: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setShow(true)); }, []);

  return (
    <div
      className={`pointer-events-auto border rounded-xl px-4 py-3 shadow-lg backdrop-blur-md transition-all duration-300 ${COLORS[t.type]} ${show ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0">{ICONS[t.type]}</span>
        <div className="flex-1 min-w-0">
          <p className={`font-medium text-sm ${TEXT[t.type]}`}>{t.title}</p>
          {t.message && <p className="text-xs text-text-secondary mt-0.5 whitespace-pre-wrap">{t.message}</p>}
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xs flex-shrink-0 mt-0.5">✕</button>
      </div>
    </div>
  );
}
