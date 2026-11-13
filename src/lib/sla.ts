/**
 * Support SLAs by priority. The site promises email replies in 24–48 hours;
 * these are the internal targets inside that, tightest for a vehicle that is
 * off the road and so not earning.
 */

import type { SupportTicket, TICKET_PRIORITIES } from "@/server/types";

const HOUR = 3_600_000;

export const SLA: Record<(typeof TICKET_PRIORITIES)[number], { label: string; respondHours: number; resolveHours: number }> = {
  P1: { label: "Critical — vehicle off road", respondHours: 1, resolveHours: 8 },
  P2: { label: "High", respondHours: 4, resolveHours: 24 },
  P3: { label: "Normal", respondHours: 8, resolveHours: 48 },
  P4: { label: "Low", respondHours: 24, resolveHours: 72 },
};

export function slaTargets(priority: SupportTicket["priority"], openedAt: string): { respondBy: string; resolveBy: string } {
  const opened = new Date(openedAt).getTime();
  return {
    respondBy: new Date(opened + SLA[priority].respondHours * HOUR).toISOString(),
    resolveBy: new Date(opened + SLA[priority].resolveHours * HOUR).toISOString(),
  };
}

const DONE: ReadonlyArray<SupportTicket["status"]> = ["Resolved", "Closed"];

export const isOpenTicket = (t: Pick<SupportTicket, "status">) => !DONE.includes(t.status);

/** Where a ticket stands against its SLA right now. */
export function slaState(t: Pick<SupportTicket, "status" | "respondBy" | "resolveBy" | "firstResponseAt" | "resolvedAt">): {
  responseBreached: boolean;
  resolutionBreached: boolean;
  /** Hours left to resolve; negative once breached. Null when resolved. */
  hoursLeft: number | null;
} {
  const now = Date.now();
  const responded = t.firstResponseAt ? new Date(t.firstResponseAt).getTime() : null;
  const resolved = t.resolvedAt ? new Date(t.resolvedAt).getTime() : null;
  const respondBy = new Date(t.respondBy).getTime();
  const resolveBy = new Date(t.resolveBy).getTime();
  return {
    responseBreached: (responded ?? now) > respondBy,
    resolutionBreached: (resolved ?? now) > resolveBy,
    hoursLeft: isOpenTicket(t) ? Math.round(((resolveBy - now) / HOUR) * 10) / 10 : null,
  };
}
