"use client";

import { useEffect, useState, useCallback } from "react";
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

export default function Home() {
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
          setUser(meData.user);
          setState("dashboard");
          return;
        }
      }

      // Not logged in — show public site
      setState("public");
    } catch {
      setState("install");
    }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  async function handleLogin(u: AuthUser) {
    try {
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.user) { setUser(meData.user); setState("dashboard"); return; }
      }
    } catch { /* fall through */ }
    setUser(u);
    setState("dashboard");
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
    return <ErrorBoundary name="Dashboard"><Dashboard user={user} onLogout={handleLogout} /></ErrorBoundary>;
  }

  return (
    <ErrorBoundary name="PublicSite">
      <PublicSite onLoginClick={() => setState("login")} />
    </ErrorBoundary>
  );
}
