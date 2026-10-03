import assert from "node:assert/strict";
import { test } from "node:test";

import type { Transaction } from "./types";
import {
  balanceAfter,
  biggestPlay,
  computeStats,
  foodDeliveryStreak,
} from "./stats";

// Small hand-rolled fixtures keep this file dependency-free.
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

function tx(
  merchant: string,
  amount: number,
  category: Transaction["category"],
  dayOffset: number,
): Transaction {
  return {
    id: `${merchant}-${dayOffset}`,
    merchant,
    amount,
    category,
    date: daysAgo(dayOffset),
  };
}

test("currentBalance is starting balance minus everything spent", () => {
  const stats = computeStats(
    [tx("Chipotle", 14.85, "restaurant", 1), tx("Steam", 59.99, "gaming", 0)],
    1240,
  );
  assert.equal(stats.totalSpent, 74.84);
  assert.equal(stats.currentBalance, 1165.16);
  assert.equal(stats.playsCount, 2);
});

test("foodDeliveryStreak counts back from the newest play only", () => {
  const streak = foodDeliveryStreak([
    tx("Starbucks", 6.75, "coffee", 3),
    tx("DoorDash", 31.15, "food_delivery", 1),
    tx("DoorDash", 24.5, "food_delivery", 0),
    tx("DoorDash", 27.4, "food_delivery", 0),
  ]);
  // newest three are DoorDash; the coffee play stops the count
  assert.equal(streak, 3);
});

test("biggestPlay ignores transfers", () => {
  const play = biggestPlay([
    tx("Venmo to roommate", 85.0, "transfer", 1),
    tx("Steam", 59.99, "gaming", 0),
  ]);
  assert.equal(play?.merchant, "Steam");
});

test("byCategory counts and totals each bucket", () => {
  const stats = computeStats(
    [
      tx("Netflix", 15.49, "subscription", 2),
      tx("Spotify", 11.99, "subscription", 1),
      tx("Steam", 59.99, "gaming", 0),
    ],
    1240,
  );
  assert.deepEqual(stats.byCategory.subscription, { count: 2, total: 27.48 });
  assert.equal(stats.subscriptionsCount, 2);
});

test("balanceAfter ticks down as the broadcast replays history", () => {
  const plays = [
    tx("Chipotle", 10, "restaurant", 2),
    tx("Steam", 20, "gaming", 1),
    tx("DoorDash", 30, "food_delivery", 0),
  ];
  assert.equal(balanceAfter(plays, 100, 0), 100);
  assert.equal(balanceAfter(plays, 100, 1), 90);
  assert.equal(balanceAfter(plays, 100, 3), 40);
});
