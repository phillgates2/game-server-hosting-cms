import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Orbitron, Rajdhani } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ToastProvider";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { NotificationProvider } from "@/components/NotificationCenter";
import { I18nProvider } from "@/lib/i18n";

const headingFont = Orbitron({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-heading",
});

const bodyFont = Rajdhani({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

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
