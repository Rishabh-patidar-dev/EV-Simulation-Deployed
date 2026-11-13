import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, CircleDashed, CircleX, Inbox } from "lucide-react";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { Facts, Hint, Stepper, Timeline, reachedFrom } from "@/components/ui/workflow";
import { INDIAN_STATES } from "@/lib/gst";
import { APPLICATION_SOURCES, CREDIT_MULTIPLE, INVESTMENT_BANDS, ONBOARDING_STAGES, SECURITY_DEPOSIT, blockingDocs, stageAge, type StageDoc } from "@/lib/onboarding";
import { markKycUploaded, verifyKyc } from "@/server/actions/network";
import {
  advanceApplication,
  deleteApplication,
  recordSecurityDeposit,
  setApplicationStatus,
  setStageDoc,
  signAgreement,
  updateApplication,
} from "@/server/actions/onboarding";
import { assignableStaff } from "@/server/staff";
import { readMany } from "@/server/store";
import type { Application } from "@/server/types";

export const dynamic = "force-dynamic";

/**
 * One dealer application — EV-CRM's dealer-onboarding page: the applicant,
 * the current stage's document checklist (each received, verified or
 * rejected), the Digital KYC, the sign-off, the deposit and the agreement,
 * and the history of every step. The stage moves on only when its checklist
 * is complete.
 */
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data }, staff] = await Promise.all([readMany(["applications", "kyc_documents", "approvals", "dealers"] as const), assignableStaff("onboarding.manage")]);
  const app = data.applications.find((a) => a.id === id);
  if (!app) notFound();

  const kyc = data.kyc_documents.filter((d) => d.applicationNo === app.applicationNo);
  const approval = app.approvalId ? data.approvals.find((a) => a.id === app.approvalId) : undefined;
  const dealer = app.dealerId ? data.dealers.find((d) => d.id === app.dealerId) : data.dealers.find((d) => d.name === app.firm);
  const age = stageAge(app);
  const blocking = blockingDocs(app);
  const docsHere = (app.stageDocs ?? []).filter((d) => d.stage === app.stage);
  const earlier = (app.stageDocs ?? []).filter((d) => d.stage !== app.stage);
  const working = app.status === "In Progress";
  const kycOpen = kyc.filter((d) => d.status !== "Verified").length;
  const nextStage = ONBOARDING_STAGES[ONBOARDING_STAGES.indexOf(app.stage) + 1];
  const deposit = SECURITY_DEPOSIT[app.intent];

  return (
    <DetailScreen
      moduleHref="/dms/onboarding"
      title={app.firm}
      badges={
        <>
          <StatusPill value={app.status} />
          <Pill tone="brand">{app.intent}</Pill>
          {age.stalled && <Pill tone="negative">Stalled</Pill>}
        </>
      }
      subtitle={
        <>
          {app.applicationNo} · {app.city}, {app.state} · opened {formatDate(app.submittedAt)} · owner {app.owner}
          {working ? ` · ${age.days} of ${age.limit} days at ${app.stage}` : ""}
        </>
      }
      actions={
        app.status === "On Hold" ? (
          <ActionForm action={setApplicationStatus.bind(null, app.id)}>
            <input type="hidden" name="status" value="In Progress" />
            <SubmitButton>Resume</SubmitButton>
          </ActionForm>
        ) : working && app.stage !== "Agreement" ? (
          <>
            <ActionForm action={advanceApplication.bind(null, app.id)}>
              <SubmitButton tone={blocking.length || (app.stage === "Verification" && kycOpen) ? "ghost" : "primary"}>To {nextStage}</SubmitButton>
            </ActionForm>
            <Hint>
              {app.stage === "Approval"
                ? approval?.status === "Approved"
                  ? "Approved — move on to the agreement."
                  : "Waits for the Head of Network Development."
                : blocking.length
                  ? `${blocking.length} required document${blocking.length === 1 ? "" : "s"} still to verify.`
                  : app.stage === "Verification" && kycOpen
                    ? `${kycOpen} KYC document${kycOpen === 1 ? "" : "s"} still to verify.`
                    : "Everything this stage needs is verified."}
            </Hint>
          </>
        ) : app.status === "Approved" && dealer ? (
          <Link href={`/dms/dealers/${dealer.id}`} className="btn btn-primary">
            Open in Dealer 360
          </Link>
        ) : undefined
      }
    >
      <Stepper
        label="Onboarding progress"
        steps={ONBOARDING_STAGES}
        current={ONBOARDING_STAGES.indexOf(app.stage)}
        complete={app.status === "Approved"}
        reachedAt={reachedFrom(app.history ?? [])}
        stopped={app.status === "Rejected" ? { title: "Rejected.", detail: app.reason ?? "No reason was recorded." } : undefined}
      />
      {app.status === "On Hold" && (
        <p className="surface px-4 py-3 text-[13px]" style={{ background: "var(--warning-surface)", borderColor: "var(--warning-border)" }}>
          <span className="font-semibold">On hold.</span> {app.reason}
        </p>
      )}

      <DetailColumns
        main={
          <>
            {app.stage !== "Approval" && (
              <Panel title={`${app.stage} checklist`} description="From EV-CRM's onboarding document list. Required documents must all be verified to move on.">
                {docsHere.length ? (
                  <ul className="space-y-2.5">
                    {docsHere.map((d) => (
                      <DocRow key={d.key} app={app} doc={d} editable={working || app.status === "On Hold"} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
                    This application was opened before stage checklists — moving it on adds this stage&apos;s checklist first.
                  </p>
                )}
              </Panel>
            )}

            {app.stage === "Verification" && (
              <Panel title="Digital KYC" description="All six must be verified as well as the due-diligence file." action={{ href: `/dms/onboarding/kyc?q=${encodeURIComponent(app.applicationNo)}`, label: "Open in Digital KYC" }}>
                <ul className="space-y-1.5 text-[12.5px]">
                  {kyc.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>{d.docType}</span>
                      <span className="flex items-center gap-1.5">
                        <StatusPill value={d.status} />
                        {(d.status === "Not Uploaded" || d.status === "Rejected") && working && (
                          <ActionForm action={markKycUploaded.bind(null, d.id)}>
                            <SubmitButton size="sm" tone="ghost">
                              Received
                            </SubmitButton>
                          </ActionForm>
                        )}
                        {d.status === "Pending" && working && (
                          <ActionForm action={verifyKyc.bind(null, d.id)} className="flex gap-1">
                            <SubmitButton size="sm" name="decision" value="Verified">
                              Verify
                            </SubmitButton>
                            <SubmitButton size="sm" tone="danger" name="decision" value="Rejected">
                              Reject
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {app.stage === "Approval" && (
              <Panel title="Sign-off" description="A Dealer Onboarding request to the Head of Network Development.">
                {approval ? (
                  <div className="space-y-1.5 text-[12.5px]">
                    <p className="flex items-center gap-2">
                      <StatusPill value={approval.status ?? "Pending"} /> raised {formatDate(approval.raisedAt)} · with {approval.pendingWith}
                    </p>
                    {approval.detail && <p style={{ color: "var(--fg-muted)" }}>{approval.detail}</p>}
                    {approval.note && <p>Note: {approval.note}</p>}
                    {(approval.status ?? "Pending") === "Pending" && (
                      <Link href="/erp/access#approvals" className="underline">
                        Decide it in the approvals queue
                      </Link>
                    )}
                  </div>
                ) : (
                  <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
                    No sign-off request on file — this application reached Approval before requests were raised. Moving it on needs one; ask in the approvals queue.
                  </p>
                )}
              </Panel>
            )}

            {app.stage === "Agreement" && working && (
              <Panel title="Security deposit and agreement" description={`Simulation policy: at least ${formatINR(deposit)} for a ${app.intent.toLowerCase()}; the opening credit limit is ${CREDIT_MULTIPLE}× the deposit.`}>
                {app.securityDeposit ? (
                  <p className="mb-3 text-[12.5px]">
                    Deposit {formatINR(app.securityDeposit.amount)} received {formatDate(app.securityDeposit.at)} · {app.securityDeposit.reference}
                  </p>
                ) : (
                  <ActionForm action={recordSecurityDeposit.bind(null, app.id)} className="mb-4 flex flex-wrap items-end gap-2">
                    <div>
                      <label className="field-label" htmlFor="sd-amount">
                        Deposit (₹)
                      </label>
                      <input id="sd-amount" name="amount" type="number" min={deposit} step={1} defaultValue={deposit} required className="field w-40" />
                    </div>
                    <div className="min-w-[12rem] flex-1">
                      <label className="field-label" htmlFor="sd-ref">
                        UTR / bank guarantee no.
                      </label>
                      <input id="sd-ref" name="reference" required minLength={6} maxLength={40} className="field" />
                    </div>
                    <SubmitButton tone="ghost">Record deposit</SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={signAgreement.bind(null, app.id)} className="flex flex-wrap items-end gap-2 pt-3" >
                  <div>
                    <label className="field-label" htmlFor="sa-tier">
                      Tier
                    </label>
                    <select id="sa-tier" name="tier" className="field" defaultValue="Bronze">
                      {["Platinum", "Gold", "Silver", "Bronze"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="sa-target">
                      Annual target (units)
                    </label>
                    <input id="sa-target" name="targetUnits" type="number" min={0} max={10000} defaultValue={60} className="field w-32" />
                  </div>
                  <SubmitButton>Sign and onboard</SubmitButton>
                </ActionForm>
                <Hint>Creates the dealer on Dealer 360 with its compliance file and credit terms.</Hint>
              </Panel>
            )}

            {earlier.length > 0 && (
              <details className="disclosure surface">
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                  Earlier stages&apos; documents ({earlier.filter((d) => d.status === "Verified").length} of {earlier.length} verified)
                </summary>
                <ul className="space-y-1.5 px-4 pb-4 text-[12.5px]">
                  {earlier.map((d) => (
                    <li key={d.key} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span style={{ color: "var(--fg-faint)" }}>{d.stage} · </span>
                        {d.label}
                      </span>
                      <StatusPill value={d.status} />
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <Panel title="History" description="Every step, newest first.">
              <Timeline events={app.history ?? []} empty="Opened before history was recorded." />
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Applicant">
              <Facts
                rows={[
                  ["Contact", app.contactName ?? "—"],
                  app.phone && ["Phone", app.phone],
                  app.email && ["Email", app.email],
                  ["GSTIN", app.gstin ?? "Not given"],
                  app.pan && ["PAN", app.pan],
                  ["Investment", app.investment ?? "Not given"],
                  ["Came from", app.source ?? "—"],
                ]}
              />
            </Panel>

            {app.status !== "Approved" && app.status !== "Rejected" && (
              <details className="disclosure surface">
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                  Edit details…
                </summary>
                <ActionForm action={updateApplication.bind(null, app.id)} className="space-y-2 px-4 pb-4">
                  <input name="firm" defaultValue={app.firm} required maxLength={80} className="field" aria-label="Firm" />
                  <input name="city" defaultValue={app.city} required maxLength={60} className="field" aria-label="City" />
                  <select name="state" defaultValue={app.state} className="field" aria-label="State">
                    {INDIAN_STATES.map((st) => (
                      <option key={st}>{st}</option>
                    ))}
                  </select>
                  <select name="intent" defaultValue={app.intent} className="field" aria-label="Applying as">
                    {(["Dealer", "Distributor", "Service Partner"] satisfies Application["intent"][]).map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                  <input name="contactName" defaultValue={app.contactName ?? ""} required maxLength={80} className="field" placeholder="Contact person" aria-label="Contact" />
                  <input name="phone" defaultValue={app.phone ?? ""} maxLength={20} className="field" placeholder="Phone" aria-label="Phone" />
                  <input name="email" defaultValue={app.email ?? ""} maxLength={120} className="field" placeholder="Email" aria-label="Email" />
                  <input name="gstin" defaultValue={app.gstin ?? ""} maxLength={15} className="field font-mono uppercase" placeholder="GSTIN" aria-label="GSTIN" />
                  <input name="pan" defaultValue={app.pan ?? ""} maxLength={10} className="field font-mono uppercase" placeholder="PAN" aria-label="PAN" />
                  <select name="investment" defaultValue={app.investment ?? ""} className="field" aria-label="Investment">
                    <option value="">Investment not given</option>
                    {INVESTMENT_BANDS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                  <select name="source" defaultValue={app.source ?? ""} className="field" aria-label="Source">
                    <option value="">Source not recorded</option>
                    {APPLICATION_SOURCES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <select name="owner" defaultValue={staff.includes(app.owner) ? app.owner : ""} className="field" aria-label="Owner">
                    <option value="" disabled>
                      Owner…
                    </option>
                    {staff.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  <SubmitButton size="sm">Save</SubmitButton>
                </ActionForm>
              </details>
            )}

            {(working || app.status === "On Hold") && (
              <Panel title="Hold or reject" description="The reason is recorded and the applicant is told on WhatsApp.">
                <ActionForm action={setApplicationStatus.bind(null, app.id)} className="space-y-2">
                  <input name="reason" required minLength={3} maxLength={300} className="field" placeholder="Reason" aria-label="Reason" />
                  <div className="flex flex-wrap gap-2">
                    {working && (
                      <SubmitButton size="sm" tone="ghost" name="status" value="On Hold">
                        Put on hold
                      </SubmitButton>
                    )}
                    <SubmitButton size="sm" tone="danger" name="status" value="Rejected">
                      Reject
                    </SubmitButton>
                  </div>
                </ActionForm>
              </Panel>
            )}

            {app.stage === "Enquiry" && working && (
              <details className="disclosure surface">
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  Withdraw…
                </summary>
                <ActionForm action={deleteApplication.bind(null, app.id)} className="space-y-2 px-4 pb-4">
                  <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                    Removes {app.applicationNo}. Only while nothing has been collected.
                  </p>
                  <SubmitButton size="sm" tone="danger">
                    Yes, withdraw
                  </SubmitButton>
                </ActionForm>
              </details>
            )}

            {dealer && app.status === "Approved" && (
              <Panel title="Dealer" action={{ href: `/dms/orders/invoices/dealers/${dealer.id}`, label: "Account statement" }}>
                <Facts
                  rows={[
                    ["Code", dealer.code],
                    ["Tier", dealer.tier],
                    dealer.securityDeposit != null && ["Deposit", formatINR(dealer.securityDeposit)],
                    ["Credit limit", dealer.creditLimit != null ? formatINR(dealer.creditLimit) : "None"],
                  ]}
                />
              </Panel>
            )}
          </>
        }
      />
    </DetailScreen>
  );
}

function DocRow({ app, doc, editable }: { app: Application; doc: StageDoc; editable: boolean }) {
  const Icon = doc.status === "Verified" ? CircleCheck : doc.status === "Rejected" ? CircleX : doc.status === "Received" ? Inbox : CircleDashed;
  const color = doc.status === "Verified" ? "var(--positive)" : doc.status === "Rejected" ? "var(--negative)" : doc.status === "Received" ? "var(--info, var(--brand-ink))" : "var(--fg-faint)";
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 text-[12.5px]">
      <span className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} />
        <span className="min-w-0">
          <span className="block">
            {doc.label}
            {!doc.required && <span style={{ color: "var(--fg-faint)" }}> · optional</span>}
          </span>
          {doc.note && (
            <span className="block text-[11.5px]" style={{ color: doc.status === "Rejected" ? "var(--negative)" : "var(--fg-muted)" }}>
              {doc.note}
            </span>
          )}
          {doc.at && (
            <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
              {doc.status} {formatDate(doc.at)} · {doc.by}
            </span>
          )}
        </span>
      </span>
      {editable && doc.status !== "Verified" && (
        <ActionForm action={setStageDoc.bind(null, app.id, doc.key)} className="flex flex-wrap items-center gap-1.5">
          {doc.status === "Received" ? (
            <>
              <input name="note" maxLength={300} className="field h-8 w-44 text-[12px]" placeholder="What is wrong (to reject)" aria-label="Note" />
              <SubmitButton size="sm" name="status" value="Verified">
                Verify
              </SubmitButton>
              <SubmitButton size="sm" tone="danger" name="status" value="Rejected">
                Reject
              </SubmitButton>
            </>
          ) : (
            <SubmitButton size="sm" tone="ghost" name="status" value="Received">
              {doc.status === "Rejected" ? "Received again" : "Received"}
            </SubmitButton>
          )}
        </ActionForm>
      )}
    </li>
  );
}
