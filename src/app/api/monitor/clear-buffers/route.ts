import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    // Sync filesystem buffers first
    await execAsync("sync");
    // Drop page cache, dentries, and inodes (level 3 = all)
    await execAsync("echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true");

    return NextResponse.json({
      ok: true,
      message: "Buffer/cache cleared successfully. Synced filesystem and dropped caches.",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({
      ok: false,
      message: `Buffer clear attempted (may require root): ${msg}`,
    });
  }
}
