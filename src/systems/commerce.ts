import type { ShopOrderHistoryResponse, ShopPurchaseResponse, StorefrontItem } from "@series-inc/rundot-game-sdk";
import {
    fetchEntitlements,
    fetchShopCatalog,
    fetchShopOrderHistory,
    getRunCapabilities,
    purchaseShopItem,
    recordAnalytics,
} from "../sdk/runSdk.ts";
import { DEFAULT_PALETTE, PALETTE_ENTRIES, type PaletteId, paletteOwnedLocally } from "./cosmetics.ts";
import { INK_CASES, inkForCatalogItem, monetizationProducts } from "./monetization/config.ts";
import {
    createPurchaseCoordinator,
    type PendingPurchaseIntent,
    type PurchaseOutcome,
} from "./monetization/purchaseCoordinator.ts";
import { getMonetizationRuntime } from "./monetization/runtime.ts";
import { saveSystem } from "./save.ts";

import { analytics } from "./analytics/analyticsConfig.ts";
export type CommerceProductId =
    | "ledger_pack"
    | "no_interstitials"
    | "founder_bundle"
    | "ink_case_small"
    | "ink_case_medium"
    | "ink_case_large";

export interface PaletteCommerceView {
    visible: boolean;
    owned: boolean;
    entitlementVerified: boolean;
    purchasable: boolean;
    /** Set when the page is bought with ink rather than money. */
    inkCost: number | null;
    inkAffordable: boolean;
    productId: CommerceProductId | null;
    priceLabel: string;
    statusLabel: string;
}

export interface ProductCommerceView {
    productId: CommerceProductId;
    visible: boolean;
    owned: boolean;
    entitlementVerified: boolean;
    purchasable: boolean;
    priceLabel: string;
    statusLabel: string;
    name: string;
}

let catalog = new Map<string, StorefrontItem>();
let catalogConfigId: string | null = null;
let entitlementIds = new Set<string>();
let authoritativeEntitlementsLoaded = false;
let refreshInFlight: Promise<void> | null = null;

/**
 * Launch price hypotheses. These are only shown as a local development preview;
 * the live price always comes from the RUN catalog.
 */
const DEV_PREVIEW_PRICES: Readonly<Record<CommerceProductId, string>> = {
    ledger_pack: "199 RB",
    no_interstitials: "299 RB",
    founder_bundle: "399 RB",
    ink_case_small: "99 RB",
    ink_case_medium: "249 RB",
    ink_case_large: "499 RB",
};

export function isInkCase(productId: CommerceProductId): boolean {
    return productId in INK_CASES;
}

export function inkCaseAmount(productId: CommerceProductId): number {
    return INK_CASES[productId]?.ink ?? 0;
}

async function syncEntitlements(): Promise<void> {
    const entitlements = await fetchEntitlements();
    if (entitlements === null) {
        authoritativeEntitlementsLoaded = false;
        entitlementIds = new Set();
        return;
    }
    authoritativeEntitlementsLoaded = true;
    entitlementIds = new Set(
        entitlements
            .filter((entry) => entry.status === "active" && entry.quantity > 0)
            .map((entry) => entry.entitlementId),
    );
}

function liveProduct(productId: string): StorefrontItem | null {
    const definition = monetizationProducts.get(productId);
    return definition ? (catalog.get(definition.catalogItemId) ?? null) : null;
}

function formatLivePrice(item: StorefrontItem): string {
    const price = item.resolvedPrice.finalPrice;
    const unit = price.type.toLowerCase() === "bucks" ? "RB" : price.type.toUpperCase();
    return `${price.value} ${unit}`.trim();
}

function requiredRunsForProduct(productId: CommerceProductId): number {
    return productId === "founder_bundle" || productId === "no_interstitials" ? 2 : 1;
}

function productIsEligible(productId: CommerceProductId): boolean {
    const saved = saveSystem.get();
    return saved.records.totalRuns >= requiredRunsForProduct(productId) && saved.records.deepestLevel >= 2;
}

/**
 * Turns every fulfilled, not-yet-redeemed ink order into ink. The order id is
 * the idempotency key, so replaying history can never double-grant, and a
 * purchase interrupted mid-checkout is still honoured on the next boot.
 */
export async function redeemPurchasedInk(): Promise<number> {
    const capabilities = getRunCapabilities();
    if (!capabilities.shop || capabilities.mock) return 0;
    let history: Awaited<ReturnType<typeof fetchShopOrderHistory>>;
    try {
        history = await fetchShopOrderHistory();
    } catch (error) {
        console.warn("[commerce] ink redemption deferred; order history unavailable", error);
        return 0;
    }
    if (!history.success) return 0;
    let granted = 0;
    for (const order of history.orders) {
        if (order.status !== "fulfilled") continue;
        const ink = inkForCatalogItem(order.itemId);
        if (ink <= 0) continue;
        if (saveSystem.redeemInkOrder(order.orderId, ink)) {
            granted += ink;
            recordAnalytics("ink_case_redeemed", { itemId: order.itemId, orderId: order.orderId, ink });
        }
    }
    if (granted > 0) await saveSystem.flush();
    return granted;
}

