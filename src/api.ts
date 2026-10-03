import type {
  BroadcastMode,
  CommentaryResponse,
  Stats,
  Transaction,
  TransactionsResponse,
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
}): Promise<{ commentary: CommentaryResponse; source: "gemini" | "canned" }> {
  return postJson("/api/commentate", input);
}

export async function postPurchase(input: {
  merchant: string;
  amount: number;
  description?: string;
}): Promise<{ transaction: Transaction; persisted: boolean; stats: Stats }> {
  return postJson("/api/purchase", input);
}

/**
 * Ask the server for mp3 bytes.
 * Returns null (instead of throwing) whenever TTS is unavailable, which is the
 * signal for the client to fall back to browser speechSynthesis.
 */
export async function fetchSpeech(
  speaker: "PBP" | "COLOR",
  text: string,
): Promise<Blob | null> {
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker, text }),
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}
