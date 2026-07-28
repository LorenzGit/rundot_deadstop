import { isPaletteId, PALETTE_IDS, PALETTES, type PaletteId } from "../game/art.ts";

export type { PaletteId };
export { isPaletteId, PALETTE_IDS, PALETTES };

export type PaletteUnlock =
    | { kind: "starter" }
    | { kind: "ink"; cost: number }
    | { kind: "entitlement"; entitlementId: string; productId: "ledger_pack" | "founder_bundle" };

export interface PaletteEntry {
    id: PaletteId;
    name: string;
    tagline: string;
    unlock: PaletteUnlock;
}

export const PALETTE_ENTRIES: Readonly<Record<PaletteId, PaletteEntry>> = {
    ledger: {
        id: "ledger",
        name: PALETTES.ledger.name,
        tagline: PALETTES.ledger.tagline,
        unlock: { kind: "starter" },
    },
    grid: {
        id: "grid",
        name: PALETTES.grid.name,
        tagline: PALETTES.grid.tagline,
        unlock: { kind: "ink", cost: 400 },
    },
    nightshift: {
        id: "nightshift",
        name: PALETTES.nightshift.name,
        tagline: PALETTES.nightshift.tagline,
        unlock: { kind: "ink", cost: 1200 },
    },
    blueprint: {
        id: "blueprint",
        name: PALETTES.blueprint.name,
        tagline: PALETTES.blueprint.tagline,
        unlock: { kind: "entitlement", entitlementId: "deadstop_ledger_pack", productId: "ledger_pack" },
    },
    carbon: {
        id: "carbon",
        name: PALETTES.carbon.name,
        tagline: PALETTES.carbon.tagline,
        unlock: { kind: "entitlement", entitlementId: "deadstop_ledger_pack", productId: "ledger_pack" },
    },
    redpen: {
        id: "redpen",
        name: PALETTES.redpen.name,
        tagline: PALETTES.redpen.tagline,
        unlock: { kind: "entitlement", entitlementId: "deadstop_pen_redpen", productId: "founder_bundle" },
    },
};

export const DEFAULT_PALETTE: PaletteId = "ledger";

/** Ownership that never needs a host round-trip: starter and ink-bought pages. */
export function paletteOwnedLocally(id: PaletteId, unlockedPaletteIds: readonly PaletteId[]): boolean {
    const unlock = PALETTE_ENTRIES[id].unlock;
    return unlock.kind === "starter" || (unlock.kind === "ink" && unlockedPaletteIds.includes(id));
}

export function paletteInkCost(id: PaletteId): number | null {
    const unlock = PALETTE_ENTRIES[id].unlock;
    return unlock.kind === "ink" ? unlock.cost : null;
}
