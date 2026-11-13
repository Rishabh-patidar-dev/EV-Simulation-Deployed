import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * Shown for an unknown URL and for a record that no longer exists (every
 * detail page calls notFound()). Next's built-in 404 follows the OS colour
 * scheme rather than the app's theme, so it is replaced with one on the
 * app's own tokens, inside the shell like any other page.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col items-center px-4 py-16 text-center sm:px-6">
      <span className="flex h-12 w-12 items-center justify-center rounded-[14px]" style={{ background: "var(--surface-subtle)", color: "var(--fg-muted)" }}>
        <SearchX className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-[20px] font-bold tracking-tight">Nothing here</h1>
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        This page or record doesn&apos;t exist — it may have been removed, or the link is wrong. Search in the sidebar finds any module.
      </p>
      <Link href="/" className="btn btn-primary mt-5">
        Go to the dashboard
      </Link>
    </div>
  );
}
