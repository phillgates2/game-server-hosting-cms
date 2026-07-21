import { db } from "@/db";
import { siteSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  let installed = false;
  try {
    const result = await db.select().from(siteSettings).where(eq(siteSettings.key, "installed")).limit(1);
    installed = result.length > 0 && result[0].value === "true";
  } catch {
    installed = false;
  }

  if (!installed) {
    redirect("/install");
  }
  redirect("/dashboard");
}
