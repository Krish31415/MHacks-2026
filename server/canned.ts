import type {
  BroadcastMode,
  Category,
  CommentaryLine,
  CommentaryResponse,
  FinalReview,
  Speaker,
  Stats,
  Transaction,
  Verdict,
} from "../shared/types";
import { round2 } from "../shared/stats";

/**
 * Fallback commentary when Gemini is missing/errors/returns garbage twice.
 * Generic enough for any purchase; a few lines mention a score out loud so
 * the canned path still feels like the product.
 */

type Canned = {
  speaker: Speaker;
  text: string;
  intensity: CommentaryLine["intensity"];
  chyron: string;
};

const CANNED_LINES: Canned[] = [
  { speaker: "PBP", text: "And another shot on goal, Linda! The crowd is on its feet and the balance is running out of time!", intensity: 4, chyron: "ANOTHER ONE GOES" },
  { speaker: "COLOR", text: "Let's be clear about what we're watching. A person spending money they already spent.", intensity: 3, chyron: "EXPENSIVE HABITS" },
  { speaker: "PBP", text: "That's cash leaving the building! I'm giving that heart a 6, Linda, a 6 for commitment!", intensity: 4, chyron: "CASH OUT THE DOOR" },
  { speaker: "COLOR", text: "I've covered a lot of athletes. Never one this far in the red. I'm giving that a 2.", intensity: 3, chyron: "DEEP IN THE RED" },
  { speaker: "PBP", text: "They did not need this! They bought this! Live from the spending floor!", intensity: 5, chyron: "THEY DID NOT NEED THIS" },
  { speaker: "COLOR", text: "Statistically, the fridge at home is full. Statistically, the fridge is winning. That's a 3.", intensity: 3, chyron: "THE FRIDGE IS WINNING" },
  { speaker: "PBP", text: "The hesitation! The look at the screen! Someone reconsidering their entire lifestyle!", intensity: 5, chyron: "THE HESITATION" },
  { speaker: "COLOR", text: "I'd like to speak about the word 'necessary.' Nobody has said it once tonight.", intensity: 2, chyron: "NOBODY SAID NECESSARY" },
  { speaker: "PBP", text: "Down goes the balance, up goes the regret! Mike gives it a 7 for pure drama!", intensity: 4, chyron: "DOWN GOES THE SCORE" },
  { speaker: "COLOR", text: "So many turnovers here. Subscription turnovers. Same amount, every month. Two thumbs down.", intensity: 3, chyron: "SUBSCRIPTION TURNOVERS" },
];

let cursor = 0;

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/** Canned scorer: Linda base by category, Mike 1-2 higher, clamped 0-10. */
export const LINDA_BASE_SCORE: Record<Category, number> = {
  groceries: 7, transport: 5, coffee: 4, shopping: 4, gaming: 3,
  subscription: 3, restaurant: 4, food_delivery: 2, transfer: 5, other: 4,
};

export function cannedVerdictFor(play: Transaction): Verdict {
  const linda = clampScore(LINDA_BASE_SCORE[play.category] ?? 4);
  const mike = clampScore(linda + (play.amount >= 40 ? 1 : 2));
  return { playId: play.id, scores: { PBP: mike, COLOR: linda } };
}

export function cannedVerdictsFor(plays: Transaction[]): Verdict[] {
  return plays.map(cannedVerdictFor);
}

/** Canned play-mode segment: 2 lines + exactly one verdict per play. */
export function cannedPlay(plays: Transaction[]): CommentaryResponse {
  const a = CANNED_LINES[cursor % CANNED_LINES.length];
  const b = CANNED_LINES[(cursor + 1) % CANNED_LINES.length];
  cursor += 2;
  const first = plays[0];
  const money = first ? `${first.amount.toFixed(2)} dollars` : "real money";
  const who = first?.merchant ?? "that merchant";
  const verdicts = cannedVerdictsFor(plays);
  const lindaScore = verdicts[0]?.scores.COLOR ?? 2;
  const secondSpeaker: Speaker = b.speaker === a.speaker ? (a.speaker === "PBP" ? "COLOR" : "PBP") : b.speaker;
  return {
    lines: [
      { speaker: a.speaker, text: a.text, intensity: a.intensity },
      { speaker: secondSpeaker, text: `${who}, ${money}. Linda has it a ${lindaScore}, and the tape agrees.`, intensity: b.intensity },
    ],
    chyron: a.chyron,
    verdicts,
  };
}

/** Back-compat: single-merchant canned lines. */
export function cannedCommentary(merchant?: string, amount?: number): CommentaryResponse {
  return cannedPlay([{
    id: "canned", merchant: merchant ?? "that merchant",
    amount: typeof amount === "number" ? amount : 20,
    category: "other", date: new Date().toISOString(),
  }]);
}

/** Canned postgame finalReview: scores from average of verdicts so far. */
export function cannedFinalReview(verdictsSoFar: Verdict[], stats?: Stats): FinalReview {
  const all: number[] = [];
  for (const v of verdictsSoFar) {
    if (Number.isFinite(v.scores.PBP)) all.push(v.scores.PBP);
    if (Number.isFinite(v.scores.COLOR)) all.push(v.scores.COLOR);
  }
  const avg = all.length > 0 ? round2(all.reduce((s, n) => s + n, 0) / all.length) : 3;
  const streakBit = stats && stats.foodDeliveryStreak >= 2
    ? " A devastating portrait of a person and their delivery app."
    : " A tragedy in three acts, starring a bank balance.";
  return { scores: { PBP: clampScore(avg + 1), COLOR: clampScore(avg - 1) }, pullQuote: `Two thumbs down.${streakBit}` };
}

/** Halftime + postgame canned shapes. */
export function cannedMode(mode: "halftime" | "postgame", verdictsSoFar: Verdict[] = [], stats?: Stats): CommentaryResponse {
  if (mode === "halftime") {
    return {
      lines: [
        { speaker: "PBP", text: "Halftime, everybody. The score is brutal and the second half looks worse.", intensity: 3 },
        { speaker: "COLOR", text: "Every time this bank account opens, it gets quieter. That is the halftime read.", intensity: 3 },
        { speaker: "PBP", text: "Back in a moment, and by back I mean back at these numbers.", intensity: 2 },
      ],
      chyron: "HALFTIME REPORT",
      verdicts: [],
    };
  }
  const finalReview = cannedFinalReview(verdictsSoFar, stats);
  return {
    lines: [
      { speaker: "COLOR", text: `Final score is in, the bank wins in a walkover. Mike gives it a ${finalReview.scores.PBP}, I give it a ${finalReview.scores.COLOR}.`, intensity: 5 },
      { speaker: "PBP", text: "Two thumbs down from the booth, folks! But what a run to get here!", intensity: 4 },
      { speaker: "COLOR", text: "Same time next week? Assuming there is a next week. For the balance, I'm not sure.", intensity: 3 },
    ],
    chyron: "FINAL: THE BANK WINS",
    verdicts: [],
    finalReview,
  };
}

/** Dispatch helper for the Gemini fallback path. */
export function cannedFor(plays: Transaction[], mode: BroadcastMode, verdictsSoFar: Verdict[] = [], stats?: Stats): CommentaryResponse {
  if (mode === "halftime" || mode === "postgame") return cannedMode(mode, verdictsSoFar, stats);
  return cannedPlay(plays);
}
