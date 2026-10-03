import type { Category, Transaction } from "../shared/types";

/**
 * Demo seed data: ~16 purchases over the last 10 days out of a $1,240 balance.
 *
 * This is what the demo runs on when Nessie is unreachable, AND it is what we
 * POST into a real Nessie account when it has fewer than 8 purchases, so the
 * sponsor judges can see real data in the Nessie console.
 *
 * `dayOffset` counts back from today, so the story always looks fresh.
 */

export const STARTING_BALANCE = 1240.0;

type SeedPurchase = {
  merchant: string;
  amount: number;
  category: Category;
  dayOffset: number;
  /** 24h clock hour the purchase happened. Late-night sprees are the joke. */
  hour: number;
  description: string;
};

const SEED_PURCHASES: SeedPurchase[] = [
  // Ten days ago: the season opener. Two coffees because we are unwell.
  { merchant: "Starbucks", amount: 6.75, category: "coffee", dayOffset: 10, hour: 8, description: "cold brew, still in bed" },
  { merchant: "Starbucks", amount: 7.1, category: "coffee", dayOffset: 10, hour: 9, description: "second cold brew, no regrets" },
  { merchant: "Chipotle", amount: 14.85, category: "restaurant", dayOffset: 9, hour: 12, description: "chicken bowl, no cilantro" },
  { merchant: "DoorDash", amount: 27.4, category: "food_delivery", dayOffset: 8, hour: 21, description: "delivery fee alone was $6.99" },
  { merchant: "Amazon", amount: 43.27, category: "shopping", dayOffset: 7, hour: 23, description: "a gadget we already own" },
  { merchant: "DoorDash", amount: 31.15, category: "food_delivery", dayOffset: 7, hour: 22, description: "second delivery in one night" },
  { merchant: "Netflix", amount: 15.49, category: "subscription", dayOffset: 6, hour: 7, description: "still watching the same show" },
  { merchant: "DoorDash", amount: 22.9, category: "food_delivery", dayOffset: 1, hour: 21, description: "the night before the spree began" },
  { merchant: "Spotify", amount: 11.99, category: "subscription", dayOffset: 5, hour: 6, description: "premium, mostly podcasts" },
  { merchant: "Insomnia Cookies", amount: 12.0, category: "restaurant", dayOffset: 4, hour: 1, description: "1am. cookies. in the dark." },
  { merchant: "Uber", amount: 18.6, category: "transport", dayOffset: 4, hour: 2, description: "ride home from the cookie store" },
  { merchant: "Steam", amount: 59.99, category: "gaming", dayOffset: 3, hour: 21, description: "the sale ends at midnight, obviously" },
  { merchant: "Venmo to roommate", amount: 85.0, category: "transfer", dayOffset: 2, hour: 18, description: "electricity, allegedly" },
  { merchant: "DoorDash", amount: 24.5, category: "food_delivery", dayOffset: 1, hour: 22, description: "four straight days, Linda. FOUR." },
  { merchant: "Target", amount: 67.34, category: "shopping", dayOffset: 1, hour: 14, description: "four candles, one throw pillow" },
  { merchant: "Apple.com", amount: 9.99, category: "subscription", dayOffset: 3, hour: 9, description: "cloud storage we do not use" },
];

/**
 * Keyword map used to infer a category from a merchant name. Also used to
 * categorize real Nessie merchants, which is why it is a bit broader than the
 * seed list.
 */
const CATEGORY_KEYWORDS: Array<[Category, string[]]> = [
  ["food_delivery", ["doordash", "uber eats", "grubhub", "postmates", "domino", "pizza", "papa john"]],
  ["restaurant", ["chipotle", "mcdonald", "starbucks cafe", "restaurant", "cafe", "canes", "sweetgreen", "insomnia cookies", "panera", "subway", "taco"]],
  ["coffee", ["starbucks", "dunkin", "peets", "coffee", "espresso", "blue bottle"]],
  ["subscription", ["netflix", "spotify", "hulu", "apple.com", "apple music", "icloud", "disney", "prime", "subscription", "adobe", "patreon", "onlyfans", "hbo", "paramount"]],
  ["transport", ["uber", "lyft", "amtrak", "shell", "chevron", "exxon", "parking", "transit", "metro", "gas station"]],
  ["gaming", ["steam", "epic games", "playstation", "xbox", "nintendo", "riot", "blizzard", "riot games", "gamestop"]],
  ["groceries", ["whole foods", "trader joe", "kroger", "safeway", "aldi", "publix", "grocery", "market"]],
  ["shopping", ["amazon", "target", "walmart", "best buy", "etsy", "ikea", "costco", "nike", "shopping", "temu", "shein", "zara"]],
  ["transfer", ["venmo", "zelle", "cash app", "paypal", "transfer", "p2p"]],
];

export function inferCategory(merchantName: string): Category {
  const name = (merchantName || "").toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => name.includes(keyword))) return category;
  }
  return "other";
}

/** Builds an ISO date `dayOffset` days before now at the given local hour. */
function isoDaysAgo(dayOffset: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dayOffset);
  d.setHours(hour, (dayOffset * 17) % 60, 0, 0);
  return d.toISOString();
}

/**
 * The seed set as normalized `Transaction[]`, sorted oldest first so the client
 * can replay history chronologically.
 * Ids are prefixed `seed-` so we can tell them apart from real Nessie ids.
 */
export function buildSeedTransactions(): Transaction[] {
  return SEED_PURCHASES.map((p, i) => ({
    id: `seed-${i + 1}`,
    merchant: p.merchant,
    amount: p.amount,
    category: p.category,
    date: isoDaysAgo(p.dayOffset, p.hour),
    description: p.description,
  })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Raw shape we POST into Nessie when seeding a fresh account. Kept separate
 * from `buildSeedTransactions` because Nessie wants a negative amount and a
 * merchant id, not our normalized category.
 */
export function seedPurchasesForNessie(): Array<{
  merchant: string;
  /** Nessie stores purchases as negative amounts. */
  amount: number;
  date: string;
  description: string;
}> {
  return SEED_PURCHASES.map((p) => ({
    merchant: p.merchant,
    amount: -p.amount,
    date: isoDaysAgo(p.dayOffset, p.hour),
    description: p.description,
  }));
}
