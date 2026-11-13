/**
 * What a server action reports back to an ActionForm. `at` makes every result
 * a new value, so the same message twice in a row still shows twice.
 */
export interface ActionResult {
  ok: boolean;
  message: string;
  description?: string;
  at: number;
}

export const succeeded = (message: string, description?: string): ActionResult => ({ ok: true, message, description, at: Date.now() });
export const failed = (message: string, description?: string): ActionResult => ({ ok: false, message, description, at: Date.now() });
