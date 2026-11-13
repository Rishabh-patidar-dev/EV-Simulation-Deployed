import "server-only";
import type { StatusEntry, StatusGroup } from "@/lib/status";
import { databaseBackend, type StoreFailure } from "./store";

/**
 * What the status menu reports. Only derived facts cross to the client —
 * whether a secret is set, never its value.
 *
 * `database` is how the layout's own reads went: "ok", or why they failed.
 */
export function buildSystemStatus(database: "ok" | StoreFailure): StatusGroup[] {
  return [
    { id: "data", label: "Data", entries: dataEntries(database) },
    {
      id: "access",
      label: "Access",
      entries: [
        {
          id: "auth",
          label: "Sign-in",
          level: "offline",
          detail: "Not in this demo",
          tooltip: "The simulation has no authentication; anyone who can reach it can use it.",
        },
      ],
    },
  ];
}

function dataEntries(database: "ok" | StoreFailure): StatusEntry[] {
  switch (database) {
    case "ok": {
      const label = databaseBackend() === "postgres" ? "Postgres" : "Supabase";
      return [
        { id: "reads", label: "Reads", level: "healthy", detail: label, tooltip: "Every screen is reading the sim_* tables." },
        { id: "writes", label: "Writes", level: "healthy", detail: label, tooltip: "Changes are saved to the sim_* tables." },
      ];
    }
    case "not-configured":
      return [
        { id: "reads", label: "Database", level: "warning", detail: "Not configured", tooltip: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or DATABASE_URL, then restart the app." },
      ];
    case "missing-table":
      return [
        { id: "reads", label: "Database", level: "warning", detail: "Tables missing", tooltip: "Some sim_* tables do not exist. Run npm run db:setup to create them." },
      ];
    case "refused":
      return [
        { id: "reads", label: "Reads", level: "warning", detail: "Database unreachable", tooltip: "Supabase did not answer or refused the request. Pages will show an error until it does." },
        { id: "writes", label: "Writes", level: "warning", detail: "Not being saved", tooltip: "Changes cannot be saved while the database is unreachable." },
      ];
  }
}
