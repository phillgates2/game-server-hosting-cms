"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

interface SidebarProps {
  user: { userId: number; username: string; email: string; role: string } | null;
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/servers", label: "Game Servers", icon: "🖥️" },
  { href: "/servers/create", label: "New Server", icon: "➕" },
  { href: "/forum", label: "Forum", icon: "💬" },
  { href: "/plans", label: "Plans", icon: "📦" },
];

const adminItems = [
  { href: "/admin", label: "Admin Panel", icon: "⚙️" },
  { href: "/admin/monitor", label: "Server Monitor", icon: "📡" },
  { href: "/admin/network", label: "Network / IPv6", icon: "🔗" },
  { href: "/admin/users", label: "Users", icon: "👥" },
  { href: "/admin/nodes", label: "Nodes", icon: "🌐" },
  { href: "/admin/games", label: "Games", icon: "🎮" },
];

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <aside className={`${collapsed ? "w-16" : "w-64"} h-screen bg-dark-800 border-r border-dark-600 flex flex-col transition-all duration-300 fixed left-0 top-0 z-40`}>
      {/* Logo */}
      <div className="p-4 border-b border-dark-600">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center text-xl flex-shrink-0">
            🎮
          </div>
          {!collapsed && (
            <span className="text-lg font-bold bg-gradient-to-r from-brand-400 to-accent-400 bg-clip-text text-transparent">
              GamePanel
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {!collapsed && <div className="text-xs text-dark-400 uppercase tracking-wider px-3 py-2">Main Menu</div>}
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
              pathname === item.href
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                : "text-dark-300 hover:bg-dark-700 hover:text-white"
            }`}
          >
            <span className="text-lg flex-shrink-0">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </Link>
        ))}

        {user?.role === "admin" && (
          <>
            {!collapsed && <div className="text-xs text-dark-400 uppercase tracking-wider px-3 py-2 mt-4">Administration</div>}
            {adminItems.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                  pathname === item.href
                    ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                    : "text-dark-300 hover:bg-dark-700 hover:text-white"
                }`}
              >
                <span className="text-lg flex-shrink-0">{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* User Section */}
      <div className="p-3 border-t border-dark-600">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full px-3 py-2 text-dark-400 hover:text-white text-sm rounded-lg hover:bg-dark-700 transition-all mb-2 text-left"
        >
          {collapsed ? "→" : "← Collapse"}
        </button>
        {user && (
          <div className={`${collapsed ? "px-1" : "px-3"} py-2`}>
            {!collapsed && (
              <div className="mb-2">
                <div className="text-sm font-medium text-white">{user.username}</div>
                <div className="text-xs text-dark-400">{user.role}</div>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="w-full px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
            >
              {collapsed ? "🚪" : "Logout"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
