"use client";

import { useEffect } from "react";
import Link from "next/link";
import { DatabaseZap, RotateCcw } from "lucide-react";

/**
 * Shown in place of a page that could not load — in practice, the database
 * refusing or not answering a read. The navigation stays usable around it.
 * In production the error's own message is withheld by Next; its digest
 * matches the entry in the server log.
 */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col items-center px-4 py-16 text-center sm:px-6">
      <span className="flex h-12 w-12 items-center justify-center rounded-[14px]" style={{ background: "var(--negative-surface)", color: "var(--negative)" }}>
        <DatabaseZap className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-[20px] font-bold tracking-tight">This page couldn&apos;t load its data</h1>
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        The database didn&apos;t answer, or refused the request. Nothing you had already saved is affected. Try again in a moment — if it
        keeps happening, the status menu in the header shows whether the database is reachable.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          <RotateCcw className="h-3.5 w-3.5" />
          Try again
        </button>
        <Link href="/" className="btn btn-ghost">
          Go to the dashboard
        </Link>
      </div>
      {error.digest && (
        <p className="mt-4 text-[11px]" style={{ color: "var(--fg-faint)" }}>
          Reference {error.digest}
        </p>
      )}
    </div>
  );
}
