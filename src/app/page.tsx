"use client";

import { useEffect, useState, useCallback } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import InstallWizard from "@/components/InstallWizard";
import LoginForm from "@/components/LoginForm";
import Dashboard from "@/components/Dashboard";

type AppState = "loading" | "install" | "login" | "dashboard" | "error";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

export default function Home() {
  const [state, setState] = useState<AppState>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const checkStatus = useCallback(async () => {
    try {
      setState("loading");
      setErrorMsg("");

      // Check if installed
      const installRes = await fetch("/api/install");
      if (!installRes.ok) {
        throw new Error(`Install check failed: ${installRes.status}`);
      }
      const installData = await installRes.json();

      if (!installData.installed) {
        setState("install");
        return;
      }

      // Check if logged in
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.user) {
          setUser(meData.user);
          setState("dashboard");
          return;
        }
      }

      setState("login");
    } catch (e: unknown) {
      console.error("checkStatus error:", e);
      setErrorMsg(e instanceof Error ? e.message : "Failed to connect to server");
      setState("install");
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  function handleLogin(u: AuthUser) {
    setUser(u);
    setState("dashboard");
  }

  function handleLogout() {
    setUser(null);
    setState("login");
  }

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-text-secondary">Loading GameServer Manager...</p>
          {errorMsg && (
            <p className="text-danger text-xs mt-2">{errorMsg}</p>
          )}
        </div>
      </div>
    );
  }

  if (state === "install") {
    return (
      <ErrorBoundary name="InstallWizard">
        <InstallWizard onComplete={() => checkStatus()} />
      </ErrorBoundary>
    );
  }

  if (state === "login") {
    return (
      <ErrorBoundary name="LoginForm">
        <LoginForm onLogin={handleLogin} />
      </ErrorBoundary>
    );
  }

  if (!user) {
    // Safety: if somehow we're in dashboard state without a user, go to login
    setState("login");
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="inline-block w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ErrorBoundary name="Dashboard">
      <Dashboard user={user} onLogout={handleLogout} />
    </ErrorBoundary>
  );
}
