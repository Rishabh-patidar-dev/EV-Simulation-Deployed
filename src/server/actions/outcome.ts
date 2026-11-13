import "server-only";
import { failed, type ActionResult } from "@/lib/actions";
import { StoreError } from "../store";

/**
 * Runs an action's work and turns a database refusal into a result the form
 * can show ("That change was not saved") instead of an error page. The
 * database's own message is logged on the server, not sent to the browser.
 * Anything else — a redirect, a genuine bug — is rethrown untouched.
 */
export async function saving(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof StoreError)) throw error;
    console.error(`[action] ${error.message}`);
    return failed("That change was not saved", "The database refused it. Try again — if it keeps happening, check the status menu in the header.");
  }
}
