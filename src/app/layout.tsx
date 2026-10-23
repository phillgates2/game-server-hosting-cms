import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
// Self-hosted, not next/font/google: this panel is built on game-server hosts
// that often have no egress to fonts.googleapis.com, and next/font/google
// fails the entire production build when it cannot reach Google. The latin
// subset woff2 files are vendored under src/app/fonts/ (both SIL OFL 1.1).
import localFont from "next/font/local";
import "./globals.css";
import { ToastProvider } from "@/components/ToastProvider";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { NotificationProvider } from "@/components/NotificationCenter";
import { I18nProvider } from "@/lib/i18n";

const headingFont = localFont({
  src: [
    { path: "./fonts/orbitron-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/orbitron-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-heading",
  display: "swap",
});

const bodyFont = localFont({
  src: [
    { path: "./fonts/rajdhani-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/rajdhani-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/rajdhani-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/rajdhani-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "GameServer Manager – Game Server Hosting",
  description: "Modern game server hosting platform with server management, real-time monitoring, multi-node support, forum, and database tools.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${headingFont.variable} ${bodyFont.variable} bg-bg-primary text-text-primary antialiased min-h-screen`}>
        <ToastProvider>
          <ConfirmProvider>
            <NotificationProvider>
              <I18nProvider>
                {children}
              </I18nProvider>
            </NotificationProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
