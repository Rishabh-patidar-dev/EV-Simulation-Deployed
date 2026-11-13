"use client";

import { useContext, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { FormPendingContext } from "./formPending";

/**
 * The submit button for every form in the app. It shows the pending state
 * only — what the action actually did is reported by the ActionForm around
 * it. Pending comes from that ActionForm, or from `useFormStatus` for a plain
 * `<form action>`.
 */
export default function SubmitButton({
  children,
  tone = "primary",
  size,
  className = "",
  name,
  value,
  label,
}: {
  children: ReactNode;
  tone?: "primary" | "ghost" | "danger";
  size?: "sm";
  className?: string;
  /** Sent with the form when this button submits it — one form, several decisions. */
  name?: string;
  value?: string;
  /** Accessible name and tooltip, for a button that shows only an icon. */
  label?: string;
}) {
  const actionPending = useContext(FormPendingContext);
  const pending = useFormStatus().pending || actionPending;

  return (
    <button
      type="submit"
      name={name}
      value={value}
      aria-label={label}
      title={label}
      disabled={pending}
      aria-busy={pending}
      className={`btn btn-${tone} ${size === "sm" ? "btn-sm" : ""} ${className}`}
    >
      {pending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Working…
        </>
      ) : (
        children
      )}
    </button>
  );
}
