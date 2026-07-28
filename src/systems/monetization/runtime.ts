import { fetchLiveOpsConfig } from "../../sdk/runSdk.ts";
import {
    type MonetizationLiveOps,
    type MonetizationLiveOpsInput,
    normalizeMonetizationLiveOps,
} from "./monetizationLiveOps.ts";

export interface MonetizationRuntime {
    loaded: boolean;
    configVersion: string | null;
    controls: MonetizationLiveOps;
}

let runtime: MonetizationRuntime = {
    loaded: false,
    configVersion: null,
    controls: normalizeMonetizationLiveOps(null),
};

function monetizationInput(value: unknown): MonetizationLiveOpsInput | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as MonetizationLiveOpsInput;
}

export async function refreshMonetizationRuntime(): Promise<void> {
    const config = await fetchLiveOpsConfig();
    runtime = {
        loaded: true,
        configVersion: config?.configVersion ?? null,
        controls: normalizeMonetizationLiveOps(monetizationInput(config?.values.monetization)),
    };
}

export function getMonetizationRuntime(): Readonly<MonetizationRuntime> {
    return runtime;
}
