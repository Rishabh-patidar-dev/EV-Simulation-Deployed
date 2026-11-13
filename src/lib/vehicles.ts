/**
 * Real Luxus Green Mobility model lineup and product photography — the same
 * files and names `EV-CRM-/apps/web/lib/vehicleCatalog.ts` uses, copied into
 * this app's `public/vehicles/`. Every "model" string generated anywhere in
 * the simulation (leads, enquiries, deals, bookings, vehicle stock) is drawn
 * from `VEHICLE_MODELS` below, so a model name on screen always resolves to a
 * real photo instead of a placeholder.
 */
const VEHICLE_IMAGES: Record<string, string> = {
  "LX Lifter": "/vehicles/lx-lifter.webp",
  "LX Spark": "/vehicles/lx-spark.webp",
  "LX Soorma": "/vehicles/lx-soorma.webp",
  "LX Nirmal": "/vehicles/lx-nirmal.webp",
  "LX Speedo": "/vehicles/lx-speedo.webp",
  "Queen EV": "/vehicles/queen-ev.webp",
  "LX EV Cargo": "/vehicles/lx-ev-cargo.webp",
  "LX DV": "/vehicles/lx-dv.webp",
  "LX Foodcart": "/vehicles/lx-foodcart.webp",
  "Queen EV DLX": "/vehicles/queen-ev-dlx.webp",
  "LX EV DLX": "/vehicles/lx-ev-dlx.webp",
  "LX DV DLX": "/vehicles/lx-dv-dlx.webp",
  "LX TEV DLX": "/vehicles/lx-tev-dlx.webp",
  "Queen Mini DLX": "/vehicles/queen-mini-dlx.webp",
  "LX EV 1.5 S.DLX": "/vehicles/lx-ev-15-sdlx.webp",
  "LX DV Mega": "/vehicles/lx-dv-mega.webp",
  "LX TEV Mega": "/vehicles/lx-tev-mega.webp",
};

export const VEHICLE_MODELS = Object.keys(VEHICLE_IMAGES);

export function vehicleImage(model: string): string | undefined {
  return VEHICLE_IMAGES[model];
}
