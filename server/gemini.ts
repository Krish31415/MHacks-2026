import { GoogleGenAI, Type } from "@google/genai";

import type {
  BroadcastMode,
  CommentaryLine,
  CommentaryResponse,
  FinalReview,
  Speaker,
  Stats,
  Transaction,
  Verdict,
} from "../shared/types";
import { formatMoney, round2 } from "../shared/stats";
import { cannedFinalReview, cannedFor, cannedVerdictsFor } from "./canned";
import { GEMINI_API_KEY, GEMINI_MODEL, geminiConfigured } from "./env";

/**
 * The writing room. We hand Gemini real, already-computed numbers and a strict
 * JSON schema, and it returns 2-4 commentator lines, critic verdicts, and a
 * TV lower-third. Spec section 9 system prompt is used verbatim.
 *
 * Everything is defensive: missing key, throw, or unusable JSON -> canned.
 */

const SYSTEM_PROMPT = `You are the writing room for a two-person sports broadcast in which the hosts are also movie-style critics. They cover one person's bank account as if it were a championship game, and they review every purchase out loud.

THE BOOTH
- PBP: "Big Mike Donovan", play-by-play announcer. Loud, breathless, treats every purchase like a game-winning drive. Uses sports cliches constantly. Generous with scores and easily impressed.
- COLOR: "Linda Park", color commentator and former pro. Dry, analytical, brutally honest, drops stat callouts, quietly devastated by the user's decisions. Harsh with scores.

RULES
- Output ONLY JSON matching the schema.
- 2 to 4 lines total per response. Each line MAX 25 words. Lines alternate speakers, starting with PBP unless mode is "postgame".
- Use ONLY the numbers and merchants provided. Never invent amounts, merchants, or stats. Real figures make the jokes land.
- Treat the user's balance as "the score" and the bank as the opposing team.
- Every response should include at least one concrete number from the provided data.
- Be funny, specific, and roast the spending, not the person's identity. Keep it PG-13, no slurs, no real-person references.
- "intensity" 1 to 5: bigger purchases and streaks get higher intensity.
- "chyron" is a short ALL CAPS on-screen graphic (max 8 words) summarizing the play, like a TV broadcast lower-third.

CRITIC VERDICTS
- In "play" mode you must return exactly one verdict for every play provided, giving each critic an integer score from 0 to 10.
- Score the PURCHASE, not the person. Use judgment: essentials and good value score high, impulse buys, repeat food delivery, and unused subscriptions score low, a late night order scores lowest.
- The critics should disagree by at least 3 points about a third of the time, and the dialogue should react to the disagreement ("Mike, you gave that a 7?").
- Mention at least one score out loud in the dialogue, written as a normal number ("I'm giving that a 2"). Scores in the dialogue MUST match the scores in the verdicts.
- You may reference "criticsAverage" if it is provided.

MODES
- play: react live to the given purchase(s) and return verdicts.
- halftime: summarize the biggest trends so far using the stats object, like a halftime report. Return an empty verdicts array and no finalReview.
- postgame: wrap up the entire session. Give a final score (final balance), an MVP (worst purchase), and a closing roast. Return an empty verdicts array AND a finalReview: a score from each critic for the whole run and a pullQuote written like a movie poster blurb (style example: "A devastating portrait of a man and his DoorDash app."). Deliver the final scores in the dialogue like a film review show ending, including a thumbs verdict ("two thumbs down").`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker: { type: Type.STRING, enum: ["PBP", "COLOR"], description: '"PBP" or "COLOR".' },
          text: { type: Type.STRING, description: "Spoken line. Max 25 words." },
          intensity: { type: Type.INTEGER, description: "1 (mild) to 5 (unhinged)." },
        },
        required: ["speaker", "text", "intensity"],
        propertyOrdering: ["speaker", "text", "intensity"],
      },
    },
    chyron: { type: Type.STRING, description: "Short ALL CAPS lower-third. Max 8 words." },
    verdicts: {
      type: Type.ARRAY,
      description: 'One verdict per play in "play" mode (else []).',
      items: {
        type: Type.OBJECT,
        properties: {
          playId: { type: Type.STRING, description: "Copy the play id exactly." },
          scores: {
            type: Type.OBJECT,
            properties: {
              PBP: { type: Type.INTEGER, description: "Mike 0-10." },
              COLOR: { type: Type.INTEGER, description: "Linda 0-10." },
            },
            required: ["PBP", "COLOR"],
            propertyOrdering: ["PBP", "COLOR"],
          },
        },
        required: ["playId", "scores"],
        propertyOrdering: ["playId", "scores"],
      },
    },
    finalReview: {
      type: Type.OBJECT,
      description: 'Only "postgame": whole-run scores + pullQuote.',
      properties: {
        scores: {
          type: Type.OBJECT,
          properties: {
            PBP: { type: Type.INTEGER, description: "Mike whole-run 0-10." },
            COLOR: { type: Type.INTEGER, description: "Linda whole-run 0-10." },
          },
          required: ["PBP", "COLOR"],
          propertyOrdering: ["PBP", "COLOR"],
        },
        pullQuote: { type: Type.STRING, description: "Movie-poster blurb, max 20 words." },
      },
      required: ["scores", "pullQuote"],
      propertyOrdering: ["scores", "pullQuote"],
    },
  },
  required: ["lines", "chyron", "verdicts"],
  propertyOrdering: ["lines", "chyron", "verdicts", "finalReview"],
};

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return client;
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function clampScore(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, Math.round(v)));
}

function capWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  return words.length <= maxWords ? text : words.slice(0, maxWords).join(" ");
}

/** Real computed numbers rendered into a compact prompt block. Never LLM math. */
function buildPrompt(plays: Transaction[], stats: Stats, mode: BroadcastMode): string {
  const playsBlock = plays.length === 0
    ? "No individual plays this segment; react to the season stats below."
    : plays.map((p, i) => `Play ${i + 1} (id "${p.id}"): ${p.merchant}, ${formatMoney(p.amount)}, category ${p.category}.`).join("\n");
  const avg = stats.criticsAverage == null ? "none yet (first review)" : `${stats.criticsAverage.toFixed(1)} out of 10`;
  const biggest = stats.biggestPlay ? `${stats.biggestPlay.merchant} ${formatMoney(stats.biggestPlay.amount)}` : "none yet";
  const tail = mode === "play"
    ? "Return exactly one verdict per play above, in the same order, with playId copied exactly."
    : mode === "halftime"
      ? "Return verdicts as an empty array and no finalReview."
      : "Return verdicts as an empty array AND a finalReview with both critics scores plus a pullQuote (max 20 words).";
  return [
    `Cover ${plays.length} play(s) in mode "${mode}".`,
    "Plays:",
    playsBlock,
    `Stats: starting balance ${formatMoney(stats.startingBalance)}, current balance ${formatMoney(stats.currentBalance)}, total spent ${formatMoney(stats.totalSpent)} across ${stats.playsCount} plays.`,
    `Food delivery streak: ${stats.foodDeliveryStreak}. Subscription turnovers: ${stats.subscriptionsCount}. Biggest play so far: ${biggest}. Critics average so far: ${avg}.`,
    tail,
  ].join("\n");
}

function parseLines(obj: Record<string, unknown>): CommentaryLine[] | null {
  if (!Array.isArray(obj.lines)) return null;
  const lines: CommentaryLine[] = [];
  for (const entry of (obj.lines as unknown[]).slice(0, 4)) {
    if (!entry || typeof entry !== "object") continue;
    const { speaker, text, intensity } = entry as Partial<CommentaryLine>;
    if (typeof text !== "string" || text.trim() === "") continue;
    const normalizedSpeaker: Speaker = String(speaker).toUpperCase() === "COLOR" ? "COLOR" : "PBP";
    const raw = Number(intensity);
    const clamped = Number.isFinite(raw) ? Math.max(1, Math.min(5, Math.round(raw))) : 3;
    lines.push({ speaker: normalizedSpeaker, text: capWords(text.trim(), 30), intensity: clamped as CommentaryLine["intensity"] });
  }
  if (lines.length === 0) return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].speaker === lines[i - 1].speaker) lines[i].speaker = lines[i - 1].speaker === "PBP" ? "COLOR" : "PBP";
  }
  return lines;
}

function parseVerdicts(obj: Record<string, unknown>, plays: Transaction[]): Verdict[] {
  const raw = Array.isArray(obj.verdicts) ? (obj.verdicts as unknown[]) : [];
  const out: Verdict[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { playId, scores } = entry as { playId?: unknown; scores?: { PBP?: unknown; COLOR?: unknown } };
    if (typeof playId !== "string" || !scores || typeof scores !== "object") continue;
    out.push({ playId, scores: { PBP: clampScore(scores.PBP), COLOR: clampScore(scores.COLOR) } });
  }
  // Keep exactly one verdict per requested play, in order: drop extras, fill gaps canned.
  const byId = new Map(out.map((v) => [v.playId, v]));
  return plays.map((p) => byId.get(p.id) ?? cannedVerdictsFor([p])[0]);
}

