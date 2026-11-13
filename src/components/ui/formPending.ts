"use client";

import { createContext } from "react";

/**
 * Whether the ActionForm around a component is waiting on its action.
 * ActionForm submits through onSubmit rather than `<form action>` (so a
 * refused submission keeps what was typed), which `useFormStatus` does not
 * see — SubmitButton reads this instead.
 */
export const FormPendingContext = createContext(false);
