import { NextResponse } from "next/server";
import { ALL_MODULES, NAV_SECTIONS } from "@/lib/modules";

/**
 * GET /api/v1/modules — the module map as data.
 *
 * Useful during a walkthrough: it answers "what did you build" from the same
 * registry the sidebar renders, so the answer can never be out of date.
 */
export function GET() {
  return NextResponse.json({
    total: ALL_MODULES.length,
    sections: NAV_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      modules: section.nodes
        .flatMap((node) => (node.kind === "leaf" ? [node] : node.children))
        // The flag is only present on a module that still needs its live API.
        .map(({ href, label, blurb, underDevelopment }) => ({ href, label, blurb, ...(underDevelopment ? { underDevelopment } : {}) })),
    })),
  });
}
