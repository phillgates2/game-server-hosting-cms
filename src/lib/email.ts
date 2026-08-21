import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "noreply@gameserver.local";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export function isEmailConfigured(): boolean {
  return !!SMTP_HOST;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({ from: SMTP_FROM, to, subject, html });
    return true;
  } catch (e) {
    console.error("Email send failed:", e);
    return false;
  }
}

export async function sendServerCrashEmail(to: string, serverName: string, gameName: string) {
  return sendEmail(to, `🚨 Server Crashed: ${serverName}`,
    `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#151c2c;color:#e2e8f0;border-radius:12px">
      <h2 style="color:#ef4444">🚨 Server Crash Alert</h2>
      <p><strong>${serverName}</strong> (${gameName}) has stopped unexpectedly.</p>
      <p>Log in to the panel to investigate and restart.</p>
      <p style="color:#64748b;font-size:12px;margin-top:20px">— GameServer Manager</p>
    </div>`);
}

export async function sendWelcomeEmail(to: string, username: string) {
  return sendEmail(to, `Welcome to GameServer Manager`,
    `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#151c2c;color:#e2e8f0;border-radius:12px">
      <h2 style="color:#3b82f6">🎮 Welcome, ${username}!</h2>
      <p>Your account has been created on GameServer Manager.</p>
      <p>Log in to start creating and managing game servers.</p>
      <p style="color:#64748b;font-size:12px;margin-top:20px">— GameServer Manager</p>
    </div>`);
}
