"use client";

import { startTransition, useActionState, useRef, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions";
import { FormPendingContext } from "./formPending";

/**
 * A form whose server action reports what happened. Success and refusal both
 * surface as a toast — a duplicate email or a guarded change is explained, not
 * silently dropped.
 *
 * Two details matter:
 *  - The toast fires as soon as the server answers, not from an effect after
 *    the re-render: that re-render often removes the very form that ran the
 *    action (a deal card moving column), and its result would be lost.
 *  - Submission goes through onSubmit instead of `<form action>`, because React
 *    resets a function-action form after every submit — a refused one would
 *    wipe what the person typed. Here the form resets only on success, and
 *    only when asked to.
 */
export default function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = false,
  id,
}: {
  action: (state: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Lets fields elsewhere on the page join this form with `form="id"` — a table row's inputs, say. */
  id?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  const [, dispatch, pending] = useActionState(async (previous: ActionResult | null, formData: FormData) => {
    const result = await action(previous, formData);
    if (result.ok) {
      toast.success(result.message, { description: result.description });
      if (resetOnSuccess) formRef.current?.reset();
    } else {
      toast.error(result.message, { description: result.description });
    }
    return result;
  }, null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  };

  return (
    <FormPendingContext.Provider value={pending}>
      {/* method="post": submitted before hydration, a form without it would fall back to a GET and copy every field — phone numbers included — into the URL and history. */}
      <form ref={formRef} id={id} method="post" onSubmit={onSubmit} aria-busy={pending} className={className}>
        {children}
      </form>
    </FormPendingContext.Provider>
  );
}
