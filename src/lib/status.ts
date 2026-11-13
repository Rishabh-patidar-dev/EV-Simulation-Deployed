/** Shapes for the header's system-status menu, built on the server (server/status.ts). */

export type StatusLevel = "healthy" | "warning" | "offline";

export interface StatusEntry {
  id: string;
  label: string;
  level: StatusLevel;
  detail: string;
  tooltip?: string;
}

export interface StatusGroup {
  id: string;
  label: string;
  entries: StatusEntry[];
}

const RANK: Record<StatusLevel, number> = { healthy: 0, offline: 1, warning: 2 };

export function worstLevel(groups: StatusGroup[]): StatusLevel {
  let worst: StatusLevel = "healthy";
  for (const group of groups) for (const entry of group.entries) if (RANK[entry.level] > RANK[worst]) worst = entry.level;
  return worst;
}
