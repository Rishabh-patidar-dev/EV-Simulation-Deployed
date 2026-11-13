import type { ReactNode } from "react";

/**
 * The table every module screen renders.
 *
 * Deliberately a server component: column `render` functions are real
 * functions, which cannot cross the server/client boundary, and none of this
 * needs interactivity. Searching is done on the server off the `?q=` param
 * (see TableToolbar), so the rows arriving here are already the rows to show.
 */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Hidden below the `md` breakpoint, so a phone shows the columns that matter. */
  secondary?: boolean;
}

export default function DataTable<T>({
  rows,
  columns,
  empty = "Nothing to show yet.",
  maxHeight,
}: {
  rows: T[];
  columns: Column<T>[];
  empty?: string;
  maxHeight?: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-[13px]" style={{ color: "var(--fg-muted)" }}>
        {empty}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${col.align === "right" ? "text-right" : ""} ${col.secondary ? "hidden md:table-cell" : ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`${col.align === "right" ? "num text-right" : ""} ${col.secondary ? "hidden md:table-cell" : ""}`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
