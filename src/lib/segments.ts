import type { Lead, SegmentFilter } from "@/server/types";

/**
 * Applies a segment's filter to the live leads collection. A segment's size
 * is never stored — it is always this count, computed against whatever the
 * leads collection holds right now, so it can never go stale the way a
 * cached count would the moment a lead is added or its status changes.
 */
function matchesSegment(lead: Lead, filter: SegmentFilter): boolean {
  if (filter.source && lead.source !== filter.source) return false;
  if (filter.status && lead.status !== filter.status) return false;
  if (filter.city && lead.city.toLowerCase() !== filter.city.toLowerCase()) return false;
  if (filter.minScore != null && lead.score < filter.minScore) return false;
  return true;
}

export function segmentLeads(leads: Lead[], filter: SegmentFilter): Lead[] {
  return leads.filter((l) => matchesSegment(l, filter));
}

/** A short human-readable rendering of the filter, for the segments table. */
export function describeSegmentFilter(filter: SegmentFilter): string {
  const parts: string[] = [];
  if (filter.source) parts.push(`source = ${filter.source}`);
  if (filter.status) parts.push(`status = ${filter.status}`);
  if (filter.city) parts.push(`city = ${filter.city}`);
  if (filter.minScore != null) parts.push(`score >= ${filter.minScore}`);
  return parts.length ? parts.join(" AND ") : "Everyone";
}
