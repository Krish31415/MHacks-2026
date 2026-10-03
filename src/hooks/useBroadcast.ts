import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  BroadcastMode,
  BroadcastPhase,
  CommentaryLine,
  DataSource,
  FinalReview,
  Speaker,
  Stats,
  Transaction,
  TransactionsResponse,
  Verdict,
} from "../../shared/types";
import {
  balanceAfter,
  computeStats,
  criticsAverage,
  round2,
  sortNewestFirst,
} from "../../shared/stats";
import {
  fetchCommentary,
  fetchSpeech,
  fetchTransactions,
  postPurchase,
  resetSession,
} from "../api";

/**
 * useBroadcast owns the entire show: the play queue, the audio queue, and every
 * piece of broadcast state the UI renders.
 *
 * Design notes:
 * - Every number comes from computeStats (pure, unit-tested). The LLM never
 *   does arithmetic, so it cannot hallucinate an amount.
 * - TTS for all lines in a segment is requested concurrently, then played in
 *   order, so line 1 starts the moment it is ready while 2..n finish loading.
 * - If /api/tts fails (no key, no credits, 502) we transparently fall back to
 *   the browser's speechSynthesis with two different voices.
 * - An impulse buy that lands mid-sentence is queued, never interrupted.
 * - Verdicts land in state AFTER a segment's last line finishes; the average
 *   is recomputed from that state and sent on every commentate request.
 */

/** Roughly one 2-play segment plus a beat: lands the demo around 60-90s. */
const MAX_SEGMENTS = 7;
const PLAYS_PER_SEGMENT = 2;
const CROWD_EMOJI = ["\u{1F4A5}", "\u{1F389}", "\u{1F92F}", "\u{26A1}", "\u{1F4E3}"];

export type FeedPlay = {
  transaction: Transaction;
  /** 1-based play number for the "PLAY #7" label. */
  number: number;
  status: "pending" | "live" | "done";
  impulse?: boolean;
  verdict?: Verdict;
};

type Segment = {
  plays: Transaction[];
  mode: BroadcastMode;
  isImpulse?: boolean;
};

