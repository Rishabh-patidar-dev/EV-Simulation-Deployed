"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";

/**
 * Search box for a module screen.
 *
 * Filtering runs on the server off `?q=` so DataTable can stay a server
 * component (its column `render` functions cannot be serialised to the
 * client). This pushes the query into the URL — debounced, so typing does not
 * fire a navigation per keystroke — which also makes a filtered view a
 * shareable link.
 */
export default function TableToolbar({ placeholder = "Search" }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(params.get("q") ?? "");

  // Keep in step when the user navigates with the back button or lands on a
  // link that already carries a `q`. Adjusted during render rather than in an
  // effect — an effect here would cascade an extra render on every navigation.
  const urlQuery = params.get("q") ?? "";
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery);
    setValue(urlQuery);
  }

  useEffect(() => {
    if (value === urlQuery) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    }, 250);
    return () => clearTimeout(timer);
  }, [value, urlQuery, params, pathname, router]);

  return (
    <div
      className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 sm:w-64"
      style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "var(--fg-faint)" }} />
      ) : (
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--fg-faint)" }} />
      )}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--fg-faint)]"
      />
    </div>
  );
}
