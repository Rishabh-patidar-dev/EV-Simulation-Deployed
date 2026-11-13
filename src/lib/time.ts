/**
 * Clock reads for screens. React's purity rule keeps `Date.now()` out of
 * component bodies, so anything that depends on "now" asks here.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / HOUR;

export const daysSinceIso = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY);

/** Whole days until the date — negative once it has passed. */
export const daysUntilIso = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);

export const isPast = (iso: string) => new Date(iso).getTime() < Date.now();

export function isThisMonth(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

export function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

/** "2026-09-19" for an instant, in India time. */
export const istDayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Day and 24-hour time in IST — for a ledger, where the order within a day matters. */
export const istTimestamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** Today and the following days as India-time date keys. */
export function upcomingDayKeys(count: number): string[] {
  return Array.from({ length: count }, (_, i) => istDayKey(new Date(Date.now() + i * DAY).toISOString()));
}
