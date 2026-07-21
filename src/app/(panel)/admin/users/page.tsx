import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const allUsers = await db.select({
    id: users.id,
    username: users.username,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
  }).from(users).orderBy(sql`created_at DESC`);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">User Management</h1>
          <p className="text-dark-300 mt-1">{allUsers.length} registered users</p>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-dark-600">
              <th className="text-left px-6 py-4 text-sm font-medium text-dark-300">User</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-dark-300">Email</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-dark-300">Role</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-dark-300">Joined</th>
            </tr>
          </thead>
          <tbody>
            {allUsers.map(u => (
              <tr key={u.id} className="border-b border-dark-700 hover:bg-dark-700/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-sm font-bold text-brand-400">
                      {u.username[0].toUpperCase()}
                    </div>
                    <span className="text-white font-medium">{u.username}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-dark-300 text-sm">{u.email}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    u.role === "admin" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                  }`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-dark-300 text-sm">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