const purchaseCoordinator = createPurchaseCoordinator<ShopPurchaseResponse, ShopOrderHistoryResponse>({
    shop: {
        async purchase(itemId, idempotencyKey) {
            const response = await purchaseShopItem(itemId, idempotencyKey);
            if (!response.success) throw new Error("RUN SHOP DID NOT CONFIRM THE ORDER");
            return response;
        },
        getOrderHistory: fetchShopOrderHistory,
    },
    pending: {
        load: () => saveSystem.get().monetization.pendingPurchaseIntent,
        async save(intent) {
            saveSystem.setPendingPurchaseIntent(intent);
            if (!(await saveSystem.flush())) throw new Error("PURCHASE INTENT COULD NOT BE SAVED");
        },
        async clear() {
            saveSystem.setPendingPurchaseIntent(null);
            await saveSystem.flush();
        },
    },
    findConfirmedOrder(history, intent) {
        if (!history.success) return null;
        return (
            history.orders.find(
                (order) =>
                    order.itemId === intent.catalogItemId &&
                    order.idempotencyKey === intent.idempotencyKey &&
                    order.status === "fulfilled",
            ) ?? null
        );
    },
    syncEntitlements,
    classifyError(error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (message.includes("cancel")) return "cancelled";
        if (message.includes("declin") || message.includes("insufficient") || message.includes("unavailable")) {
            return "failed";
        }
        return "unknown";
    },
});

export async function refreshCommerce(): Promise<void> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
        const [nextCatalog] = await Promise.all([fetchShopCatalog(), syncEntitlements()]);
        catalogConfigId = nextCatalog?.configId ?? null;
        catalog = new Map((nextCatalog?.items ?? []).filter((item) => item.active).map((item) => [item.itemId, item]));
    })().finally(() => {
        refreshInFlight = null;
    });
    return refreshInFlight;
}

export function paletteIsOwned(id: PaletteId): boolean {
    const saved = saveSystem.get();
    if (paletteOwnedLocally(id, saved.cosmetics.unlockedPaletteIds)) return true;
    const unlock = PALETTE_ENTRIES[id].unlock;
    return unlock.kind === "entitlement" && authoritativeEntitlementsLoaded && entitlementIds.has(unlock.entitlementId);
}

export function commerceEntitlementsReady(): boolean {
    return authoritativeEntitlementsLoaded;
}

export function hasVerifiedEntitlement(entitlementId: string): boolean {
    return authoritativeEntitlementsLoaded && entitlementIds.has(entitlementId);
}

export function productCommerceView(productId: CommerceProductId): ProductCommerceView {
    const definition = monetizationProducts.get(productId);
    if (!definition) throw new Error(`Missing commerce product ${productId}`);
    const item = liveProduct(productId);
    const capabilities = getRunCapabilities();
    const runtime = getMonetizationRuntime();
    const productEnabled = runtime.controls.products[productId]?.enabled === true;
    const controlsEnabled = runtime.controls.enabled && runtime.controls.purchasesEnabled && productEnabled;
    const hostReady = controlsEnabled && capabilities.shop && !capabilities.mock && item !== null;
    const devPreview = import.meta.env.DEV && (!capabilities.host || capabilities.mock);
    const eligible = productIsEligible(productId);
    // Ownership is only meaningful for something you can own once. A consumable
    // is always buyable again, and its entitlement list is empty — and an empty
    // list satisfies `every()` vacuously, which is what silently marked every
    // ink case OWNED and made it impossible to buy.
    const owned =
        definition.kind !== "consumable" &&
        definition.expectedEntitlementIds.length > 0 &&
        authoritativeEntitlementsLoaded &&
        definition.expectedEntitlementIds.every((entitlementId) => entitlementIds.has(entitlementId));
    const requiredRuns = requiredRunsForProduct(productId);
    return {
        productId,
        visible: owned || eligible,
        owned,
        entitlementVerified: authoritativeEntitlementsLoaded,
        purchasable: eligible && !owned && hostReady,
        priceLabel:
            item && eligible
                ? formatLivePrice(item)
                : eligible && devPreview
                  ? DEV_PREVIEW_PRICES[productId]
                  : eligible
                    ? "PRICE SYNC REQUIRED"
                    : `UNLOCKS AFTER ${requiredRuns} RUN${requiredRuns === 1 ? "" : "S"}`,
        statusLabel: owned
            ? "OWNED"
            : !eligible
              ? `FINISH ${requiredRuns} RUN${requiredRuns === 1 ? "" : "S"}`
              : devPreview
                ? `${DEV_PREVIEW_PRICES[productId]} · PREVIEW`
                : hostReady
                  ? definition.kind === "consumable"
                      ? formatLivePrice(item)
                      : "PERMANENT UNLOCK"
                  : "SYNCING OFFER",
        name: item?.name ?? definition.catalogItemId,
    };
}

