import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function GET() {
  try {
    const scriptPath = path.join(process.cwd(), "public", "install.sh");
    const script = await fs.readFile(scriptPath, "utf8");
    return new NextResponse(script, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": "inline; filename=install.sh",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "Install script not found" }, { status: 404 });
  }
}
