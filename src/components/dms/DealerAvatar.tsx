import { initials } from "@/lib/operator";

/** A dealer's image where there is one, its initials where there is not. */
export default function DealerAvatar({ name, logo, size = 48 }: { name: string; logo?: string | null; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-[13px] font-bold"
      style={{ height: size, width: size, background: "var(--brand-soft)", color: "var(--brand-ink)" }}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