export function useBroadcast() {
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [phase, setPhase] = useState<BroadcastPhase>("pregame");
  const [feed, setFeed] = useState<FeedPlay[]>([]);
  const [balance, setBalance] = useState(0);
  const [activeSpeaker, setActiveSpeaker] = useState<Speaker | null>(null);
  const [caption, setCaption] = useState("");
  const [chyron, setChyron] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [segmentsPlayed, setSegmentsPlayed] = useState(0);
  const [browserVoice, setBrowserVoice] = useState(false);
  // --- verdict system (spec section 11) ---
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [latestVerdicts, setLatestVerdicts] = useState<Verdict[]>([]);
  const [finalReview, setFinalReview] = useState<FinalReview | null>(null);
  const verdictsRef = useRef<Verdict[]>([]);
  const verdictQueueRef = useRef<Verdict[]>([]);

  // Screen shake key + crowd emoji burst.
  const [shakeKey, setShakeKey] = useState(0);
  const [crowd, setCrowd] = useState<
    Array<{ id: number; emoji: string; left: number; spin: string }>
  >([]);

  // Refs for state that async playback must read without stale closures.
  const queueRef = useRef<Segment[]>([]);
  const runningRef = useRef(false);
  const stoppedRef = useRef(false);
  const startedRef = useRef(false);
  const impulseRef = useRef<Transaction[]>([]);
  const crowdIdRef = useRef(0);
  const displayBalanceRef = useRef(0);
  const baseTransactionsRef = useRef<Transaction[]>([]);
  const [hasStarted, setHasStarted] = useState(false);

  const startBalance = data?.stats.startingBalance ?? 1240;

  /** History plus anything bought during the show. */
  const allTransactions = useMemo(
    () => [...baseTransactionsRef.current, ...impulseRef.current],
    // feed changes whenever a play's status changes, which is our re-render
    // signal for recomputing after an impulse buy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed],
  );

  /** Live scoreboard stats: server numbers + impulse buys + critic scores. */
  const liveStats: Stats = useMemo(() => {
    const avg = criticsAverage(verdicts);
    const impulseTotal = round2(impulseRef.current.reduce((s, t) => s + t.amount, 0));
    const history = baseTransactionsRef.current;
    const newestImpulse = impulseRef.current.length
      ? sortNewestFirst(impulseRef.current)[0]
      : null;
    const newestHistory = history.length ? sortNewestFirst(history)[0] : null;
    const newest =
      newestImpulse && newestHistory
        ? new Date(newestImpulse.date) > new Date(newestHistory.date)
          ? newestImpulse
          : newestHistory
        : (newestImpulse ?? newestHistory);
    const streak =
      newest?.category === "food_delivery"
        ? (data?.stats.foodDeliveryStreak ?? 0)
        : 0;
    if (data) {
      return {
        ...data.stats,
        totalSpent: round2(data.stats.totalSpent + impulseTotal),
        currentBalance: round2(data.stats.currentBalance - impulseTotal),
        playsCount: data.stats.playsCount + impulseRef.current.length,
        foodDeliveryStreak: streak,
        criticsAverage: avg,
      };
    }
    return computeStats(allTransactions, startBalance, verdicts);
  }, [data, feed, startBalance, verdicts, allTransactions]);

  // --- data loading --------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchTransactions();
      setData(result);
      baseTransactionsRef.current = result.transactions;
      setBalance(result.stats.currentBalance);
      displayBalanceRef.current = result.stats.currentBalance;
      setFeed(
        result.transactions.map((t, i) => ({
          transaction: t,
          number: i + 1,
          status: "pending" as const,
        })),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- effects ---------------------------------------------------------------
  const triggerEffects = useCallback((intensity: number) => {
    // Big plays shake the whole screen and burst crowd emoji (CSS only).
    if (intensity >= 4) {
      setShakeKey((k) => k + 1);
      const burst = Array.from({ length: 8 }, () => ({
        id: ++crowdIdRef.current,
        emoji: CROWD_EMOJI[Math.floor(Math.random() * CROWD_EMOJI.length)],
        left: 5 + Math.random() * 90,
        spin: `${Math.random() > 0.5 ? "" : "-"}${20 + Math.random() * 60}deg`,
      }));
      setCrowd((current) => [...current.slice(-24), ...burst]);
      globalThis.setTimeout(() => {
        setCrowd((current) => current.filter((c) => !burst.some((b) => b.id === c.id)));
      }, 2200);
    }
  }, []);

  /** Ticks the scoreboard number down smoothly toward the target. */
  const tickBalanceTo = useCallback((target: number) => {
    const from = displayBalanceRef.current;
    const steps = 24;
    const delta = (target - from) / steps;
    let i = 0;
    const timer = globalThis.setInterval(() => {
      i += 1;
      const value = i >= steps ? target : round2(from + delta * i);
      displayBalanceRef.current = value;
      setBalance(value);
      if (i >= steps) globalThis.clearInterval(timer);
    }, 28);
  }, []);

  // --- audio: ElevenLabs first, browser voices as the safety net ---------------
  /**
   * Speaks one line: tries the server (ElevenLabs mp3) first, and falls back
   * to the browser's speechSynthesis with a per-speaker voice pick.
   * Resolves only when the line has actually finished playing.
   */
  const speak = useCallback(
    async (line: CommentaryLine, isMuted: boolean): Promise<void> => {
      if (isMuted) {
        const words = line.text.split(/\s+/).length;
        const seconds = Math.min(6, Math.max(1.2, (words / 150) * 60));
        await new Promise((resolve) => globalThis.setTimeout(resolve, seconds * 1000));
        return;
      }

      const blob = await fetchSpeech(line.speaker, line.text);
      if (blob) {
        const url = URL.createObjectURL(blob);
        try {
          await new Promise<void>((resolve) => {
            const audio = new Audio(url);
            const done = () => {
              audio.onended = null;
              audio.onerror = null;
              resolve();
            };
            audio.onended = done;
            audio.onerror = done;
            // If the file cannot decode, don't hang the show.
            globalThis.setTimeout(done, 15000);
            void audio.play().catch(done);
          });
        } finally {
          URL.revokeObjectURL(url);
        }
        return;
      }

      // ElevenLabs unavailable: use the browser's built-in voices instead.
      setBrowserVoice(true);
      await new Promise<void>((resolve) => {
        if (!("speechSynthesis" in window)) {
          globalThis.setTimeout(resolve, 1200);
          return;
        }
        const synth = window.speechSynthesis;
        // Cancel first: Chrome piles up utterances if you queue too eagerly.
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(line.text);
        const voices = synth.getVoices();
        const pick =
          line.speaker === "PBP"
            ? voices.find((v) => v.name.toLowerCase().includes("daniel")) ??
              voices.find((v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("male")) ??
              voices.find((v) => v.lang.startsWith("en"))
            : voices.find((v) => v.name.toLowerCase().includes("samantha")) ??
              voices.find((v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("female")) ??
              voices.find((v) => v.lang.startsWith("en"));
        if (pick) utterance.voice = pick;
        utterance.rate = line.speaker === "PBP" ? 1.08 : 0.96;
        utterance.pitch = line.speaker === "PBP" ? 1.1 : 0.9;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        synth.speak(utterance);
        // Safety net: a stuck utterance must never freeze the show.
        globalThis.setTimeout(resolve, 12000);
      });
    },
    [],
  );

  // --- the segment runner ----------------------------------------------------
  /**
   * Plays ONE commentary segment: ask Gemini (or canned) for lines, fire off
   * TTS for every line in parallel, then play them in order while syncing
   * speaker, captions, chyron, and the ticking balance. When the last line
   * finishes, the verdict cards reveal and the feed badges update.
   */
  const runSegment = useCallback(
    async (segment: Segment): Promise<boolean> => {
      const { plays, mode } = segment;
      const covered = feed.filter((f) => f.status === "done").length;
      const segmentStats: Stats = {
        startingBalance: startBalance,
        currentBalance: round2(balanceAfter(allTransactions, startBalance, covered + plays.length)),
        totalSpent: round2(startBalance - balanceAfter(allTransactions, startBalance, covered + plays.length)),
        byCategory: liveStats.byCategory,
        foodDeliveryStreak: liveStats.foodDeliveryStreak,
        biggestPlay: liveStats.biggestPlay,
        subscriptionsCount: liveStats.subscriptionsCount,
        playsCount: covered + plays.length,
        criticsAverage: criticsAverage(verdictsRef.current),
      };

      try {
        const { commentary } = await fetchCommentary({
          plays: plays.slice(0, 3),
          stats: segmentStats,
          mode,
          verdicts: verdictsRef.current,
        });

        // Verdicts reveal AFTER the last line finishes (see playLines below).
        if (commentary.verdicts && commentary.verdicts.length > 0) {
          verdictQueueRef.current.push(...commentary.verdicts);
        }
        if (mode === "postgame" && commentary.finalReview) {
          setFinalReview(commentary.finalReview);
        }

        setChyron(commentary.chyron);
        setBusy(true);

        // Mark the covered plays live so the feed highlights them.
        if (plays.length > 0) {
          const ids = new Set(plays.map((p) => p.id));
          setFeed((current) =>
            current.map((entry) =>
              ids.has(entry.transaction.id) ? { ...entry, status: "live" as const } : entry,
            ),
          );
        }

        // Tick the scoreboard as the segment lands.
        if (plays.length > 0) {
          const spent = plays.reduce((s, p) => s + p.amount, 0);
          tickBalanceTo(round2(displayBalanceRef.current - spent));
        }

        // Prefetch: request TTS for all lines in parallel, then play in order.
        // Line 1 starts as soon as it is ready while the rest keep loading.
        const audioPromises = commentary.lines.map((line) =>
          fetchSpeech(line.speaker, line.text),
        );
        let index = 0;
        for (const line of commentary.lines) {
          setActiveSpeaker(line.speaker);
          setCaption(`${line.speaker === "PBP" ? "MIKE" : "LINDA"}: ${line.text}`);
          triggerEffects(line.intensity);
          const blob = await audioPromises[index];
          index += 1;
          if (blob) {
            const url = URL.createObjectURL(blob);
            try {
              await new Promise<void>((resolve) => {
                const audio = new Audio(url);
                const done = () => {
                  audio.onended = null;
                  audio.onerror = null;
                  resolve();
                };
                audio.onended = done;
                audio.onerror = done;
                globalThis.setTimeout(done, 15000);
                let started = false;
                const startTimer = globalThis.setInterval(() => {
                  // muted mid-line: stop paying attention to the element.
                  if (!started) {
                    started = true;
                    globalThis.clearInterval(startTimer);
                    void audio.play().catch(done);
                  }
                }, 30);
              });
            } finally {
              URL.revokeObjectURL(url);
            }
          } else {
            await speak(line, muted);
          }
        }

        // Segment over: reveal verdicts, badge the feed, update the average.
        const fresh = verdictQueueRef.current.splice(0);
        if (fresh.length > 0) {
          verdictsRef.current = [...verdictsRef.current, ...fresh];
          setVerdicts([...verdictsRef.current]);
          setLatestVerdicts(fresh);
          const byId = new Map(fresh.map((v) => [v.playId, v]));
          setFeed((current) =>
            current.map((entry) => {
              const v = byId.get(entry.transaction.id);
              return v ? { ...entry, verdict: v } : entry;
            }),
          );
        }
        if (plays.length > 0) {
          const ids = new Set(plays.map((p) => p.id));
          setFeed((current) =>
            current.map((entry) =>
              ids.has(entry.transaction.id) ? { ...entry, status: "done" as const } : entry,
            ),
          );
        }

        setActiveSpeaker(null);
        setSegmentsPlayed((n) => n + 1);
        return true;
      } catch (error) {
        console.warn("[broadcast] segment failed:", error);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [allTransactions, balanceAfter, feed, liveStats, muted, speak, startBalance, tickBalanceTo, triggerEffects],
  );

  /** Drain the segment queue one at a time; impulse buys queue, never cut in. */
  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (queueRef.current.length > 0 && !stoppedRef.current) {
        const next = queueRef.current.shift();
        if (!next) break;
        await runSegment(next);
      }
    } finally {
      runningRef.current = false;
    }
  }, [runSegment]);

  // --- show control ----------------------------------------------------------
  const startBroadcast = useCallback(async () => {
    if (startedRef.current || !data) return;
    startedRef.current = true;
    setHasStarted(true);
    stoppedRef.current = false;
    setPhase("q1");

    // Replay history oldest-first, 2 plays per segment, ~7 segments max so the
    // show lands in 60-90s, then prompt HALFTIME instead of narrating forever.
    const history = [...data.transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const segments: Segment[] = [];
    for (let i = 0; i < history.length; i += PLAYS_PER_SEGMENT) {
      segments.push({ plays: history.slice(i, i + PLAYS_PER_SEGMENT), mode: "play" });
    }
    const capped = segments.slice(0, MAX_SEGMENTS);
    // Sprinkle a halftime report in the middle for broadcast texture.
    capped.splice(Math.ceil(capped.length / 2), 0, { plays: [], mode: "halftime" });
    queueRef.current.push(...capped);
    await pump();
    if (!stoppedRef.current) setPhase("q2");
  }, [data, pump]);

  /** IMPULSE BUY: the money shot. Adds to the feed, then queues commentary. */
  const impulseBuy = useCallback(
    async (merchant: string, amount: number, description?: string) => {
      const name = merchant.trim();
      const value = Number(amount);
      if (!name || !Number.isFinite(value) || value <= 0) return;

      // Show the play immediately so the click feels snappy.
      const optimistic: Transaction = {
        id: `impulse-${Date.now()}`,
        merchant: name,
        amount: value,
        category: "other",
        date: new Date().toISOString(),
        description,
      };
      impulseRef.current = [...impulseRef.current, optimistic];
      setFeed((current) => [
        ...current,
        {
          transaction: optimistic,
          number: current.length + 1,
          status: "live" as const,
          impulse: true,
        },
      ]);
      tickBalanceTo(displayBalanceRef.current - value);
      triggerEffects(5);

      // Queued behind whatever is currently speaking: never interrupt a line.
      queueRef.current.push({ plays: [optimistic], mode: "play", isImpulse: true });
      if (startedRef.current) {
        setPhase("q2");
        await pump();
      }

      // Persist to Nessie in the background; failure is harmless.
      try {
        const result = await postPurchase({ merchant: name, amount: value, description });
        impulseRef.current = impulseRef.current.map((t) =>
          t.id === optimistic.id ? result.transaction : t,
        );
        setFeed((current) =>
          current.map((entry) =>
            entry.transaction.id === optimistic.id
              ? { ...entry, transaction: result.transaction }
              : entry,
          ),
        );
      } catch {
        // Keep the optimistic entry: the demo still needs the play to exist.
      }
    },
    [pump, tickBalanceTo, triggerEffects],
  );

  const callHalftime = useCallback(async () => {
    queueRef.current.push({ plays: [], mode: "halftime" });
    setPhase("halftime");
    await pump();
  }, [pump]);

  const callPostgame = useCallback(async () => {
    queueRef.current.push({ plays: [], mode: "postgame" });
    setPhase("postgame");
    // Let this segment through even if a previous stop is still latched.
    stoppedRef.current = false;
    await pump();
    stoppedRef.current = true;
  }, [pump]);

  /** Start over: clear verdicts/audio state and reload the transaction book. */
  const startOver = useCallback(async () => {
    stopBroadcastRef.current?.();
    verdictsRef.current = [];
    verdictQueueRef.current = [];
    setVerdicts([]);
    setLatestVerdicts([]);
    setFinalReview(null);
    impulseRef.current = [];
    queueRef.current = [];
    startedRef.current = false;
    stoppedRef.current = false;
    setHasStarted(false);
    setPhase("pregame");
    setSegmentsPlayed(0);
    setChyron(null);
    setCaption("");
    setActiveSpeaker(null);
    try {
      await resetSession();
    } catch {
      // Session reset is best-effort; the reload below restores the UI anyway.
    }
    await load();
  }, [load]);

  /** Emergency brake for a demo gone sideways. */
  const stopBroadcast = useCallback(() => {
    stoppedRef.current = true;
    queueRef.current = [];
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setBusy(false);
  }, []);
  const stopBroadcastRef = useRef(stopBroadcast);
  stopBroadcastRef.current = stopBroadcast;

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const source: DataSource = data?.source ?? "seed";

  return {
    // data
    data,
    source,
    loading,
    loadError,
    stats: liveStats,
    feed,
    // verdict system
    verdicts,
    latestVerdicts,
    finalReview,
    // broadcast state
    phase,
    balance,
    activeSpeaker,
    caption,
    chyron,
    muted,
    busy,
    browserVoice,
    segmentsPlayed,
    hasStarted,
    // effects
    shakeKey,
    crowd,
    // actions
    startBroadcast,
    impulseBuy,
    callHalftime,
    callPostgame,
    startOver,
    stopBroadcast,
    toggleMute,
    reload: load,
    newestFirst: sortNewestFirst,
  };
}
