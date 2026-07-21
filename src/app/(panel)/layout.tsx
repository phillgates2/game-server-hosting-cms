import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <main className="flex-1 ml-64 p-6 bg-dark-900 min-h-screen">
        {children}
      </main>
    </div>
  );
}
