// Shared data model. Imported by BOTH the React app and the Express server,
// so keep this file dependency-free (types only, no runtime imports).

export type Category =
  | "food_delivery"
  | "restaurant"
  | "coffee"
  | "shopping"
  | "subscription"
  | "transport"
  | "gaming"
  | "groceries"
  | "transfer"
  | "other";

export const CATEGORIES: Category[] = [
  "food_delivery",
  "restaurant",
  "coffee",
  "shopping",
  "subscription",
  "transport",
  "gaming",
  "groceries",
  "transfer",
  "other",
];

export type Transaction = {
  id: string;
  merchant: string;          // "Chipotle"
  amount: number;            // positive dollars spent
  category: Category;
  date: string;              // ISO
  description?: string;
};

export type CategoryStat = {
  count: number;
  total: number;
};

export type Stats = {
  startingBalance: number;
  currentBalance: number;
  totalSpent: number;
  byCategory: Record<string, CategoryStat>;
  /** Consecutive most-recent plays that are food_delivery. */
  foodDeliveryStreak: number;
  /** Highest-amount purchase, ignoring transfers. */
  biggestPlay: Transaction | null;
  /** Subscription count = "turnovers" in booth speak. */
  subscriptionsCount: number;
  playsCount: number;
  /** Mean of every critic score given so far (1 decimal), null if none. */
  criticsAverage: number | null;
};

export type Speaker = "PBP" | "COLOR";

export type Intensity = 1 | 2 | 3 | 4 | 5;

export type CommentaryLine = {
  speaker: Speaker;
  /** Keep it short (max ~25 words) so TTS stays snappy. */
  text: string;
  /** Drives UI effects: 4-5 shakes the screen and bursts crowd emoji. */
  intensity: Intensity;
};

export type Verdict = {
  playId: string;                          // matches Transaction.id
  scores: { PBP: number; COLOR: number };  // integers 0 to 10
};

export type FinalReview = {
  scores: { PBP: number; COLOR: number };  // integers 0 to 10, whole run
  pullQuote: string;                       // punchy, max 20 words
};

export type CommentaryResponse = {
  lines: CommentaryLine[];      // 2 to 4 lines per call
  /** Short ALL CAPS lower-third graphic, max 8 words. */
  chyron: string;
  verdicts: Verdict[];          // one per play in "play" mode, else []
  finalReview?: FinalReview;    // only in "postgame" mode
};

export type BroadcastMode = "play" | "halftime" | "postgame";

/** Where the transaction data on screen came from. Drives the data badge. */
export type DataSource = "nessie" | "seed";

export type TransactionsResponse = {
  transactions: Transaction[];
  stats: Stats;
  source: DataSource;
  /** Human readable account label, e.g. "PLAYER CHECKING". */
  accountLabel: string;
};

export type CommentateRequest = {
  /** 1 to 3 plays to cover in this segment. */
  plays: Transaction[];
  /** Server-computed real numbers. The LLM is told never to do math itself. */
  stats: Stats;
  mode: BroadcastMode;
  /** All verdicts given so far (client is source of truth). */
  verdicts?: Verdict[];
};

export type TtsRequest = {
  speaker: Speaker;
  text: string;
};

export type PurchaseRequest = {
  merchant: string;
  amount: number;
  description?: string;
};

/** What the booth is doing right now. Drives the Q1/Q2/HALFTIME/FINAL label. */
export type BroadcastPhase =
  | "pregame"
  | "q1"
  | "q2"
  | "halftime"
  | "postgame";
