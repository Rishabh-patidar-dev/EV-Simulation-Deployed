import type { Metadata } from "next";
import { cookies } from "next/headers";
import Script from "next/script";
import type { ReactNode } from "react";
import AppShell from "@/components/shell/AppShell";
import { RAIL_COOKIE } from "@/components/shell/constants";
import { buildNotifications } from "@/server/notifications";
import { buildSystemStatus } from "@/server/status";
import { StoreError, type StoreFailure } from "@/server/store";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luxus Green — CRM · DMS · ERP Simulation",
  description:
    "One dashboard covering the full module map: lead capture through dealer onboarding, inventory, billing, after-sales and ERP integrations.",
  icons: { icon: "/luxus-green-logo.webp" },
};

// Every screen reads live counts, so nothing here should be statically cached.
export const dynamic = "force-dynamic";

/** Applied before paint so a dark-theme user never sees a white flash. */
const THEME_INIT = `
  try {
    var t = localStorage.getItem("sim-theme");
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The bell is real: each notification is a row that needs a human right
  // now, derived from the same collections the module screens read. If the
  // database cannot be read, the shell still renders — an empty bell and a
  // status menu that says so — and the page below shows its own error.
  const [bell, cookieStore] = await Promise.all([
    buildNotifications().then(
      (notifications) => ({ notifications, database: "ok" as const }),
      (error: unknown) => {
        console.error("[layout] notifications unavailable:", error instanceof Error ? error.message : error);
        const database: StoreFailure = error instanceof StoreError ? error.failure : "refused";
        return { notifications: [], database };
      }
    ),
    cookies(),
  ]);
  const railCollapsed = cookieStore.get(RAIL_COOKIE)?.value === "collapsed";
  const status = buildSystemStatus(bell.database);

  return (
    // suppressHydrationWarning: the theme script below stamps data-theme onto
    // <html> before React hydrates, which is the whole point of it — without
    // this, that deliberate difference is reported as a hydration mismatch.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* next/script rather than a bare <script>: React never executes an
            inline script it renders itself, and beforeInteractive is what
            gets this into the document ahead of first paint. */}
        <Script id="sim-theme-init" strategy="beforeInteractive">
          {THEME_INIT}
        </Script>
      </head>
      <body className="h-full">
        <AppShell initialCollapsed={railCollapsed} notifications={bell.notifications} status={status}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
