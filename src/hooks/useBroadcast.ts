import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  BroadcastMode,
  BroadcastPhase,
  CommentaryLine,
  DataSource,
  Speaker,
  Stats,
  Transaction,
  TransactionsResponse,
} from "../../shared/types";
import {
  balanceAfter,
  computeStats,
  sortNewestFirst,
} from "../../shared/stats";
import {
  fetchCommentary,
  fetchSpeech,
  fetchTransactions,
  postPurchase,
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
    [feed],
  );

  const liveStats: Stats = useMemo(
    () => computeStats(allTransactions, startBalance),
    [allTransactions, startBalance],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchTransactions();
      baseTransactionsRef.current = result.transactions;
      setData(result);
      displayBalanceRef.current = result.stats.startingBalance;
      setBalance(result.stats.startingBalance);
      setFeed(
        result.transactions.map((transaction, i) => ({
          transaction,
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

  // --- browser speechSynthesis fallback -------------------------------------
  // Two different voices so the booth still sounds like two people when
  // ElevenLabs is unavailable.
  const browserVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const loadVoices = () => {
      browserVoicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const isMaleVoice = (name: string) =>
    /male|daniel|alex|fred|george|david|mark/i.test(name);

  const pickBrowserVoice = useCallback(
    (speaker: Speaker): SpeechSynthesisVoice | null => {
      const voices = browserVoicesRef.current;
      if (voices.length === 0) return null;
      if (speaker === "PBP") {
        const male =
          voices.find((v) => isMaleVoice(v.name)) ??
          voices.find((v) => v.lang.startsWith("en"));
        return male ?? voices[0];
      }
      // COLOR: any *other* English voice, so the two never sound identical.
      const pbp = voices.find((v) => isMaleVoice(v.name));
      const other = voices.find(
        (v) => v.lang.startsWith("en") && v.voiceURI !== pbp?.voiceURI,
      );
      return other ?? voices[voices.length - 1];
    },
    [],
  );

  /** Rough spoken length, used when audio is muted or unavailable. */
  const estimateDuration = useCallback((text: string): number => {
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1200, (words / 2.7) * 1000);
  }, []);

// --- screen shake + crowd burst (CSS only) --------------------------------
  const triggerEffects = useCallback((intensity: number) => {
    if (intensity < 4) return;
    // Re-key the animation so consecutive bursts both play.
    setShakeKey((k) => k + 1);
    const burst = Array.from({ length: intensity >= 5 ? 9 : 6 }, () => {
      crowdIdRef.current += 1;
      return {
        id: crowdIdRef.current,
        emoji: CROWD_EMOJI[Math.floor(Math.random() * CROWD_EMOJI.length)],
        left: 5 + Math.random() * 90,
        spin: `${Math.round((Math.random() - 0.5) * 120)}deg`,
      };
    });
    setCrowd((current) => [...current, ...burst]);
    // Clean up so the DOM does not grow forever.
    setTimeout(() => setCrowd((current) => current.slice(-18)), 1600);
  }, []);

  /** Animate the scoreboard from its current value to the next one. */
  const tickBalanceTo = useCallback((target: number) => {
    const from = displayBalanceRef.current;
    displayBalanceRef.current = target;
    if (Math.abs(from - target) < 0.005) {
      setBalance(target);
      return;
    }
    const startedAt = performance.now();
    const duration = 650;
    setBalance(target);

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setBalance(from + (target - from) * eased);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  /**
   * Speak one line. Prefers the server mp3 (ElevenLabs) and falls back to the
   * browser. Resolves when the line finishes so segments stay in sync.
   */
  const speak = useCallback(
    async (line: CommentaryLine): Promise<void> => {
      setActiveSpeaker(line.speaker);
      setCaption(line.text);
      if (line.intensity >= 4) triggerEffects(line.intensity);

      const blob = await fetchSpeech(line.speaker, line.text);

      // --- ElevenLabs path ---
      if (blob) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = muted ? 0 : 1;
        try {
          await new Promise<void>((resolve) => {
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
            void audio.play().catch(() => resolve());
          });
        } finally {
          URL.revokeObjectURL(url);
        }
        return;
      }

      // --- browser fallback path ---
      setBrowserVoice(true);
      const fallbackMs = estimateDuration(line.text);

      if (muted || typeof window === "undefined" || !("speechSynthesis" in window)) {
        await new Promise((resolve) => setTimeout(resolve, fallbackMs));
        return;
      }

      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(line.text);
        utterance.voice = pickBrowserVoice(line.speaker);
        utterance.rate = line.speaker === "PBP" ? 1.15 : 0.95;
        utterance.pitch = line.speaker === "PBP" ? 1.15 : 0.9;
        utterance.volume = muted ? 0 : 1;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.speak(utterance);
        // Safety net: some engines never fire onend.
        setTimeout(finish, fallbackMs + 2500);
      });
    },
    [muted, estimateDuration, pickBrowserVoice, triggerEffects],
  );

/**
   * Play one segment: mark the plays live, move the scoreboard, ask Gemini for
   * the script, then read the lines in order.
   */
  const runSegment = useCallback(
    async (segment: Segment) => {
      const { plays, mode, isImpulse } = segment;

      if (mode === "halftime") setPhase("halftime");
      if (mode === "postgame") setPhase("postgame");

      if (plays.length > 0 && mode === "play") {
        setFeed((current) =>
          current.map((entry) =>
            plays.some((p) => p.id === entry.transaction.id)
              ? { ...entry, status: "live" as const }
              : entry,
          ),
        );
        // How many plays have been called by the end of this segment.
        const doneBefore = feed.filter((p) => p.status === "done").length;
        tickBalanceTo(
          balanceAfter(
            [...baseTransactionsRef.current, ...impulseRef.current],
            startBalance,
            doneBefore + plays.length,
          ),
        );
      }

      // The booth quotes the balance that is actually on screen.
      const segmentStats: Stats = {
        ...liveStats,
        currentBalance: displayBalanceRef.current,
        totalSpent: Math.round((startBalance - displayBalanceRef.current) * 100) / 100,
      };

      let lines: CommentaryLine[] = [];
      let graphic: string | null = null;
      try {
        const { commentary } = await fetchCommentary({
          plays: plays.slice(0, 3),
          stats: segmentStats,
          mode,
        });
        lines = commentary.lines;
        graphic = commentary.chyron;
      } catch {
        // Server is down: hold a beat and move on rather than freezing.
        setCaption("...we seem to have lost the feed...");
        await new Promise((r) => setTimeout(r, 1500));
      }

      if (stoppedRef.current) return;
      if (graphic) setChyron(graphic);
      if (isImpulse) triggerEffects(5);

      // Kick off every TTS request now, then play them in order. Line 1 begins
      // the instant it lands while the rest are still downloading.
      for (const line of lines) void fetchSpeech(line.speaker, line.text);
      for (const line of lines) {
        if (stoppedRef.current) return;
        await speak(line);
      }

      if (plays.length > 0 && mode === "play") {
        setFeed((current) =>
          current.map((entry) =>
            plays.some((p) => p.id === entry.transaction.id)
              ? { ...entry, status: "done" as const }
              : entry,
          ),
        );
      }
      setSegmentsPlayed((n) => n + 1);
    },
    [
      balanceAfter,
      feed,
      liveStats,
      speak,
      startBalance,
      tickBalanceTo,
      triggerEffects,
    ],
  );

  /** Drain the segment queue one at a time. Never runs two at once. */
  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    try {
      while (queueRef.current.length > 0 && !stoppedRef.current) {
        const next = queueRef.current.shift();
        if (next) await runSegment(next);
      }
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, [runSegment]);

// --- public controls --------------------------------------------------------

  /**
   * START BROADCAST. This click is also the user gesture that unlocks audio,
   * which is how we avoid browser autoplay blocking.
   */
  const startBroadcast = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setHasStarted(true);
    stoppedRef.current = false;
    setPhase("q1");

    if (baseTransactionsRef.current.length === 0) await load();

    // Replay history oldest-first, a couple of plays per segment.
    const history = [...baseTransactionsRef.current];
    const segments: Segment[] = [];
    for (let i = 0; i < history.length; i += PLAYS_PER_SEGMENT) {
      segments.push({
        plays: history.slice(i, i + PLAYS_PER_SEGMENT),
        mode: "play",
      });
    }
    const capped = segments.slice(0, MAX_SEGMENTS);

    // Sprinkle a halftime report in the middle for broadcast texture.
    capped.splice(Math.ceil(capped.length / 2), 0, { plays: [], mode: "halftime" });
    queueRef.current.push(...capped);

    await pump();
    if (!stoppedRef.current) setPhase("halftime");
  }, [load, pump]);

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

  /** Emergency brake for a demo gone sideways. */
  const stopBroadcast = useCallback(() => {
    stoppedRef.current = true;
    queueRef.current = [];
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setBusy(false);
  }, []);

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
    stopBroadcast,
    toggleMute,
    reload: load,
    newestFirst: sortNewestFirst,
  };
}

