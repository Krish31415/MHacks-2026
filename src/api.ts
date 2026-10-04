import type {
  BroadcastMode,
  CommentaryResponse,
  Stats,
  Transaction,
  TransactionsResponse,
  Verdict,
} from "../shared/types";

/**
 * Thin fetch wrapper for our own API. Every call has a defensive catch so a
 * dead server degrades the UI instead of blank-screening the demo.
 */

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(
      (detail as { error?: string } | null)?.error ?? `HTTP ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export async function fetchTransactions(): Promise<TransactionsResponse> {
  const response = await fetch("/api/transactions");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function fetchCommentary(input: {
  plays: Transaction[];
  stats: Stats;
  mode: BroadcastMode;
  verdicts?: Verdict[];
}): Promise<{ commentary: CommentaryResponse; source: "gemini" | "canned" }> {
  return postJson("/api/commentate", input);
}

export async function resetSession(): Promise<{ ok: boolean }> {
  return postJson("/api/reset", {});
}

export async function postPurchase(input: {
  merchant: string;
  amount: number;
  description?: string;
}): Promise<{ transaction: Transaction; persisted: boolean; stats: Stats }> {
  return postJson("/api/purchase", input);
}

/** Either synthesized mp3 bytes, or a human-readable reason we couldn't. */
export type SpeechResult = { blob: Blob | null; reason: string | null };

/**
 * Turn a TTS failure into something a human can act on. The server passes the
 * upstream message through, but ElevenLabs' quota error is a wall of JSON --
 * and "browser voices" with no explanation makes an out-of-credits key look
 * exactly like a misconfigured voice.
 */
function describeTtsFailure(status: number, body: unknown): string {
  const raw =
    body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : "";
  if (/quota_exceeded|credits remaining/i.test(raw)) {
    return "out of credits — raise the key quota in ElevenLabs";
  }
  if (status === 401) return "ElevenLabs rejected the API key";
  if (status === 429) return "ElevenLabs rate limit — try again shortly";
  if (status === 503) return "ElevenLabs not configured";
  if (!raw) return `ElevenLabs HTTP ${status}`;
  return raw.replace(/\s+/g, " ").slice(0, 120);
}

/**
 * Ask the server for mp3 bytes.
 * Returns a null blob plus the reason whenever TTS is unavailable, which is the
 * signal for the client to fall back to browser speechSynthesis.
 */
export async function fetchSpeech(
  speaker: "PBP" | "COLOR",
  text: string,
): Promise<SpeechResult> {
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker, text }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      return { blob: null, reason: describeTtsFailure(response.status, detail) };
    }
    const blob = await response.blob();
    if (blob.size === 0) return { blob: null, reason: "ElevenLabs returned no audio" };
    return { blob, reason: null };
  } catch {
    return { blob: null, reason: "could not reach the TTS endpoint" };
  }
}
