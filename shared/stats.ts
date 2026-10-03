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
  verdicts: Array<{ scores: { PBP: number; COLOR: number } }> = [],
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
    criticsAverage: criticsAverage(verdicts),
  };
}

/** Mean of every critic score (both critics) across all verdicts, 1 decimal. Null if none. */
export function criticsAverage(
  verdicts: Array<{ scores: { PBP: number; COLOR: number } }>,
): number | null {
  const all: number[] = [];
  for (const v of verdicts) {
    const a = Number(v.scores?.PBP);
    const b = Number(v.scores?.COLOR);
    if (Number.isFinite(a)) all.push(a);
    if (Number.isFinite(b)) all.push(b);
  }
  if (all.length === 0) return null;
  // Spec section 8: the critics' average is rounded to ONE decimal.
  return round1(all.reduce((s, n) => s + n, 0) / all.length);
}

/** Rounds to one decimal place, e.g. 3.667 -> 3.7. */
export function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
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
