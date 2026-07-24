"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmContextType {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ctx.confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ opts, resolve });
    });
  }, []);

  function handleClose(result: boolean) {
    pending?.resolve(result);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => handleClose(false)}>
          <div className="bg-bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="text-lg font-bold mb-2">{pending.opts.title}</h3>
              <p className="text-text-secondary text-sm whitespace-pre-wrap">{pending.opts.message}</p>
            </div>
            <div className="flex gap-3 p-4 pt-0 justify-end">
              <button onClick={() => handleClose(false)} className="px-4 py-2 bg-bg-secondary border border-border text-text-primary rounded-lg text-sm font-medium hover:bg-bg-hover transition-colors">
                {pending.opts.cancelLabel || "Cancel"}
              </button>
              <button onClick={() => handleClose(true)} className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${pending.opts.danger ? "bg-danger hover:opacity-90" : "bg-accent hover:bg-accent-hover"}`}>
                {pending.opts.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
