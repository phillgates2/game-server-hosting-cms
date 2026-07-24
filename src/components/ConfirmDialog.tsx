"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmChoiceOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  choices: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
  defaultChoice?: string;
}

interface ConfirmChoiceResult {
  confirmed: boolean;
  choice: string;
}

interface ConfirmContextType {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  confirmChoice: (opts: ConfirmChoiceOptions) => Promise<ConfirmChoiceResult>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ctx.confirm;
}

export function useConfirmChoice() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirmChoice must be used inside ConfirmProvider");
  return ctx.confirmChoice;
}

type PendingState =
  | { kind: "boolean"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "choice"; opts: ConfirmChoiceOptions; resolve: (v: ConfirmChoiceResult) => void; choice: string };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ kind: "boolean", opts, resolve });
    });
  }, []);

  const confirmChoice = useCallback((opts: ConfirmChoiceOptions): Promise<ConfirmChoiceResult> => {
    return new Promise((resolve) => {
      setPending({ kind: "choice", opts, resolve, choice: opts.defaultChoice || opts.choices[0]?.value || "" });
    });
  }, []);

  function handleCloseBoolean(result: boolean) {
    if (pending?.kind === "boolean") pending.resolve(result);
    setPending(null);
  }

  function handleCloseChoice(confirmed: boolean) {
    if (pending?.kind === "choice") pending.resolve({ confirmed, choice: pending.choice });
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm, confirmChoice }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => pending.kind === "boolean" ? handleCloseBoolean(false) : handleCloseChoice(false)}>
          <div className="bg-bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-lg font-bold mb-2">{pending.opts.title}</h3>
                <p className="text-text-secondary text-sm whitespace-pre-wrap">{pending.opts.message}</p>
              </div>

              {pending.kind === "choice" && (
                <div className="space-y-2">
                  {pending.opts.choices.map((c) => (
                    <label key={c.value} className={`block rounded-xl border p-3 cursor-pointer transition-colors ${pending.choice === c.value ? "border-accent bg-accent/10" : "border-border hover:border-accent/30 bg-bg-secondary/40"}`}>
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="confirm-choice"
                          checked={pending.choice === c.value}
                          onChange={() => setPending((prev) => prev && prev.kind === "choice" ? { ...prev, choice: c.value } : prev)}
                          className="mt-1 accent-[var(--color-accent)]"
                        />
                        <div>
                          <p className="text-sm font-medium">{c.label}</p>
                          {c.description && <p className="text-xs text-text-muted mt-0.5">{c.description}</p>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-3 p-4 pt-0 justify-end">
              <button
                onClick={() => pending.kind === "boolean" ? handleCloseBoolean(false) : handleCloseChoice(false)}
                className="px-4 py-2 bg-bg-secondary border border-border text-text-primary rounded-lg text-sm font-medium hover:bg-bg-hover transition-colors"
              >
                {pending.opts.cancelLabel || "Cancel"}
              </button>
              <button
                onClick={() => pending.kind === "boolean" ? handleCloseBoolean(true) : handleCloseChoice(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${pending.opts.danger ? "bg-danger hover:opacity-90" : "bg-accent hover:bg-accent-hover"}`}
              >
                {pending.opts.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
