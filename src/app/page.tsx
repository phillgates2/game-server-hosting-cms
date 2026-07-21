"use client";

import { useEffect, useState } from "react";
import InstallWizard from "@/components/InstallWizard";
import LoginForm from "@/components/LoginForm";
import Dashboard from "@/components/Dashboard";

type AppState = "loading" | "install" | "login" | "dashboard";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

export default function Home() {
  const [state, setState] = useState<AppState>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      // Check if installed
      const installRes = await fetch("/api/install");
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
    } catch {
      setState("install");
    }
  }

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-text-secondary">Loading GameServer Manager...</p>
        </div>
      </div>
    );
  }

  if (state === "install") {
    return <InstallWizard onComplete={() => checkStatus()} />;
  }

  if (state === "login") {
    return (
      <LoginForm
        onLogin={(u: AuthUser) => {
          setUser(u);
          setState("dashboard");
        }}
      />
    );
  }

  return <Dashboard user={user!} onLogout={() => { setUser(null); setState("login"); }} />;
}
