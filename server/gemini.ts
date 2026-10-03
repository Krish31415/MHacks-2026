import { GoogleGenAI, Type } from "@google/genai";

import type {
  BroadcastMode,
  CommentaryLine,
  CommentaryResponse,
  Speaker,
  Stats,
  Transaction,
} from "../shared/types";
import { formatMoney, round2 } from "../shared/stats";
import { cannedCommentary, cannedMode } from "./canned";
import { GEMINI_API_KEY, GEMINI_MODEL, geminiConfigured } from "./env";

/**
 * The writing room. We hand Gemini real, already-computed numbers and a strict
 * JSON schema, and it returns 2-4 commentator lines plus a TV lower-third.
 *
 * Everything is defensive: if the key is missing, the call throws, or the JSON
 * is unusable, we fall back to canned lines. The broadcast never dies.
 */

const SYSTEM_PROMPT = `You are the writing room for a two-person sports broadcast covering one person's bank account as if it were a championship game.

THE BOOTH
- PBP: "Big Mike Donovan", play-by-play announcer. Loud, breathless, treats every purchase like a game-winning drive. Uses sports cliches constantly.
- COLOR: "Linda Park", color commentator and former pro. Dry, analytical, brutally honest, drops stat callouts, quietly devastated by the user's decisions.

RULES
- Output ONLY JSON matching the schema.
- 2 to 4 lines total per response. Each line MAX 25 words. Lines alternate speakers, starting with PBP unless mode is "postgame".
- Use ONLY the numbers and merchants provided. Never invent amounts, merchants, or stats. Real figures make the jokes land.
- Treat the user's balance as "the score" and the bank as the opposing team.
- Every response should include at least one concrete number from the provided data.
- Be funny, specific, and roast the spending, not the person's identity. Keep it PG-13, no slurs, no real-person references.
- "intensity" 1 to 5: bigger purchases and streaks get higher intensity.
- "chyron" is a short ALL CAPS on-screen graphic (max 8 words) summarizing the play, like a TV broadcast lower-third.

MODES
- play: react live to the given purchase(s).
- halftime: summarize the biggest trends so far using the stats object, like a halftime report.
- postgame: wrap up the entire session, give a final score (final balance), an MVP (worst purchase), and a closing roast.`;

/**
 * Response schema for JSON mode. Gemini's structured output supports a subset of
 * JSON Schema, so this stays to plain objects/strings/integers/arrays.
 */
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker: {
            type: Type.STRING,
            enum: ["PBP", "COLOR"],
            description: 'Which commentator is talking. "PBP" or "COLOR".',
          },
          text: {
            type: Type.STRING,
            description: "The spoken line. Maximum 25 words.",
          },
          intensity: {
            type: Type.INTEGER,
            description:
              "1 (mild) to 5 (unhinged). Drives screen shake and crowd effects.",
          },
        },
        required: ["speaker", "text", "intensity"],
        propertyOrdering: ["speaker", "text", "intensity"],
      },
    },
    chyron: {
      type: Type.STRING,
      description: "Short ALL CAPS lower-third graphic. Maximum 8 words.",
    },
  },
  required: ["lines", "chyron"],
  propertyOrdering: ["lines", "chyron"],
};

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return client;
}

/** Cheap, stable, dependency-free string hash. Good enough for a cache key. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
/** Renders the real numbers we computed ourselves into a compact prompt block. */
function buildPrompt(
  plays: Transaction[],
  stats: Stats,
  mode: BroadcastMode,
): string {
  const playLines = plays.map(
    (p) =>
      `- ${p.merchant} | ${formatMoney(p.amount)} | category: ${p.category}` +
      (p.description ? ` | note: ${p.description}` : ""),
  );

  // Real, computed facts. The model must not do arithmetic on these.
  const biggest = stats.biggestPlay
    ? `${stats.biggestPlay.merchant} at ${formatMoney(stats.biggestPlay.amount)}`
    : "none yet";

  return `BROADCAST SEGMENT
MODE: ${mode}
PLAYS TO COVER (${plays.length}):
${playLines.length ? playLines.join("\n") : "- (no specific plays, use the stats)"}

COMPUTED STATS (these are the only numbers you may quote):
- Starting balance: ${formatMoney(stats.startingBalance)}
- Current balance (the score): ${formatMoney(stats.currentBalance)}
- Total spent (the bank is winning by): ${formatMoney(stats.totalSpent)}
- Plays so far: ${stats.playsCount}
- Food delivery streak (consecutive, most recent): ${stats.foodDeliveryStreak}
- Biggest play: ${biggest}
- Subscription turnovers: ${stats.subscriptionsCount}
- Spend by category: ${JSON.stringify(stats.byCategory)}

Write the segment now. Quote real numbers. Roast the spending, not the person.`;
}

function capWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ").replace(/[,;:]$/, "") + ".";
}

/** Defensive validation: never trust model output, even with a schema. */
function parseCommentary(raw: string): CommentaryResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const obj = parsed as Partial<CommentaryResponse>;
  if (!obj || !Array.isArray(obj.lines) || obj.lines.length === 0) return null;

  const lines: CommentaryLine[] = [];
  for (const entry of obj.lines.slice(0, 4)) {
    if (!entry || typeof entry !== "object") continue;
    const { speaker, text, intensity } = entry as Partial<CommentaryLine>;
    if (typeof text !== "string" || text.trim() === "") continue;

    // Never let it name a speaker the TTS route has no voice for.
    const normalizedSpeaker: Speaker =
      String(speaker).toUpperCase() === "COLOR" ? "COLOR" : "PBP";

    const rawIntensity = Number(intensity);
    const clamped = Number.isFinite(rawIntensity)
      ? Math.max(1, Math.min(5, Math.round(rawIntensity)))
      : 3;

    lines.push({
      speaker: normalizedSpeaker,
      // Word cap keeps TTS snappy so the broadcast keeps its pacing.
      text: capWords(text.trim(), 30),
      intensity: clamped as CommentaryLine["intensity"],
    });
  }

  if (lines.length === 0) return null;

  // Guarantee the alternation the booth's visuals depend on.
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].speaker === lines[i - 1].speaker) {
      lines[i].speaker = lines[i - 1].speaker === "PBP" ? "COLOR" : "PBP";
    }
  }

  const chyron =
    typeof obj.chyron === "string" && obj.chyron.trim()
      ? obj.chyron.trim().toUpperCase().slice(0, 60)
      : "LIVE SPENDING";

  return { lines, chyron };
}


async function callGemini(
  plays: Transaction[],
  stats: Stats,
  mode: BroadcastMode,
): Promise<CommentaryResponse | null> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: buildPrompt(plays, stats, mode),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      // Commentary should be creative, but not unhinged enough to wander off
      // the numbers we just handed it.
      temperature: 0.95,
      topP: 0.95,
      maxOutputTokens: 700,
      abortSignal: AbortSignal.timeout(12000),
    },
  });

  const text = response.text;
  if (!text) return null;
  return parseCommentary(text);
}

/**
 * In-memory cache keyed by a hash of the request. Same demo twice = instant,
 * and it saves API credits during judging.
 */
const cache = new Map<string, CommentaryResponse>();

function fallbackFor(
  plays: Transaction[],
  mode: BroadcastMode,
): CommentaryResponse {
  if (mode === "halftime" || mode === "postgame") return cannedMode(mode);
  const first = plays[0];
  return cannedCommentary(first?.merchant, first?.amount);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Main entry point used by POST /api/commentate.
 * Always resolves: a Gemini response, or a canned one. Never throws.
 */
export async function generateCommentary(input: {
  plays: Transaction[];
  stats: Stats;
  mode: BroadcastMode;
}): Promise<{ commentary: CommentaryResponse; source: "gemini" | "canned" }> {
  const { plays, stats, mode } = input;

  const cacheKey = hash(
    JSON.stringify({
      plays: plays.map((p) => [p.merchant, round2(p.amount), p.category]),
      mode,
      balance: stats.currentBalance,
      streak: stats.foodDeliveryStreak,
      biggest: stats.biggestPlay?.amount ?? 0,
      playsCount: stats.playsCount,
    }),
  );

  const cached = cache.get(cacheKey);
  if (cached) return { commentary: cached, source: "gemini" };

  if (!geminiConfigured) {
    return { commentary: fallbackFor(plays, mode), source: "canned" };
  }

  // Try twice (spec: retry once on parse failure), then give up gracefully.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callGemini(plays, stats, mode);
      if (result) {
        cache.set(cacheKey, result);
        return { commentary: result, source: "gemini" };
      }
    } catch (error) {
      console.warn(`[gemini] attempt ${attempt + 1} failed:`, describeError(error));
    }
  }

  return { commentary: fallbackFor(plays, mode), source: "canned" };
}
