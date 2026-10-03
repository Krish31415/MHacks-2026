import type { Stats, Transaction } from "./types";

/**
 * The stats engine. Pure functions, zero network, zero side effects.
 *
 * Rule #1 of this project: ALL numbers the commentators say are computed here
 * in TypeScript. Gemini only writes the jokes around numbers we already know
 * are correct, so it can never hallucinate an amount.
 */

export function sortNewestFirst(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

export function totalSpent(transactions: Transaction[]): number {
  return round2(transactions.reduce((sum, t) => sum + t.amount, 0));
}

/**
 * How many of the most recent plays are food_delivery before hitting a
 * different category. "THE THIRD DOORDASH IN FOUR DAYS" energy.
 */
export function foodDeliveryStreak(transactions: Transaction[]): number {
  let streak = 0;
  for (const t of sortNewestFirst(transactions)) {
    if (t.category === "food_delivery") streak += 1;
    else break;
  }
  return streak;
}

/** Biggest purchase, excluding transfers (moving your own money is not a play). */
export function biggestPlay(transactions: Transaction[]): Transaction | null {
  const contenders = transactions.filter((t) => t.category !== "transfer");
  if (contenders.length === 0) return null;
  return contenders.reduce((biggest, t) => (t.amount > biggest.amount ? t : biggest));
}

export function byCategory(
  transactions: Transaction[],
): Record<string, { count: number; total: number }> {
  const out: Record<string, { count: number; total: number }> = {};
  for (const t of transactions) {
    const bucket = (out[t.category] ??= { count: 0, total: 0 });
    bucket.count += 1;
    bucket.total = round2(bucket.total + t.amount);
  }
  return out;
}

export function computeStats(
  transactions: Transaction[],
  startingBalance: number,
): Stats {
  const spent = totalSpent(transactions);
  return {
    startingBalance: round2(startingBalance),
    currentBalance: round2(startingBalance - spent),
    totalSpent: spent,
    byCategory: byCategory(transactions),
    foodDeliveryStreak: foodDeliveryStreak(transactions),
    biggestPlay: biggestPlay(transactions),
    subscriptionsCount: transactions.filter((t) => t.category === "subscription")
      .length,
    playsCount: transactions.length,
  };
}

/**
 * Spend after the first `count` plays, oldest first. Used by the client to tick
 * the scoreboard down as the broadcast replays history.
 */
export function balanceAfter(
  transactions: Transaction[],
  startingBalance: number,
  count: number,
): number {
  const spentSoFar = [...transactions]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, count)
    .reduce((sum, t) => sum + t.amount, 0);
  return round2(startingBalance - spentSoFar);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** "$1,240.00" -> "$1240" style formatting for headlines and TTS text. */
export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}