function parseFinalReview(obj: Record<string, unknown>): FinalReview | undefined {
  const fr = obj.finalReview;
  if (!fr || typeof fr !== "object") return undefined;
  const { scores, pullQuote } = fr as { scores?: { PBP?: unknown; COLOR?: unknown }; pullQuote?: unknown };
  if (!scores || typeof scores !== "object") return undefined;
  return {
    scores: { PBP: clampScore(scores.PBP), COLOR: clampScore(scores.COLOR) },
    pullQuote: typeof pullQuote === "string" && pullQuote.trim() ? capWords(pullQuote.trim(), 20) : "Two thumbs down.",
  };
}

function parseCommentary(text: string, plays: Transaction[], stats: Stats, mode: BroadcastMode, verdictsSoFar: Verdict[]): CommentaryResponse | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const lines = parseLines(obj);
  if (!lines) return null;
  const chyron = typeof obj.chyron === "string" && obj.chyron.trim() ? obj.chyron.trim().toUpperCase().slice(0, 60) : "LIVE SPENDING";
  if (mode === "play") {
    return { lines, chyron, verdicts: parseVerdicts(obj, plays) };
  }
  if (mode === "halftime") {
    return { lines, chyron, verdicts: [] };
  }
  const finalReview = parseFinalReview(obj) ?? cannedFinalReview(verdictsSoFar, stats);
  return { lines, chyron, verdicts: [], finalReview };
}

/**
 * Ordered cheapest-model-first. During development GEMINI_MODEL is a
 * *-flash-lite tier and this walks upward, so we stay on cheap models. Switch
 * GEMINI_MODEL to the big model for the actual pitch and the same list walks
 * DOWNWARD instead, which is what you want live: never silently downgrade the
 * commentary because the headline model was momentarily saturated.
 */
const MODEL_FALLBACKS = [
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
];

async function callGemini(
  plays: Transaction[],
  stats: Stats,
  mode: BroadcastMode,
  verdictsSoFar: Verdict[],
  model: string,
): Promise<CommentaryResponse | null> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model,
    contents: buildPrompt(plays, stats, mode),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.95,
      topP: 0.95,
      maxOutputTokens: 700,
      abortSignal: AbortSignal.timeout(12000),
    },
  });
  const text = response.text;
  if (!text) return null;
  return parseCommentary(text, plays, stats, mode, verdictsSoFar);
}

const cache = new Map<string, CommentaryResponse>();

function fallbackFor(plays: Transaction[], stats: Stats, mode: BroadcastMode, verdictsSoFar: Verdict[]): CommentaryResponse {
  return cannedFor(plays, mode, verdictsSoFar, stats);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function generateCommentary(input: {
  plays: Transaction[];
  stats: Stats;
  mode: BroadcastMode;
  verdicts?: Verdict[];
}): Promise<{ commentary: CommentaryResponse; source: "gemini" | "canned" }> {
  const { plays, stats, mode, verdicts = [] } = input;
  const cacheKey = hash(JSON.stringify({
    plays: plays.map((p) => [p.id, p.merchant, round2(p.amount), p.category]),
    mode,
    balance: stats.currentBalance,
    streak: stats.foodDeliveryStreak,
    biggest: stats.biggestPlay?.amount ?? 0,
    playsCount: stats.playsCount,
    avg: stats.criticsAverage,
  }));
  const cached = cache.get(cacheKey);
  if (cached) return { commentary: cached, source: "gemini" };
  if (!geminiConfigured) return { commentary: fallbackFor(plays, stats, mode, verdicts), source: "canned" };
  for (const model of [GEMINI_MODEL, ...MODEL_FALLBACKS.filter((m) => m !== GEMINI_MODEL)]) {
    try {
      const result = await callGemini(plays, stats, mode, verdicts, model);
      if (result) {
        cache.set(cacheKey, result);
        return { commentary: result, source: "gemini" };
      }
    } catch (error) {
      console.warn(`[gemini] ${model} failed:`, describeError(error));
    }
  }
  return { commentary: fallbackFor(plays, stats, mode, verdicts), source: "canned" };
}
