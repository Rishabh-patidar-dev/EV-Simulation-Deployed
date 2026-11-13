/**
 * Ids for rows created at runtime (a new lead, a new deal …), distinct in
 * shape from the original rows' zero-padded sequence (`LEAD-0001`) so the two
 * can never collide, and sortable-ish since the timestamp leads.
 */
export function runtimeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
