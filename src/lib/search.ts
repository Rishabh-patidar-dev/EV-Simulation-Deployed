/**
 * Server-side row filtering for module screens.
 *
 * Every module table searches the same way — a case-insensitive substring
 * match across whatever string/number fields the row happens to have — so the
 * behaviour is defined once here rather than per screen. Filtering runs on the
 * server (see TableToolbar) so the table itself can stay a server component.
 */
export function filterRows<T extends object>(rows: T[], query?: string): T[] {
  const q = query?.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    Object.values(row).some((value) => {
      if (value == null) return false;
      // A data: URL is an inline image — base64 bytes nobody searches for, and
      // long enough to slow every keystroke if scanned.
      if (typeof value === "string") return !value.startsWith("data:") && value.toLowerCase().includes(q);
      if (typeof value === "number") return String(value).includes(q);
      return false;
    })
  );
}

/** Next 16 hands `searchParams` in as a promise; this is the one place that unwraps it. */
export async function readQuery(searchParams?: Promise<{ q?: string | string[] }>): Promise<string> {
  const params = await searchParams;
  const q = params?.q;
  return (Array.isArray(q) ? q[0] : q) ?? "";
}
