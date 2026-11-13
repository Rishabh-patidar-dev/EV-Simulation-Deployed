import "server-only";
import { seedStage } from "@/lib/onboarding";
import { OPERATOR } from "@/lib/operator";
import { runtimeId } from "../ids";
import { nextNumber } from "../numbering";
import { insertRow, readCollection } from "../store";
import type { Application } from "../types";

const KYC_TYPES = ["PAN", "GST Certificate", "Aadhaar", "Trade Licence", "Bank Proof", "Premises Photo"] as const;

/**
 * Opens a dealer application at Enquiry with its screening checklist and the
 * six Digital KYC documents — one function, so an application typed in on
 * Onboarding and one captured by a landing page start out the same.
 */
export async function openApplication(
  input: Pick<Application, "firm" | "city" | "state" | "intent" | "owner"> &
    Pick<Application, "contactName" | "phone" | "email" | "gstin" | "pan" | "investment" | "source"> & { landingPageId?: string | null; note?: string }
): Promise<Application> {
  const { rows } = await readCollection("applications");
  const now = new Date().toISOString();
  const { note, ...fields } = input;
  const application: Application = {
    id: runtimeId("APP"),
    applicationNo: nextNumber(
      rows.map((a) => a.applicationNo),
      "APP",
      800
    ),
    ...fields,
    stage: "Enquiry",
    status: "In Progress",
    submittedAt: now,
    stageDocs: seedStage("Enquiry"),
    stageEnteredAt: now,
    reason: null,
    approvalId: null,
    securityDeposit: null,
    dealerId: null,
    history: [{ status: "Enquiry", at: now, by: OPERATOR.name, note: note ?? `Opened${input.source ? ` from ${input.source}` : ""} — owner ${input.owner}` }],
  };
  await insertRow("applications", application);
  for (const docType of KYC_TYPES) {
    await insertRow("kyc_documents", { id: runtimeId("KYC"), applicationNo: application.applicationNo, firm: application.firm, docType, status: "Not Uploaded", uploadedAt: null, verifiedBy: null });
  }
  return application;
}