export function paletteCommerceView(id: PaletteId): PaletteCommerceView {
    const unlock = PALETTE_ENTRIES[id].unlock;
    const owned = paletteIsOwned(id);
    if (unlock.kind === "starter") {
        return {
            visible: true,
            owned: true,
            entitlementVerified: false,
            purchasable: false,
            inkCost: null,
            inkAffordable: false,
            productId: null,
            priceLabel: "INCLUDED",
            statusLabel: "INCLUDED",
        };
    }
    if (unlock.kind === "ink") {
        const ink = saveSystem.get().wallet.ink;
        return {
            visible: true,
            owned,
            entitlementVerified: false,
            purchasable: !owned && ink >= unlock.cost,
            inkCost: unlock.cost,
            inkAffordable: ink >= unlock.cost,
            productId: null,
            priceLabel: `${unlock.cost} INK`,
            statusLabel: owned ? "OWNED" : ink >= unlock.cost ? "READY TO INK" : `${unlock.cost - ink} INK SHORT`,
        };
    }
    const product = productCommerceView(unlock.productId);
    return {
        visible: owned || product.visible,
        owned,
        entitlementVerified: authoritativeEntitlementsLoaded,
        purchasable: !owned && product.purchasable,
        inkCost: null,
        inkAffordable: false,
        productId: unlock.productId,
        priceLabel: product.priceLabel,
        statusLabel: owned ? "OWNED" : product.statusLabel,
    };
}

export interface CommerceDiagnostics {
    catalogConfigId: string | null;
    catalogItems: readonly {
        itemId: string;
        name: string;
        price: string;
    }[];
    entitlementIds: readonly string[];
    purchaseReady: boolean;
    testProductId: string;
    testProductName: string;
    testProductPrice: string;
    testProductOwned: boolean;
}

export function commerceDiagnostics(): CommerceDiagnostics {
    const testProductId = "ledger_pack";
    const definition = monetizationProducts.get(testProductId);
    if (!definition) throw new Error(`Missing diagnostic product ${testProductId}`);
    const item = liveProduct(testProductId);
    const runtime = getMonetizationRuntime();
    const capabilities = getRunCapabilities();
    const productEnabled = runtime.controls.products[testProductId]?.enabled === true;
    return {
        catalogConfigId,
        catalogItems: [...catalog.values()].map((entry) => ({
            itemId: entry.itemId,
            name: entry.name,
            price: formatLivePrice(entry),
        })),
        entitlementIds: [...entitlementIds].sort(),
        purchaseReady:
            runtime.controls.privateTestMode &&
            runtime.controls.enabled &&
            runtime.controls.purchasesEnabled &&
            productEnabled &&
            capabilities.host &&
            !capabilities.mock &&
            capabilities.shop &&
            item !== null,
        testProductId,
        testProductName: item?.name ?? definition.catalogItemId,
        testProductPrice: item ? formatLivePrice(item) : "NO LIVE PRICE",
        testProductOwned: entitlementIds.has("deadstop_ledger_pack"),
    };
}

export async function purchaseProduct(
    productId: CommerceProductId,
    placement = "ledger",
): Promise<PurchaseOutcome<ShopPurchaseResponse> | null> {
    const definition = monetizationProducts.get(productId);
    const item = definition ? liveProduct(productId) : null;
    const runtime = getMonetizationRuntime();
    const enabled =
        runtime.controls.enabled &&
        runtime.controls.purchasesEnabled &&
        runtime.controls.products[productId]?.enabled === true;
    if (!enabled || !definition || !item || !getRunCapabilities().shop || getRunCapabilities().mock) return null;
    analytics.funnelStep("purchase", 3);
    recordAnalytics("checkout_started", { productId, placement });
    const outcome = await purchaseCoordinator.purchase(productId, definition.catalogItemId);
    analytics.funnelStep("purchase", 4);
    recordAnalytics("checkout_result", { productId, placement, result: outcome.status });
    if (isInkCase(productId)) await redeemPurchasedInk();
    return outcome;
}

export async function reconcilePendingPurchase(): Promise<void> {
    // Ink is redeemed from order history on every boot, intent or not.
    await redeemPurchasedInk();
    const pending: PendingPurchaseIntent | null = purchaseCoordinator.pendingIntent();
    if (!pending) return;
    const outcome = await purchaseCoordinator.reconcilePending();
    if (outcome) {
        recordAnalytics("checkout_result", {
            productId: pending.productId,
            placement: "resume_reconciliation",
            result: outcome.status,
        });
    }
}

/** Falls back to the free page whenever a selection is no longer verified. */
export function enforceOwnedSelection(): PaletteId {
    const selected = saveSystem.get().cosmetics.selectedPalette;
    if (paletteIsOwned(selected)) return selected;
    saveSystem.setSelectedPalette(DEFAULT_PALETTE);
    void saveSystem.flush();
    return DEFAULT_PALETTE;
}
