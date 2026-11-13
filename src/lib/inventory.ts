import type { SparePart } from "@/server/types";

/** Why a counted figure differs from the book figure — shared by the action and the screen. */
export const ADJUSTMENT_REASONS = ["Stock Count", "Damage", "Write-off", "Correction"] as const;

/** What a part can be. One list, so the form can never offer what the action rejects. */
export const PART_CATEGORIES = ["Battery", "Motor", "Controller", "Body", "Electrical", "Consumable"] as const satisfies readonly SparePart["category"][];
