"use client";

import { useId, useState } from "react";
import DealerAvatar from "./DealerAvatar";

/**
 * Picks a dealer image and hands the form a square data URL.
 *
 * The file never leaves the browser as-is: it is drawn to a canvas at
 * IMAGE_PX and re-encoded, so what reaches the server is a bounded thumbnail
 * rather than a phone photo. The app has no object store, and the
 * Content-Security-Policy allows `data:` images but not remote ones.
 *
 * The field carries only a NEW pick: an empty value means "leave the image
 * alone", so a dealer's stored image is never shipped back to the server (or
 * rendered a second time) just to survive a save. Removing has its own button.
 */

const IMAGE_PX = 256;
const QUALITY = 0.82;
/** Anything larger is a mistake — the resize happens after the read, not before. */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

async function squareDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_PX;
    canvas.height = IMAGE_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    const scale = Math.max(IMAGE_PX / bitmap.width, IMAGE_PX / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.drawImage(bitmap, (IMAGE_PX - width) / 2, (IMAGE_PX - height) / 2, width, height);
    // A browser without WebP encoding returns a PNG here, which for a photo is
    // several times larger — fall back to JPEG rather than ship that.
    const webp = canvas.toDataURL("image/webp", QUALITY);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", QUALITY);
  } finally {
    bitmap.close();
  }
}

export default function DealerImageField({ field, dealerName }: { field: string; dealerName: string }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();
  const noteId = `${inputId}-note`;

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is over 12 MB");
      return;
    }
    setBusy(true);
    try {
      setValue(await squareDataUrl(file));
    } catch {
      setError("That file could not be read as an image");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name={field} value={value} />
      <div className="flex items-center gap-2.5">
        <DealerAvatar name={dealerName} logo={value || null} size={40} />
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={`Image for ${dealerName}`}
          aria-describedby={error || busy ? noteId : undefined}
          aria-invalid={error ? true : undefined}
          aria-busy={busy}
          disabled={busy}
          className="field min-w-0 flex-1 py-1!"
          onChange={(event) => {
            void onPick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {(busy || error) && (
        <p id={noteId} role={error ? "alert" : "status"} className="text-[11.5px]" style={{ color: error ? "var(--negative)" : "var(--fg-muted)" }}>
          {error || "Resizing…"}
        </p>
      )}
    </div>
  );
}
