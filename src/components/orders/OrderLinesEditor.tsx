"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

const VARIANTS = ["Standard", "Deluxe", "Mega", "Super Deluxe"] as const;
const MAX_LINES = 12;
const GST_RATE = 0.05;

interface Line {
  key: number;
  model: string;
  variant: (typeof VARIANTS)[number];
  quantity: number;
  unitPrice: number;
}

const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

/**
 * The product lines of a new dealer order, inside the order's ActionForm.
 * Each line posts `model`, `variant`, `quantity` and `unitPrice` fields in
 * order; the server validates every one. The price starts at the model's
 * average price in current stock and can be changed.
 */
export default function OrderLinesEditor({ models, listPrices }: { models: string[]; listPrices: Record<string, number> }) {
  const priceFor = (model: string) => listPrices[model] ?? 150_000;
  const [nextKey, setNextKey] = useState(1);
  const [lines, setLines] = useState<Line[]>([{ key: 0, model: models[0], variant: "Standard", quantity: 5, unitPrice: priceFor(models[0]) }]);

  const update = (key: number, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const addLine = () => {
    const used = new Set(lines.map((l) => l.model));
    const model = models.find((m) => !used.has(m)) ?? models[0];
    setLines((current) => [...current, { key: nextKey, model, variant: "Standard", quantity: 1, unitPrice: priceFor(model) }]);
    setNextKey((k) => k + 1);
  };

  const units = lines.reduce((sum, l) => sum + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
  const value = lines.reduce((sum, l) => sum + (Number.isFinite(l.quantity) && Number.isFinite(l.unitPrice) ? l.quantity * l.unitPrice : 0), 0);

  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5.5rem_8rem_7rem_2.25rem] gap-2 px-0.5 md:grid">
        {["Model", "Variant", "Qty", "Unit price (₹)", "Amount", ""].map((h) => (
          <span key={h} className="field-label mb-0">
            {h}
          </span>
        ))}
      </div>

      {lines.map((line, index) => (
        <div
          key={line.key}
          className="grid grid-cols-2 gap-2 rounded-[10px] p-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5.5rem_8rem_7rem_2.25rem] md:items-center md:rounded-none md:p-0"
          style={{ border: "1px solid var(--border)" }}
        >
          <select
            name="model"
            aria-label={`Line ${index + 1} model`}
            className="field col-span-2 md:col-span-1"
            value={line.model}
            onChange={(e) => update(line.key, { model: e.target.value, unitPrice: priceFor(e.target.value) })}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            name="variant"
            aria-label={`Line ${index + 1} variant`}
            className="field"
            value={line.variant}
            onChange={(e) => update(line.key, { variant: e.target.value as Line["variant"] })}
          >
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <input
            name="quantity"
            type="number"
            min={1}
            max={500}
            step={1}
            required
            aria-label={`Line ${index + 1} quantity`}
            className="field"
            value={Number.isFinite(line.quantity) ? line.quantity : ""}
            onChange={(e) => update(line.key, { quantity: e.target.valueAsNumber })}
          />
          <input
            name="unitPrice"
            type="number"
            min={10000}
            max={10000000}
            step={500}
            required
            aria-label={`Line ${index + 1} unit price`}
            className="field"
            value={Number.isFinite(line.unitPrice) ? line.unitPrice : ""}
            onChange={(e) => update(line.key, { unitPrice: e.target.valueAsNumber })}
          />
          <span className="num self-center text-[12.5px] font-semibold md:text-right">
            {Number.isFinite(line.quantity * line.unitPrice) ? inr(line.quantity * line.unitPrice) : "—"}
          </span>
          <button
            type="button"
            onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
            disabled={lines.length === 1}
            aria-label={`Remove line ${index + 1}`}
            title={lines.length === 1 ? "An order needs at least one line" : "Remove line"}
            className="flex h-9 w-9 items-center justify-center justify-self-end rounded-[8px] transition-colors hover:bg-[color:var(--negative-surface)] disabled:opacity-40"
            style={{ color: "var(--negative)" }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button type="button" onClick={addLine} disabled={lines.length >= MAX_LINES} className="btn btn-ghost btn-sm">
          <Plus className="h-3.5 w-3.5" />
          Add line
        </button>
        <p className="num text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
          {units} unit{units === 1 ? "" : "s"} · {inr(value)} + 5% GST ={" "}
          <span className="font-semibold" style={{ color: "var(--fg)" }}>
            {inr(value * (1 + GST_RATE))}
          </span>
        </p>
      </div>
    </div>
  );
}
