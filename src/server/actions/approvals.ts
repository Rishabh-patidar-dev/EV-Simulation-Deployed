"use server";

import { failed, succeeded, type ActionResult } from "@/lib/actions";
import { OPERATOR } from "@/lib/operator";
import { seedStage } from "@/lib/onboarding";
import { quoteTotals } from "@/lib/quotes";
import { readMany, updateRow } from "../store";
import { shareWithCustomer } from "../workflows/quotes";
import { gone, isId, oneOf, refresh, str, type Prev } from "./input";
import { saving } from "./outcome";

/**
 * Deciding an approval. When the request is tied to a record, the decision
 * carries through to it: an approved discount sends its quotation to the
 * customer, a rejected one returns it to draft; a warranty claim approval
 * moves the claim on; a credit-limit override releases a held order, or
 * cancels it.
 */
export async function decideApproval(approvalId: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return saving(async () => {
    if (!isId(approvalId)) return gone("request");
    const decision = oneOf(fd, "decision", ["Approved", "Rejected"] as const);
    if (!decision) return failed("Approve or reject");
    const note = str(fd, "note", 300);
    if (decision === "Rejected" && note.length < 3) return failed("Say why it is rejected", "The requester sees the reason.");

    const { data } = await readMany(["approvals", "quotations", "warranty_claims", "orders", "applications"] as const);
    const approval = data.approvals.find((a) => a.id === approvalId);
    if (!approval) return gone("request");
    if ((approval.status ?? "Pending") !== "Pending") return failed(`Already ${approval.status?.toLowerCase()}`);

    const at = new Date().toISOString();
    await updateRow("approvals", approval.id, { status: decision, decidedBy: OPERATOR.name, decidedAt: at, note: note || null });

    let effect = "";
    if (approval.link?.kind === "quotation") {
      const q = data.quotations.find((x) => x.id === approval.link?.id);
      if (q && q.status === "Pending Approval") {
        if (decision === "Approved") {
          await shareWithCustomer({ ...q, history: [...q.history, { status: "Discount approved", at, by: OPERATOR.name, ...(note ? { note } : {}) }] }, quoteTotals(q).payable);
          effect = `${q.quoteNo} has gone to ${q.customer}.`;
        } else {
          await updateRow("quotations", q.id, { status: "Draft", history: [...q.history, { status: "Discount rejected", at, by: OPERATOR.name, note }] });
          effect = `${q.quoteNo} is back in draft to revise.`;
        }
      }
    } else if (approval.link?.kind === "warranty_claim") {
      const claim = data.warranty_claims.find((c) => c.id === approval.link?.id);
      if (claim && (claim.status === "Submitted" || claim.status === "Under Review" || claim.status === "Info Requested")) {
        await updateRow("warranty_claims", claim.id, {
          status: decision,
          approvedAmount: decision === "Approved" ? claim.claimedAmount : 0,
          history: [...(claim.history ?? []), { status: decision, at, by: OPERATOR.name, ...(note ? { note } : {}) }],
        });
        effect = `Claim ${claim.claimNo} ${decision.toLowerCase()}.`;
      }
    } else if (approval.link?.kind === "application") {
      // Dealer onboarding sign-off: approved moves the application to Agreement with its checklist; rejected closes it.
      const app = data.applications.find((a) => a.id === approval.link?.id);
      if (app && app.stage === "Approval" && app.status === "In Progress") {
        if (decision === "Approved") {
          await updateRow("applications", app.id, {
            stage: "Agreement",
            stageEnteredAt: at,
            stageDocs: [...(app.stageDocs ?? []).filter((d) => d.stage !== "Agreement"), ...seedStage("Agreement")],
            history: [...(app.history ?? []), { status: "Approved for onboarding", at, by: OPERATOR.name, ...(note ? { note } : {}) }, { status: "Agreement", at, by: OPERATOR.name }],
          });
          effect = `${app.firm} is at Agreement — issue the LOI and take the deposit.`;
        } else {
          await updateRow("applications", app.id, { status: "Rejected", reason: note, history: [...(app.history ?? []), { status: "Rejected", at, by: OPERATOR.name, note }] });
          effect = `${app.firm}'s application is rejected.`;
        }
      }
    } else if (approval.link?.kind === "order") {
      // A credit-limit override: approved releases the order to be acknowledged; rejected cancels it.
      const order = data.orders.find((o) => o.id === approval.link?.id);
      if (order?.creditHold && order.status === "Placed") {
        const step = { status: decision === "Approved" ? "Placed" : "Cancelled", at, by: OPERATOR.name, note: decision === "Approved" ? `Credit approved over the limit${note ? ` — ${note}` : ""}` : `Credit refused — ${note}` } as const;
        await updateRow("orders", order.id, {
          creditHold: null,
          ...(decision === "Rejected" ? { status: "Cancelled" as const, cancelReason: `Credit refused — ${note}` } : {}),
          history: [...(order.history ?? []), step],
        });
        effect = decision === "Approved" ? `${order.orderNo} can be acknowledged.` : `${order.orderNo} is cancelled.`;
      }
    }

    refresh();
    return succeeded(`${approval.type} request ${decision.toLowerCase()}`, effect || approval.subject);
  });
}
