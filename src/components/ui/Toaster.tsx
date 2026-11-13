"use client";

import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert } from "lucide-react";
import { Toaster as Sonner } from "sonner";

/**
 * App-wide toast messages. Unstyled Sonner dressed in the app's own tokens,
 * so a toast is tinted by its meaning (success, warning, error, info) and
 * follows the light/dark theme without a separate theme prop.
 */
export default function Toaster() {
  return (
    <Sonner
      position="top-right"
      offset={{ top: 72, right: 16 }}
      mobileOffset={{ top: 72, right: 12, left: 12 }}
      gap={8}
      closeButton
      icons={{
        success: <CircleCheck className="h-4 w-4" style={{ color: "var(--positive)" }} />,
        info: <Info className="h-4 w-4" style={{ color: "var(--info)" }} />,
        warning: <TriangleAlert className="h-4 w-4" style={{ color: "var(--warning)" }} />,
        error: <OctagonX className="h-4 w-4" style={{ color: "var(--negative)" }} />,
        loading: <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--fg-muted)" }} />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: [
            "group/toast relative flex w-full items-start gap-2.5 overflow-hidden rounded-[12px] border py-3 pl-3.5 pr-9",
            "border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--fg)] shadow-[var(--shadow-pop)]",
            "data-[type=success]:border-[color:var(--positive-border)] data-[type=success]:bg-[color:var(--positive-surface)]",
            "data-[type=warning]:border-[color:var(--warning-border)] data-[type=warning]:bg-[color:var(--warning-surface)]",
            "data-[type=error]:border-[color:var(--negative-border)] data-[type=error]:bg-[color:var(--negative-surface)]",
            "data-[type=info]:border-[color:var(--info-border)] data-[type=info]:bg-[color:var(--info-surface)]",
          ].join(" "),
          icon: "mt-0.5 flex shrink-0 items-center justify-center",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "text-[13px] font-semibold leading-5",
          description: "text-[12px] leading-[1.45] text-[color:var(--fg-muted)]",
          closeButton: [
            "absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-[6px]",
            "text-[color:var(--fg-muted)] opacity-0 transition-opacity hover:bg-[color:var(--hover)]",
            "focus-visible:opacity-100 group-hover/toast:opacity-100 [&>svg]:h-3.5 [&>svg]:w-3.5",
          ].join(" "),
        },
      }}
      style={{ ["--width" as string]: "356px" }}
    />
  );
}
