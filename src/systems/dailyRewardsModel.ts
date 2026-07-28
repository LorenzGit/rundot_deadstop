export interface DailyRewardDefinition {
    day: number;
    ink: number;
    label: string;
}

/** Seven days of ink. Day 7 covers most of the first ink-bought page. */
export const DAILY_REWARDS: readonly DailyRewardDefinition[] = [
    { day: 1, ink: 60, label: "60 INK" },
    { day: 2, ink: 80, label: "80 INK" },
    { day: 3, ink: 110, label: "110 INK" },
    { day: 4, ink: 140, label: "140 INK" },
    { day: 5, ink: 180, label: "180 INK" },
    { day: 6, ink: 220, label: "220 INK" },
    { day: 7, ink: 400, label: "400 INK" },
] as const;

export function dailyRewardIndex(totalClaims: number): number {
    return Math.max(0, Math.floor(totalClaims)) % DAILY_REWARDS.length;
}

export function dailyRewardClaimId(day: string): string {
    return `daily-reward:${day}`;
}

export function dailyRewardState(
    totalClaims: number,
    claimIds: readonly string[],
    day: string,
): {
    currentIndex: number;
    claimedToday: boolean;
} {
    return {
        currentIndex: dailyRewardIndex(totalClaims),
        claimedToday: claimIds.includes(dailyRewardClaimId(day)),
    };
}
