import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users, gameServers, nodes, games, forumTopics } from "@/db/schema";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const [serverCount] = await db.select({ count: sql<number>`count(*)` }).from(gameServers);
  const [nodeCount] = await db.select({ count: sql<number>`count(*)` }).from(nodes);
  const [gameCount] = await db.select({ count: sql<number>`count(*)` }).from(games);
  const [topicCount] = await db.select({ count: sql<number>`count(*)` }).from(forumTopics);

  const recentUsers = await db.select({
    id: users.id,
    username: users.username,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
  }).from(users).orderBy(sql`created_at DESC`).limit(5);

  const stats = [
    { label: "Total Users", value: Number(userCount.count), icon: "👥", color: "from-brand-500/20 to-brand-600/10", href: "/admin/users" },
    { label: "Game Servers", value: Number(serverCount.count), icon: "🖥️", color: "from-green-500/20 to-green-600/10", href: "/servers" },
    { label: "Nodes", value: Number(nodeCount.count), icon: "🌐", color: "from-accent-500/20 to-accent-600/10", href: "/admin/nodes" },
    { label: "Games", value: Number(gameCount.count), icon: "🎮", color: "from-purple-500/20 to-purple-600/10", href: "/admin/games" },
    { label: "Forum Topics", value: Number(topicCount.count), icon: "💬", color: "from-amber-500/20 to-amber-600/10", href: "/forum" },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
        <p className="text-dark-300 mt-1">System overview and management</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {stats.map((stat, i) => (
          <Link
            key={i}
            href={stat.href}
            className={`glass-card rounded-2xl p-5 bg-gradient-to-br ${stat.color} hover:border-brand-500/40 transition-all group`}
          >
            <div className="text-2xl mb-2">{stat.icon}</div>
            <div className="text-3xl font-bold text-white">{stat.value}</div>
            <div className="text-dark-300 text-sm">{stat.label}</div>
          </Link>
        ))}
      </div>

      {/* Quick Actions & Recent Users */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Manage Users", icon: "👥", href: "/admin/users" },
              { label: "Manage Nodes", icon: "🌐", href: "/admin/nodes" },
              { label: "Manage Games", icon: "🎮", href: "/admin/games" },
              { label: "Create Server", icon: "➕", href: "/servers/create" },
              { label: "View Forum", icon: "💬", href: "/forum" },
              { label: "View Plans", icon: "📦", href: "/plans" },
            ].map((action, i) => (
              <Link
                key={i}
                href={action.href}
                className="p-4 bg-dark-700/50 rounded-xl hover:bg-dark-700 transition-all text-center group"
              >
                <div className="text-2xl mb-1 group-hover:scale-110 transition-transform">{action.icon}</div>
                <div className="text-sm text-dark-300">{action.label}</div>
              </Link>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">Recent Users</h3>
          <div className="space-y-3">
            {recentUsers.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 bg-dark-700/50 rounded-xl">
                <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center text-sm font-bold text-brand-400">
                  {u.username[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">{u.username}</div>
                  <div className="text-xs text-dark-400">{u.email}</div>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  u.role === "admin" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                }`}>
                  {u.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
