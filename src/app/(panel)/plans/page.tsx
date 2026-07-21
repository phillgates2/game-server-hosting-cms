import { db } from "@/db";
import { plans } from "@/db/schema";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const allPlans = await db.select().from(plans);

  const planIcons = ["🌱", "⚡", "🔥", "💎"];
  const planColors = [
    "from-blue-500/20 to-blue-600/5",
    "from-brand-500/20 to-brand-600/5",
    "from-purple-500/20 to-purple-600/5",
    "from-amber-500/20 to-amber-600/5",
  ];

  return (
    <div>
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-white mb-3">Hosting Plans</h1>
        <p className="text-dark-300 text-lg">Choose the perfect plan for your game server</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {allPlans.map((plan, i) => (
          <div
            key={plan.id}
            className={`glass-card rounded-2xl p-6 relative overflow-hidden bg-gradient-to-b ${planColors[i] || planColors[0]} ${i === 2 ? "ring-2 ring-brand-500" : ""}`}
          >
            {i === 2 && (
              <div className="absolute top-0 right-0 bg-brand-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
                POPULAR
              </div>
            )}
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">{planIcons[i] || "📦"}</div>
              <h3 className="text-xl font-bold text-white">{plan.name}</h3>
              <p className="text-dark-300 text-sm mt-1">{plan.description}</p>
            </div>

            <div className="text-center mb-6">
              <span className="text-4xl font-bold text-white">${(plan.priceMonthly / 100).toFixed(2)}</span>
              <span className="text-dark-300">/mo</span>
            </div>

            <div className="space-y-3 mb-8">
              {[
                `${plan.slots} Player Slots`,
                `${plan.ramMb >= 1024 ? `${plan.ramMb / 1024} GB` : `${plan.ramMb} MB`} RAM`,
                `${plan.diskMb >= 1024 ? `${Math.round(plan.diskMb / 1024)} GB` : `${plan.diskMb} MB`} Disk`,
                `${plan.cpuPercent}% CPU`,
                "DDoS Protection",
                "24/7 Support",
              ].map((feature, j) => (
                <div key={j} className="flex items-center gap-2 text-sm">
                  <span className="text-green-400">✓</span>
                  <span className="text-gray-300">{feature}</span>
                </div>
              ))}
            </div>

            <Link
              href="/servers/create"
              className={`block text-center py-3 px-6 rounded-xl font-semibold transition-all ${
                i === 2
                  ? "bg-brand-500 hover:bg-brand-600 text-white"
                  : "bg-dark-600 hover:bg-dark-500 text-white"
              }`}
            >
              Get Started
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
