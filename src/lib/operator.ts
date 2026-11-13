/**
 * Who the demo is "signed in" as. The simulation has no authentication, so
 * this is a fixed identity rather than a session — kept in one place so the
 * top bar, the dashboard greeting and Settings can never disagree. It matches
 * USR-0001 in the users table (the first System Admin).
 */
export const OPERATOR = {
  name: "Akash Menon",
  firstName: "Akash",
  email: "akash.menon@luxusgreen.example",
  role: "System Admin",
  team: "Network Operations",
} as const;

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}
