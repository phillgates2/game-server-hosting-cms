"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import InstallWizard from "@/components/InstallWizard";
import LoginForm from "@/components/LoginForm";
import Dashboard from "@/components/Dashboard";
import PublicSite from "@/components/PublicSite";

type AppState = "loading" | "install" | "public" | "login" | "dashboard";

interface AuthUser {
  id: number;
  username: string;
  role: string;
  roleName?: string;
  roleColor?: string;
  roleIcon?: string;
}

function HomeContent() {
  const [state, setState] = useState<AppState>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const installRes = await fetch("/api/install");
      if (!installRes.ok) { setState("install"); return; }
      const installData = await installRes.json();
      if (!installData.installed) { setState("install"); return; }

      // Installed — check if user is logged in
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.user) {
          setUser(meData.user as AuthUser);
        }
      } else {
        setUser(null);
      }

      // Always show the public site — users click "Control Panel" to
      // enter the dashboard.  This keeps the public homepage as the
      // default landing page for everyone.
      setState("public");
    } catch {
      setState("install");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkStatus]);

  async function handleLogin(u: AuthUser) {
    try {
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.user) { setUser(meData.user); setState("public"); return; }
      }
    } catch { /* fall through */ }
    setUser(u);
    // Stay on the public site after login — user clicks "Control Panel"
    // when they're ready to manage servers
    setState("public");
  }

  function handleLogout() {
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setState("public");
  }

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="inline-block w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state === "install") {
    return <ErrorBoundary name="Install"><InstallWizard onComplete={() => checkStatus()} /></ErrorBoundary>;
  }

  if (state === "login") {
    return <ErrorBoundary name="Login"><LoginForm onLogin={handleLogin} /></ErrorBoundary>;
  }

  if (state === "dashboard" && user) {
    return <ErrorBoundary name="Dashboard"><Dashboard user={user} onLogout={handleLogout} onGoHome={() => setState("public")} /></ErrorBoundary>;
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

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="inline-block w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
      <HomeContent />
    </Suspense>
  );
}
