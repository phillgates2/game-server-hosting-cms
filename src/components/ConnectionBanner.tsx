"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "./ToastProvider";

/**
 * Offline / reconnect banner.
 *
 * The panel is a browser app against a server that may be on another machine,
 * behind a proxy, or on a laptop whose Wi-Fi just dropped. When the connection
 * goes away every action silently fails or hangs, and the operator is left
 * wondering whether the panel is broken. Browsers already know the answer —
 * `navigator.onLine` plus the online/offline events — so say it plainly, and
 * confirm when it comes back.
 */
export default function ConnectionBanner() {
  const { success } = useToast();
  const [online, setOnline] = useState(true);
  const [restored, setRestored] = useState(false);
  // A ref, not state: the `online` handler must see the latest value without
  // being re-subscribed on every render.
  const wasOffline = useRef(false);

  useEffect(() => {
    // Deferred so the first paint is not a hydration mismatch: the server has
    // no idea whether the browser is online.
    const timer = window.setTimeout(() => setOnline(navigator.onLine), 0);

    const handleOffline = () => {
      wasOffline.current = true;
      setRestored(false);
      setOnline(false);
    };
    const handleOnline = () => {
      setOnline(true);
      if (!wasOffline.current) return;
      wasOffline.current = false;
      setRestored(true);
      success(
        "Back online",
        "The connection is working again. Anything that failed while you were offline can be retried."
      );
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [success]);

  useEffect(() => {
    if (!restored) return;
    const timer = window.setTimeout(() => setRestored(false), 4000);
    return () => window.clearTimeout(timer);
  }, [restored]);

  if (online && !restored) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[130] flex items-center justify-center gap-2 px-4 py-1.5 text-center text-[11px] font-semibold sm:text-xs ${
        online ? "bg-success text-black" : "bg-warning text-black"
      }`}
    >
      <span aria-hidden>{online ? "✅" : "📴"}</span>
      {online
        ? "Back online — the panel can reach the server again."
        : "You’re offline — the panel can’t load or save anything until the connection returns."}
    </div>
  );
}
