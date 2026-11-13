"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

/** Re-reads every figure on the page from the store, without a full reload. */
export default function RefreshButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={pending}
      onClick={() =>
        startTransition(() => {
          router.refresh();
          toast.success("Dashboard refreshed", { description: "Every figure was re-read from the store." });
        })
      }
    >
      <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Refreshing…" : label}
    </button>
  );
}
