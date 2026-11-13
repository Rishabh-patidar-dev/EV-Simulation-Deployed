/**
 * Marks a module that is not finished. Deliberately says no more than that:
 * every outside system in this app is simulated, so naming a "live API" here
 * would imply the other modules have one.
 */
export default function UnderDevelopmentNote() {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] font-semibold print:hidden" style={{ color: "var(--negative)" }}>
      <span aria-hidden className="dev-dot" />
      Under development
    </span>
  );
}
