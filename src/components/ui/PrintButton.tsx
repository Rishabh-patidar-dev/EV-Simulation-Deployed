"use client";

import { Printer } from "lucide-react";

/** Prints the page — the print stylesheet hides the app chrome, leaving the document. */
export default function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
      <Printer className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
