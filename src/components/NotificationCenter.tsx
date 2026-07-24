"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface Notification {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
  time: string;
  read: boolean;
}

interface NotifContextType {
  notifications: Notification[];
  unreadCount: number;
  add: (type: Notification["type"], title: string, message?: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

const NotifContext = createContext<NotifContextType | null>(null);

export function useNotifications() {
  const ctx = useContext(NotifContext);
  if (!ctx) throw new Error("useNotifications must be inside NotificationProvider");
  return ctx;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const add = useCallback((type: Notification["type"], title: string, message?: string) => {
    const n: Notification = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, type, title, message, time: new Date().toISOString(), read: false };
    setNotifications((prev) => [n, ...prev].slice(0, 50));
  }, []);

  const markAllRead = useCallback(() => { setNotifications((prev) => prev.map((n) => ({ ...n, read: true }))); }, []);
  const clear = useCallback(() => { setNotifications([]); }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return <NotifContext.Provider value={{ notifications, unreadCount, add, markAllRead, clear }}>{children}</NotifContext.Provider>;
}

const ICONS: Record<string, string> = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead, clear } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => { setOpen(!open); if (!open) markAllRead(); }} className="relative p-2 bg-bg-secondary border border-border hover:bg-bg-hover rounded-lg transition-colors">
        <span className="text-base">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">{unreadCount > 9 ? "9+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 w-80 bg-bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-sm">Notifications</h3>
              <div className="flex gap-2">
                {notifications.length > 0 && <button onClick={clear} className="text-[10px] text-text-muted hover:text-danger">Clear all</button>}
                <button onClick={() => setOpen(false)} className="text-text-muted text-xs">✕</button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-text-muted text-sm">No notifications yet</div>
              ) : notifications.map((n) => (
                <div key={n.id} className={`px-4 py-3 border-b border-border/50 ${n.read ? "" : "bg-accent/5"}`}>
                  <div className="flex items-start gap-2">
                    <span className="text-sm">{ICONS[n.type]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{n.title}</p>
                      {n.message && <p className="text-xs text-text-muted mt-0.5 truncate">{n.message}</p>}
                      <p className="text-[10px] text-text-muted mt-1">{new Date(n.time).toLocaleTimeString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
