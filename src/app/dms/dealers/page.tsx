import Link from "next/link";
import DealerAvatar from "@/components/dms/DealerAvatar";
import DealerImageField from "@/components/dms/DealerImageField";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatINR } from "@/components/ui/primitives";
import { FilterChips, withParams } from "@/components/ui/workflow";
import { filterRows } from "@/lib/search";
import { setDealerLogo } from "@/server/actions/network";
import { readCollection } from "@/server/store";
import type { Dealer } from "@/server/types";

export const dynamic = "force-dynamic";

const TIERS: Dealer["tier"][] = ["Platinum", "Gold", "Silver", "Bronze"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const achievement = (d: Dealer) => (d.targetUnits ? Math.round((d.ytdUnits / d.targetUnits) * 100) : 0);

function DealerCard({ dealer }: { dealer: Dealer }) {
  const pct = achievement(dealer);
  return (
    <article className="surface flex min-w-0 flex-col">
      <Link href={`/dms/dealers/${dealer.id}`} className="flex items-start gap-3 px-4 pt-4">
        <DealerAvatar name={dealer.name} logo={dealer.logo} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
            {dealer.name}
          </span>
          <span className="block truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            {dealer.code} · {dealer.city}, {dealer.state}
          </span>
        </span>
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 px-4">
        <StatusPill value={dealer.status} />
        <Pill tone="brand">{dealer.tier}</Pill>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 px-4 text-[12px]">
        <div>
          <dt style={{ color: "var(--fg-muted)" }}>YTD / target</dt>
          <dd className="num font-semibold">
            {dealer.ytdUnits} / {dealer.targetUnits}
          </dd>
        </div>
        <div className="text-right">
          <dt style={{ color: "var(--fg-muted)" }}>Achievement</dt>
          <dd className="num font-semibold" style={{ color: pct >= 100 ? "var(--positive)" : undefined }}>
            {pct}%
          </dd>
        </div>
        <div>
          <dt style={{ color: "var(--fg-muted)" }}>Outstanding</dt>
          <dd className="num font-semibold" style={dealer.outstanding > 800_000 ? { color: "var(--negative)" } : undefined}>
            {formatINR(dealer.outstanding)}
          </dd>
        </div>
        <div className="text-right">
          <dt style={{ color: "var(--fg-muted)" }}>Health</dt>
          <dd className="num font-semibold">{dealer.health}</dd>
        </div>
      </dl>

      <div className="mt-2.5 px-4">
        <span className="block h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--chart-track)" }}>
          <span
            className="block h-full rounded-full"
            style={{ width: `${Math.min(100, Math.max(2, pct))}%`, background: pct >= 100 ? "var(--positive)" : "var(--brand)" }}
          />
        </span>
      </div>

      <details className="mt-3 px-4 pb-4">
        <summary className="cursor-pointer text-[11.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
          {dealer.logo ? "Change image" : "Add image"}
        </summary>
        <ActionForm action={setDealerLogo.bind(null, dealer.id)} className="mt-2 space-y-2">
          <DealerImageField field="logo" dealerName={dealer.name} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm">Save image</SubmitButton>
            {dealer.logo && (
              <SubmitButton size="sm" tone="danger" name="intent" value="clear">
                Remove
              </SubmitButton>
            )}
          </div>
        </ActionForm>
      </details>
    </article>
  );
}

export default async function DealersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ rows }, raw] = await Promise.all([readCollection("dealers"), searchParams]);
  const q = one(raw.q);
  const tier = one(raw.tier) || undefined;

  const ordered = [...rows].sort((a, b) => achievement(b) - achievement(a));
  const shown = filterRows(ordered, q).filter((d) => !tier || d.tier === tier);

  const active = rows.filter((d) => d.status === "Active");
  const atTarget = rows.filter((d) => d.ytdUnits >= d.targetUnits);

  return (
    <ModuleScreen
      href="/dms/dealers"
      exportCollection="dealers"
      searchPlaceholder="Search dealers"
      stats={[
        { label: "Dealers", value: String(rows.length), hint: `${active.length} active` },
        { label: "At or above target", value: String(atTarget.length), hint: "YTD units against annual target" },
        { label: "Network outstanding", value: formatINR(rows.reduce((s, d) => s + d.outstanding, 0)), hint: "Receivable from dealers" },
        { label: "States covered", value: String(new Set(rows.map((d) => d.state)).size), hint: "Territory footprint" },
      ]}
    >
      <FilterChips
        total={rows.length}
        current={tier}
        hrefFor={(value) => withParams("/dms/dealers", { q, tier: value })}
        options={TIERS.map((t) => ({ value: t, count: rows.filter((d) => d.tier === t).length }))}
      />
      {shown.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
          {q || tier ? "No dealer matches those filters." : "No dealers yet."}
        </p>
      ) : (
        <div className="grid-auto-fit gap-3 p-4">
          {shown.map((dealer) => (
            <DealerCard key={dealer.id} dealer={dealer} />
          ))}
        </div>
      )}
    </ModuleScreen>
  );
}
