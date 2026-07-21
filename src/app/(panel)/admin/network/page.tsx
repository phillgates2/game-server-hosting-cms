"use client";

import { useEffect, useState, useCallback } from "react";

interface IPv6Address {
  address: string;
  prefix: number;
  scope: string;
  iface: string;
  type: string;
}

interface NetworkInterface {
  name: string;
  ipv4: string[];
  ipv6: string[];
  mac: string;
  state: string;
  mtu: number;
}

interface IPv6Data {
  status: {
    enabled: boolean;
    supported: boolean;
    forwarding: boolean;
    addresses: IPv6Address[];
    interfaces: NetworkInterface[];
    defaultGateway6: string;
    dnsServers: string[];
  };
  connectivity: {
    reachable: boolean;
    latencyMs: number;
    target: string;
    error?: string;
  };
}

export default function NetworkPage() {
  const [data, setData] = useState<IPv6Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor/ipv6");
      const json = await res.json();
      setData(json);
    } catch {
      // error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRetest = async () => {
    setTesting(true);
    await fetchData();
    setTesting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-center py-16 text-dark-300">Failed to load network data</div>;
  }

  const { status, connectivity } = data;

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Network &amp; IPv6</h1>
          <p className="text-dark-300 mt-1">Dual-stack networking status and configuration</p>
        </div>
        <button
          onClick={handleRetest}
          disabled={testing}
          className="px-4 py-2 bg-dark-600 hover:bg-dark-500 text-white rounded-xl text-sm transition-all disabled:opacity-50"
        >
          {testing ? "Testing..." : "↻ Retest"}
        </button>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          {
            label: "IPv6 Kernel",
            value: status.supported ? "Supported" : "Unsupported",
            icon: "🧬",
            color: status.supported ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400",
          },
          {
            label: "IPv6 Status",
            value: status.enabled ? "Enabled" : "Disabled",
            icon: "🔌",
            color: status.enabled ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400",
          },
          {
            label: "Connectivity",
            value: connectivity.reachable ? `${connectivity.latencyMs}ms` : "Unreachable",
            icon: connectivity.reachable ? "🌍" : "🚫",
            color: connectivity.reachable ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
          },
          {
            label: "Forwarding",
            value: status.forwarding ? "Enabled" : "Disabled",
            icon: "↔️",
            color: status.forwarding ? "bg-accent-500/10 border-accent-500/30 text-accent-400" : "bg-dark-500/30 border-dark-400/30 text-dark-300",
          },
        ].map((card, i) => (
          <div key={i} className={`glass-card rounded-2xl p-5 border ${card.color}`}>
            <div className="text-2xl mb-2">{card.icon}</div>
            <div className={`text-lg font-bold ${card.color.split(" ").pop()}`}>{card.value}</div>
            <div className="text-dark-400 text-sm mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* IPv6 Addresses */}
        <div className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            🏷️ IPv6 Addresses
          </h3>
          {status.addresses.length === 0 ? (
            <div className="text-center py-8 text-dark-400">
              <div className="text-3xl mb-2">📭</div>
              <p>No IPv6 addresses detected</p>
            </div>
          ) : (
            <div className="space-y-3">
              {status.addresses.map((addr, i) => (
                <div key={i} className="p-3 bg-dark-700/50 rounded-xl">
                  <div className="flex items-center justify-between mb-1">
                    <code className="text-accent-400 text-sm font-mono truncate flex-1">{addr.address}/{addr.prefix}</code>
                    <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        addr.scope === "global" ? "bg-green-500/20 text-green-400" :
                        addr.scope === "link" ? "bg-blue-500/20 text-blue-400" :
                        addr.scope === "host" ? "bg-purple-500/20 text-purple-400" :
                        "bg-dark-500/20 text-dark-300"
                      }`}>
                        {addr.scope}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-dark-400">
                    Interface: <span className="text-dark-300">{addr.iface}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Routing & DNS */}
        <div className="space-y-6">
          <div className="glass-card rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              🛤️ IPv6 Routing
            </h3>
            <div className="space-y-3">
              <div className="p-3 bg-dark-700/50 rounded-xl">
                <div className="text-xs text-dark-400 mb-1">Default Gateway</div>
                <code className="text-white text-sm font-mono">
                  {status.defaultGateway6 || "No default IPv6 gateway"}
                </code>
              </div>
              <div className="p-3 bg-dark-700/50 rounded-xl">
                <div className="text-xs text-dark-400 mb-1">Connectivity Test</div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${connectivity.reachable ? "bg-green-400" : "bg-red-400"}`} />
                  <span className="text-white text-sm">
                    {connectivity.reachable
                      ? `${connectivity.target} reachable (${connectivity.latencyMs}ms)`
                      : connectivity.error || "IPv6 not reachable"
                    }
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              📡 DNS Servers
            </h3>
            {status.dnsServers.length === 0 ? (
              <p className="text-dark-400 text-sm">No DNS servers detected</p>
            ) : (
              <div className="space-y-2">
                {status.dnsServers.map((dns, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 bg-dark-700/50 rounded-lg">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      dns.includes(":") ? "bg-accent-500/20 text-accent-400" : "bg-blue-500/20 text-blue-400"
                    }`}>
                      {dns.includes(":") ? "v6" : "v4"}
                    </span>
                    <code className="text-white text-sm font-mono">{dns}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Network Interfaces */}
      <div className="glass-card rounded-2xl p-6 mb-8">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          🖧 Network Interfaces
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600">
                <th className="text-left px-4 py-3 text-dark-400 font-medium">Interface</th>
                <th className="text-left px-4 py-3 text-dark-400 font-medium">State</th>
                <th className="text-left px-4 py-3 text-dark-400 font-medium">IPv4</th>
                <th className="text-left px-4 py-3 text-dark-400 font-medium">IPv6</th>
                <th className="text-left px-4 py-3 text-dark-400 font-medium">MAC</th>
                <th className="text-right px-4 py-3 text-dark-400 font-medium">MTU</th>
              </tr>
            </thead>
            <tbody>
              {status.interfaces.map((iface, i) => (
                <tr key={i} className="border-b border-dark-700 hover:bg-dark-700/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="text-white font-mono font-medium">{iface.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      iface.state === "up" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    }`}>
                      {iface.state}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {iface.ipv4.length > 0 ? (
                      <div className="space-y-1">
                        {iface.ipv4.map((ip, j) => (
                          <code key={j} className="block text-white text-xs font-mono">{ip}</code>
                        ))}
                      </div>
                    ) : (
                      <span className="text-dark-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {iface.ipv6.length > 0 ? (
                      <div className="space-y-1">
                        {iface.ipv6.map((ip, j) => (
                          <code key={j} className="block text-accent-400 text-xs font-mono truncate max-w-[200px]" title={ip}>{ip}</code>
                        ))}
                      </div>
                    ) : (
                      <span className="text-dark-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-dark-300 text-xs font-mono">{iface.mac || "—"}</code>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-white text-xs">{iface.mtu}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Setup Guide */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">📖 IPv6 Quick Reference</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-semibold text-white mb-3">Enable IPv6</h4>
            <div className="bg-dark-900 rounded-xl p-4 font-mono text-xs space-y-1">
              <div className="text-dark-400"># Check if disabled</div>
              <div className="text-accent-400">cat /proc/sys/net/ipv6/conf/all/disable_ipv6</div>
              <div className="text-dark-400 mt-2"># Enable (0 = enabled)</div>
              <div className="text-accent-400">sysctl -w net.ipv6.conf.all.disable_ipv6=0</div>
              <div className="text-accent-400">sysctl -w net.ipv6.conf.default.disable_ipv6=0</div>
              <div className="text-dark-400 mt-2"># Make persistent</div>
              <div className="text-accent-400">echo &quot;net.ipv6.conf.all.disable_ipv6=0&quot; &gt;&gt; /etc/sysctl.conf</div>
              <div className="text-accent-400">sysctl -p</div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white mb-3">Firewall Rules</h4>
            <div className="bg-dark-900 rounded-xl p-4 font-mono text-xs space-y-1">
              <div className="text-dark-400"># UFW</div>
              <div className="text-accent-400">sudo ufw allow in on eth0 to any port 27015 proto udp</div>
              <div className="text-dark-400 mt-2"># ip6tables</div>
              <div className="text-accent-400">ip6tables -A INPUT -p udp --dport 27015 -j ACCEPT</div>
              <div className="text-accent-400">ip6tables -A INPUT -p tcp --dport 27015 -j ACCEPT</div>
              <div className="text-dark-400 mt-2"># Verify</div>
              <div className="text-accent-400">ip6tables -L -n --line-numbers</div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white mb-3">Game Server Binding</h4>
            <div className="bg-dark-900 rounded-xl p-4 font-mono text-xs space-y-1">
              <div className="text-dark-400"># Dual-stack (bind both v4 + v6)</div>
              <div className="text-accent-400">-ip 0.0.0.0 -ip6 ::</div>
              <div className="text-dark-400 mt-2"># IPv6 only</div>
              <div className="text-accent-400">-ip6 :: +sv_ip6_only 1</div>
              <div className="text-dark-400 mt-2"># Connect via IPv6</div>
              <div className="text-accent-400">connect [2001:db8::1]:27015</div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white mb-3">Testing</h4>
            <div className="bg-dark-900 rounded-xl p-4 font-mono text-xs space-y-1">
              <div className="text-dark-400"># Ping over IPv6</div>
              <div className="text-accent-400">ping6 ipv6.google.com</div>
              <div className="text-dark-400 mt-2"># Check listening sockets</div>
              <div className="text-accent-400">ss -6 -tlnp</div>
              <div className="text-dark-400 mt-2"># Your public IPv6</div>
              <div className="text-accent-400">curl -6 https://ifconfig.co</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
