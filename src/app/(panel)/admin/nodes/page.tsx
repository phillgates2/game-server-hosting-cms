import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminNodesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const allNodes = await db.select().from(nodes);

  const statusColors: Record<string, string> = {
    online: "text-green-400 bg-green-500/10 border-green-500/30",
    offline: "text-red-400 bg-red-500/10 border-red-500/30",
    maintenance: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Node Management</h1>
          <p className="text-dark-300 mt-1">{allNodes.length} nodes configured</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {allNodes.map(node => (
          <div key={node.id} className="glass-card rounded-2xl p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-dark-600 flex items-center justify-center text-2xl">🌐</div>
                <div>
                  <h3 className="font-bold text-white text-lg">{node.name}</h3>
                  <p className="text-dark-300 text-sm font-mono">{node.ipAddress}:{node.port}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusColors[node.status] || statusColors.offline}`}>
                  {node.status}
                </span>
                {node.ip6Enabled && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-accent-500/20 text-accent-400 border border-accent-500/30">
                    IPv6
                  </span>
                )}
              </div>
            </div>

            {/* Addresses */}
            <div className="mb-4 space-y-2">
              <div className="flex items-center gap-2 p-2.5 bg-dark-700/50 rounded-lg">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 uppercase tracking-wider">v4</span>
                <code className="text-white text-sm font-mono flex-1 truncate">{node.ipAddress}</code>
              </div>
              {node.ip6Address ? (
                <div className="flex items-center gap-2 p-2.5 bg-dark-700/50 rounded-lg">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-500/20 text-accent-400 uppercase tracking-wider">v6</span>
                  <code className="text-accent-400 text-sm font-mono flex-1 truncate">{node.ip6Address}</code>
                  {node.ip6Enabled ? (
                    <span className="text-green-400 text-xs">●</span>
                  ) : (
                    <span className="text-dark-400 text-xs">○</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2.5 bg-dark-700/50 rounded-lg">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-dark-500/50 text-dark-400 uppercase tracking-wider">v6</span>
                  <span className="text-dark-400 text-sm italic">Not configured</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="p-3 bg-dark-700/50 rounded-xl">
                <div className="text-xs text-dark-400">Location</div>
                <div className="text-white font-medium mt-1">{node.location || "N/A"}</div>
              </div>
              <div className="p-3 bg-dark-700/50 rounded-xl">
                <div className="text-xs text-dark-400">Slot Usage</div>
                <div className="text-white font-medium mt-1">{node.usedSlots}/{node.maxSlots}</div>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-dark-300 mb-1">
                <span>Capacity</span>
                <span>{Math.round((node.usedSlots / node.maxSlots) * 100)}%</span>
              </div>
              <div className="w-full h-2 bg-dark-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-500 to-accent-500 rounded-full"
                  style={{ width: `${(node.usedSlots / node.maxSlots) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
