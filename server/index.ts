import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  BroadcastMode,
  CommentateRequest,
  PurchaseRequest,
  Speaker,
  Stats,
  Transaction,
  TransactionsResponse,
  Verdict,
} from "../shared/types";
import { computeStats } from "../shared/stats";
import { buildSeedTransactions, STARTING_BALANCE } from "./seed";
import { createNessiePurchase, fetchNessieTransactions } from "./nessie";
import { generateCommentary } from "./gemini";
import { synthesizeSpeech, TtsError } from "./tts";
import { PORT, configStatus } from "./env";

/**
 * The Express server. Holds every API key, talks to Nessie/Gemini/ElevenLabs,
 * and in production also serves the built Vite app so the whole project is a
 * single deployable Node service.
 */

const app = express();
app.use(express.json({ limit: "1mb" }));

// --- in-memory session state ------------------------------------------------
// No database, per spec. Purchases created during a demo live here so the
// scoreboard can include them even if Nessie rejects the write.
// Verdicts given so far live here too, so the server can compute
// criticsAverage and seed the canned postgame finalReview.
const sessionPurchases: Transaction[] = [];
const sessionVerdicts: Verdict[] = [];

function mergeWithSession(transactions: Transaction[]): Transaction[] {
  return [...transactions, ...sessionPurchases].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}

// --- health -----------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "wallet-sports-desk",
    config: configStatus(),
    sessionPurchases: sessionPurchases.length,
  });
});

// --- transactions + stats ---------------------------------------------------
app.get(
  "/api/transactions",
  async (req, res) => {
    // ?source=seed forces the offline path, which makes fallback testing a
    // one-liner and is handy for demos with no network.
    const forceSeed = String(req.query.source ?? "").toLowerCase() === "seed";

    if (forceSeed) {
      const transactions = buildSeedTransactions();
      const stats = computeStats(transactions, STARTING_BALANCE, sessionVerdicts);
      const body: TransactionsResponse = {
        transactions,
        stats,
        source: "seed",
        accountLabel: "DEMO CHECKING",
      };
      return res.json(body);
    }

    try {
      const result = await fetchNessieTransactions();
      if (result.transactions && result.transactions.length > 0) {
        const transactions = mergeWithSession(result.transactions);
        const stats = computeStats(transactions, STARTING_BALANCE, sessionVerdicts);
        const body: TransactionsResponse = {
          transactions,
          stats,
          source: "nessie",
          accountLabel: result.accountLabel,
        };
        return res.json(body);
      }
      throw new Error(result.error || "Nessie returned no purchases");
    } catch (error) {
      // Silent, by design: the demo must always have data.
      const transactions = buildSeedTransactions();
      const stats = computeStats(transactions, STARTING_BALANCE, sessionVerdicts);
      const body: TransactionsResponse = {
        transactions,
        stats,
        source: "seed",
        accountLabel: "DEMO CHECKING",
      };
      return res.json(body);
    }
  },
);

// --- gemini commentary ------------------------------------------------------
app.post("/api/commentate", async (req, res) => {
  const body = req.body as Partial<CommentateRequest>;
  const plays = Array.isArray(body?.plays) ? body.plays.slice(0, 3) : [];
  const mode: BroadcastMode = (body?.mode ?? "play") as BroadcastMode;

  // The client sends its current stats (incl. verdicts for criticsAverage),
  // but we recompute from the canonical server view when possible: never
  // trust numbers from the browser for math. Client verdicts are merged into
  // the server-side list so the average survives across segments.
  const clientVerdicts = Array.isArray((body as { verdicts?: unknown })?.verdicts)
    ? ((body as { verdicts?: Verdict[] }).verdicts as Verdict[])
    : [];
  for (const v of clientVerdicts) {
    if (v && typeof v.playId === "string" && !sessionVerdicts.some((sv) => sv.playId === v.playId)) {
      sessionVerdicts.push({ playId: v.playId, scores: { PBP: clampScore(v.scores?.PBP), COLOR: clampScore(v.scores?.COLOR) } });
    }
  }
  const stats = await resolveStats(body?.stats, sessionVerdicts);

  const { commentary, source } = await generateCommentary({ plays, stats, mode, verdicts: sessionVerdicts });
  for (const v of commentary.verdicts ?? []) {
    if (!sessionVerdicts.some((sv) => sv.playId === v.playId)) sessionVerdicts.push(v);
  }
  return res.json({ commentary, source });
});

function clampScore(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, Math.round(v)));
}

// --- reset (used by "Start over"): clears in-memory session state ---------
app.post("/api/reset", (_req, res) => {
  sessionPurchases.length = 0;
  sessionVerdicts.length = 0;
  return res.json({ ok: true });
});

/** Prefer freshly computed stats; fall back to what the client sent. */
async function resolveStats(clientStats: Stats | undefined, verdicts: Verdict[] = []): Promise<Stats> {
  try {
    const result = await fetchNessieTransactions();
    const base =
      result.transactions && result.transactions.length > 0
        ? mergeWithSession(result.transactions)
        : buildSeedTransactions();
    return computeStats(base, STARTING_BALANCE, verdicts);
  } catch {
    if (clientStats && typeof clientStats.currentBalance === "number") {
      return { ...clientStats };
    }
    return computeStats(
      [...buildSeedTransactions(), ...sessionPurchases],
      STARTING_BALANCE,
      verdicts,
    );
  }
}

// --- elevenlabs tts ---------------------------------------------------------
app.post("/api/tts", async (req, res) => {
  const { speaker, text } = req.body as {
    speaker?: Speaker;
    text?: string;
  };

  if ((speaker !== "PBP" && speaker !== "COLOR") || typeof text !== "string" || !text.trim()) {
    return res
      .status(400)
      .json({ error: 'Expected { speaker: "PBP" | "COLOR", text: string }' });
  }

  try {
    const audio = await synthesizeSpeech(speaker, text);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.send(audio);
  } catch (error) {
    // 502 tells the client to fall back to browser speechSynthesis.
    const status = error instanceof TtsError ? error.status : 502;
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[tts]", message);
    return res.status(status).json({ error: message });
  }
});

// --- impulse buy ------------------------------------------------------------
app.post("/api/purchase", async (req, res) => {
  const { merchant, amount, description } = req.body as PurchaseRequest;

  if (typeof merchant !== "string" || !merchant.trim()) {
    return res.status(400).json({ error: "merchant is required" });
  }
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }
  if (numeric > 10000) {
    return res.status(400).json({ error: "amount over $10,000 is not a play" });
  }

  // Always returns a Transaction, even when Nessie is down.
  const { transaction, persisted } = await createNessiePurchase({
    merchant: merchant.trim().slice(0, 60),
    amount: numeric,
    description: typeof description === "string" ? description.slice(0, 140) : undefined,
  });

  sessionPurchases.push(transaction);

  const all = mergeWithSession(
    (await fetchNessieTransactions()).transactions ?? buildSeedTransactions(),
  );
  return res.json({
    transaction,
    persisted,
    stats: computeStats(all, STARTING_BALANCE, sessionVerdicts),
  });
});

// --- production static hosting ---------------------------------------------
// In production the same Node process serves the built React app, so there is
// one deployable service and one .tech domain pointing at it.
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../dist");

if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback for anything that is not an API route. Using middleware
  // instead of a wildcard path keeps this compatible with Express 5's router.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`[server] Wallet Sports Desk API on http://localhost:${PORT}`);
  console.log(`[server] config:`, configStatus());
});
