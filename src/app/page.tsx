"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ErrorBoundary from "@/components/ErrorBoundary";
import InstallWizard from "@/components/InstallWizard";
import LoginForm from "@/components/LoginForm";
import Dashboard from "@/components/Dashboard";
import PublicSite from "@/components/PublicSite";
import {
  BOOT_TIMEOUT_MS,
  classifyBootFailure,
  classifyInstallResponse,
  isTimeoutError,
} from "@/lib/app-boot";
import { fetchWithTimeout } from "@/lib/api-client";
import { SESSION_EXPIRED_EVENT, installSessionExpiryWatch } from "@/lib/session-expiry";

type AppState =
  | "loading"
  | "install"
  | "unreachable"
  | "public"
  | "login"
  | "dashboard";

interface AuthUser {
  id: number;
  username: string;
  role: string;
  roleName?: string;
  roleColor?: string;
  roleIcon?: string;
}

const primaryButton =
  "px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors";
const secondaryButton =
  "px-4 py-2 rounded-lg text-sm font-medium bg-bg-tertiary text-text-secondary border border-border hover:bg-bg-hover disabled:opacity-40 transition-colors";

function BrandMark({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="text-3xl" aria-hidden>
        🎮
      </span>
      <p className="text-sm font-semibold tracking-wide">GameServer Manager</p>
      <p className="text-xs text-text-muted">{subtitle}</p>
    </div>
  );
}

function HomeContent() {
  const [state, setState] = useState<AppState>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootMessage, setBootMessage] = useState("");
  const [retrying, setRetrying] = useState(false);
  // Set when any panel request comes back 401: the session ended while the tab
  // was open, which is otherwise indistinguishable from "the button is broken".
  const [sessionExpired, setSessionExpired] = useState(false);
  // A retry clicked twice (or a reconnect arriving mid-flight) must not run two
  // boot probes that race each other into different states.
  const inFlight = useRef(false);

  const checkStatus = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRetrying(true);
    try {
      const installRes = await fetchWithTimeout(
        "/api/install",
        { cache: "no-store" },
        BOOT_TIMEOUT_MS
      );
      const installData = await installRes.json().catch(() => null);
      const outcome = classifyInstallResponse(installRes.status, installData);

      if (outcome.kind === "install") {
        setState("install");
        return;
      }
      if (outcome.kind === "unreachable") {
        setBootMessage(outcome.message);
        setState("unreachable");
        return;
      }

      // Installed. Now ask who is signed in — but a failure here is not a
      // reason to keep anybody off the public site, so it degrades to
      // "signed out" rather than to the unreachable screen.
      try {
        const meRes = await fetchWithTimeout(
          "/api/auth/me",
          { cache: "no-store" },
          BOOT_TIMEOUT_MS
        );
        if (meRes.ok) {
          const meData = await meRes.json();
          setUser((meData?.user as AuthUser) ?? null);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      }

      // Always show the public site — users click "Control Panel" to enter the
      // dashboard. This keeps the public homepage as the default landing page.
      setState("public");
    } catch (error) {
      const outcome = classifyBootFailure({
        online: typeof navigator === "undefined" ? true : navigator.onLine,
        timedOut: isTimeoutError(error),
      });
      setBootMessage(outcome.kind === "unreachable" ? outcome.message : "");
      setState("unreachable");
    } finally {
      inFlight.current = false;
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    // Deferred one turn so the first paint happens before the probe's state
    // updates, matching the pattern used elsewhere in the app.
    const timer = window.setTimeout(() => {
      void checkStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkStatus]);

  // Coming back online is the most common reason the probe failed, so retry
  // without making the operator press anything.
  useEffect(() => {
    if (state !== "unreachable") return;
    const onOnline = () => void checkStatus();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [state, checkStatus]);

  // While the dashboard is open, watch for an expired session and say so once.
  useEffect(() => {
    if (state !== "dashboard") return;
    const uninstall = installSessionExpiryWatch();
    const onExpired = () => setSessionExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      uninstall();
    };
  }, [state]);

  async function handleLogin(u: AuthUser) {
    setSessionExpired(false);
    try {
      const meRes = await fetchWithTimeout("/api/auth/me", { cache: "no-store" });
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.user) {
          setUser(meData.user);
          setState("public");
          return;
        }
      }
    } catch {
      /* fall through to the values the form already verified */
    }
    setUser(u);
    // Stay on the public site after login — the Control Panel button is the
    // way in.
    setState("public");
  }

  function handleLogout() {
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setState("public");
  }

  if (state === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <BrandMark subtitle="Starting up…" />
        <div
          className="inline-block h-9 w-9 animate-spin rounded-full border-4 border-accent border-t-transparent"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (state === "unreachable") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-danger/30 bg-bg-card p-6 text-center">
          <span className="block text-3xl" aria-hidden>
            📡
          </span>
          <h1 className="text-lg font-semibold">Can&apos;t reach the panel</h1>
          <p
            className="text-sm text-text-secondary"
            role="alert"
            aria-live="polite"
          >
            {bootMessage || "The panel did not answer."}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => void checkStatus()}
              disabled={retrying}
              className={primaryButton}
            >
              {retrying ? "Trying again…" : "Try again"}
            </button>
            <Link href="/status" className={secondaryButton}>
              Status page
            </Link>
          </div>
          <p className="text-[11px] leading-relaxed text-text-muted">
            The setup wizard only appears when the panel itself reports that it
            is not installed — a failed request is never treated as a fresh
            install. If the panel is managed by PM2, check{" "}
            <code className="text-text-secondary">pm2 status</code> and the
            panel logs.
          </p>
        </div>
      </div>
    );
  }

  if (state === "install") {
    return (
      <ErrorBoundary name="Install">
        <InstallWizard onComplete={() => checkStatus()} />
      </ErrorBoundary>
    );
  }

  if (state === "login") {
    return (
      <ErrorBoundary name="Login">
        <LoginForm onLogin={handleLogin} />
      </ErrorBoundary>
    );
  }

  if (state === "dashboard" && user) {
    return (
      <>
        <ErrorBoundary name="Dashboard">
          <Dashboard
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setState("public")}
          />
        </ErrorBoundary>
        {sessionExpired && (
          <div className="fixed inset-x-0 bottom-0 z-[120] p-3 sm:p-4">
            <div
              role="alert"
              className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-bg-card/95 px-4 py-3 shadow-2xl backdrop-blur"
            >
              <span aria-hidden>🔒</span>
              <p className="min-w-0 flex-1 text-sm text-text-secondary">
                <span className="font-medium text-warning">Your session has expired.</span>{" "}
                You can keep reading, but nothing you change will be saved until
                you sign in again.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSessionExpired(false);
                  setState("login");
                }}
                className={primaryButton}
              >
                Sign in again
              </button>
              <button
                type="button"
                onClick={() => setSessionExpired(false)}
                className="text-xs text-text-muted transition-colors hover:text-text-primary"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <ErrorBoundary name="PublicSite">
      <PublicSite
        user={user}
        onLoginClick={() => setState("login")}
        onDashboardClick={() => setState("dashboard")}
        onLogout={handleLogout}
      />
    </ErrorBoundary>
  );
}

function BootFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <BrandMark subtitle="Starting up…" />
      <div
        className="inline-block h-9 w-9 animate-spin rounded-full border-4 border-accent border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<BootFallback />}>
      <HomeContent />
    </Suspense>
  );
}
