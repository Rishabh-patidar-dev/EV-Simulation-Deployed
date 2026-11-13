/**
 * Shown the moment a navigation starts, while the next page renders on the
 * server — every screen here reads live data, so without this a click would
 * look like nothing happened. Shaped like a module screen: title, headline
 * cards, then a table.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6">
      <div className="space-y-2">
        <div className="skeleton h-3 w-44" />
        <div className="flex items-center gap-3">
          <div className="skeleton h-10 w-10" />
          <div className="space-y-2">
            <div className="skeleton h-5 w-64" />
            <div className="skeleton h-3 w-80 max-w-[60vw]" />
          </div>
        </div>
      </div>
      <div className="grid-auto-fit gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface space-y-3 px-4 py-3.5">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-6 w-32" />
            <div className="skeleton h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="surface space-y-3 p-4">
        <div className="skeleton h-4 w-40" />
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="skeleton h-9 w-full" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
