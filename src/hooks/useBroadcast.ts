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

  // --- transport: pause + interrupt -----------------------------------------
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  /** Callbacks parked by waitIfPaused(), flushed on resume. */
  const pauseWaitersRef = useRef<Array<() => void>>([]);
  /** The <audio> element currently on air, so pause/resume can reach it. */
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  /** Resolves the in-flight line early when the user interrupts. */
  const cancelLineRef = useRef<(() => void) | null>(null);
  /** Bumped to abandon the segment that is currently on air. */
  const abortRef = useRef(0);
  /** True once a halftime report has aired, so later plays read as Q2. */
  const halftimeSeenRef = useRef(false);
  /** Mirror of `muted` so the audio layer can read it without waiting a render. */
  const mutedRef = useRef(false);

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

  /** Blocks while the show is paused; resolves the moment it resumes. */
  const waitIfPaused = useCallback(async () => {
    while (pausedRef.current) {
      await new Promise<void>((resolve) => pauseWaitersRef.current.push(resolve));
    }
  }, []);

  /** A sleep that still respects pause, used for muted "playback". */
  const sleep = useCallback(
    async (ms: number) => {
      let remaining = ms;
      while (remaining > 0) {
        await waitIfPaused();
        const slice = Math.min(remaining, 100);
        await new Promise((resolve) => globalThis.setTimeout(resolve, slice));
        remaining -= slice;
      }
    },
    [waitIfPaused],
  );

  /** Turn a line into a plausible spoken duration, for muted playback. */
  const spokenMs = (text: string) => {
    const words = text.split(/\s+/).length;
    return Math.min(6, Math.max(1.2, (words / 150) * 60)) * 1000;
  };

  /**
   * In-flight ramp, if any. speechSynthesis.volume is GLOBAL and persists
   * between calls, so two overlapping stops used to corrupt each other: the
   * second would read the already-lowered value and restore *that*, ratcheting
   * the master volume down a little further on every interrupt until the show
   * went permanently silent. All stops are serialised through here so the
   * volume can only ever be restored to what we ourselves lowered it from.
   */
  const synthRampRef = useRef<Promise<void> | null>(null);

  /**
   * Stop the browser voice without slamming the gate shut.
   *
   * speechSynthesis has no graceful stop: cancel() cuts the output stream dead,
   * which is an audible click at full volume. Ride the global volume down over
   * ~70ms first, THEN cancel. Quieter, and it also clears the long-standing
   * Chrome bug where cancelling while paused wedges the engine permanently --
   * every utterance after that is silently dropped for the rest of the page's
   * life, which is what made Restart appear to kill audio for good.
   */
  const softStopSynth = useCallback((then: () => void) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      then();
      return;
    }

    const run = (): Promise<void> => {
      const synth = window.speechSynthesis as SpeechSynthesis & { volume: number };
      const original = synth.volume;
      if (!synth.speaking || original <= 0) {
        synth.cancel();
        synth.resume();
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const STEPS = 4;
        let step = 0;
        const timer = globalThis.setInterval(() => {
          step += 1;
          synth.volume = original * (1 - step / STEPS);
          if (step < STEPS) return;
          globalThis.clearInterval(timer);
          synth.cancel();
          synth.resume();
          synth.volume = original;
          resolve();
        }, 18);
      });
    };

    const prev = synthRampRef.current ?? Promise.resolve();
    const next = prev.then(run, run).finally(() => {
      if (synthRampRef.current === next) synthRampRef.current = null;
    });
    synthRampRef.current = next;
    next.then(then, then);
  }, []);

  /**
   * Kick the Chrome speech engine back to life.
   *
   * It can die outright -- cancel()-while-paused is the reliable way, but it
   * also just fails sometimes -- and once dead every later speak() is dropped
   * silently for the rest of the page's life. There is no "restart engine"
   * API, so the fix is to speak a zero-volume character, which forces it to
   * re-initialise. Cheap enough to call every time a show starts.
   */
  const resurrectSynth = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    synth.resume();
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    synth.speak(warm);
  }, []);

  /** Silence between lines, so the audio output buffer can drain (see playLine). */
  const INTERLINE_GAP_MS = 180;

  /**
   * Audio debug switches, so the pop can be A/B'd straight from the URL bar
   * instead of by editing code and reloading. Append to the app URL:
   *
   *   ?nogap=1      drop the inter-line silence
   *   ?nopause=1    don't append the trailing " …"
   *   ?novoice=1    let the engine pick its own default voice
   *   ?voice=Alex   force one voice for both critics (partial name match)
   *   ?pbp=Alex&color=Samantha   force each critic separately
   *   ?gap=250      override the inter-line gap, in ms
   *
   * With no params it uses the tuned defaults below.
   */
  const tune = useMemo(() => {
    const fallback = {
      gap: INTERLINE_GAP_MS,
      noGap: false,
      pause: true,
      noVoice: false,
      voice: null as string | null,
      pbp: null as string | null,
      color: null as string | null,
    };
    if (typeof window === "undefined") return fallback;
    const q = new URLSearchParams(window.location.search);
    const gap = Number(q.get("gap"));
    return {
      gap: q.has("gap") && Number.isFinite(gap) ? gap : fallback.gap,
      noGap: q.has("nogap"),
      pause: !q.has("nopause"),
      noVoice: q.has("novoice"),
      voice: q.get("voice"),
      pbp: q.get("pbp"),
      color: q.get("color"),
    };
  }, []);

  /**
   * Play ONE line and resolve when it has actually finished.
   *  - `prefetched` is the mp3 the segment runner already requested, so we never
   *    hit /api/tts twice for the same line.
   *  - Resolves early when the user interrupts or hits pause -> stop.
   *  - Reads `muted` from a ref, not from props, so hitting MUTE mid-sentence
   *    takes effect on this line instead of the next one.
   */
  const playLine = useCallback(
    async (line: CommentaryLine, prefetched: Blob | null): Promise<void> => {
      if (mutedRef.current) {
        await sleep(spokenMs(line.text));
        return;
      }

      const blob = prefetched ?? (await fetchSpeech(line.speaker, line.text));

      if (blob) {
        const url = URL.createObjectURL(blob);
        try {
          await new Promise<void>((resolve) => {
            const audio = new Audio(url);
            audio.preload = "auto";
            let settled = false;
            let declick: ReturnType<typeof globalThis.setInterval> | undefined;
            let watchdog: ReturnType<typeof globalThis.setInterval> | undefined;

            const finish = () => {
              if (settled) return;
              settled = true;
              audio.onended = null;
              audio.onerror = null;
              if (declick !== undefined) globalThis.clearInterval(declick);
              if (watchdog !== undefined) globalThis.clearInterval(watchdog);
              audio.volume = 0;
              resolve();
            };

            // DECLICK. An mp3 ends on an arbitrary sample, so tearing the
            // decoder down at full volume puts an audible pop on the output.
            // Ride the gain down over the last few frames instead. Driven off
            // currentTime rather than a wall clock, so it freezes while paused.
            const FADE_S = 0.09;
            declick = globalThis.setInterval(() => {
              const d = audio.duration;
              if (!Number.isFinite(d) || d <= 0) return;
              const left = d - audio.currentTime;
              if (left <= FADE_S) audio.volume = Math.max(0, left / FADE_S);
            }, 24);

            audio.onended = finish;
            audio.onerror = finish;
            cancelLineRef.current = () => {
              audio.pause();
              finish();
            };
            activeAudioRef.current = audio;

            // Safety net: a bad file must never freeze the show. Counted in
            // UNPAUSED milliseconds, otherwise holding the show for 15s would
            // trip the watchdog and silently swallow the rest of the line.
            let waited = 0;
            watchdog = globalThis.setInterval(() => {
              if (pausedRef.current) return;
              waited += 250;
              if (waited >= 15000) finish();
            }, 250);

            if (!pausedRef.current) void audio.play().catch(finish);
          });
        } finally {
          URL.revokeObjectURL(url);
          activeAudioRef.current = null;
          cancelLineRef.current = null;
        }
        return;
      }

      // ElevenLabs unavailable: use the browser's built-in voices instead.
      setBrowserVoice(true);
      await new Promise<void>((resolve) => {
        if (!("speechSynthesis" in window)) {
          void sleep(1200).then(resolve);
          return;
        }
        const synth = window.speechSynthesis;

        // TRAILING PAUSE. The engine closes the output stream the instant the
        // last phoneme ends, so a line that stops mid-amplitude is cut with a
        // click. A trailing ellipsis makes it render trailing silence FIRST, so
        // the stream closes at zero instead. Applied to the SPOKEN text only --
        // the caption still shows the real line.
        const clean = line.text.replace(/\s+/g, " ").trim();
        const spoken = tune.pause
          ? `${clean.replace(/[.!?…,;:\s]+$/, "")} …`
          : clean;
        const utterance = new SpeechSynthesisUtterance(spoken);

        const voices = synth.getVoices();
        const forced = tune.voice ?? (line.speaker === "PBP" ? tune.pbp : tune.color);
        const byName = (needle: string) =>
          voices.find((v) => v.name.toLowerCase().includes(needle.toLowerCase()));
        // Default picks are the two macOS voices; both have been reported to
        // click on teardown. ?voice= lets you A/B without a rebuild.
        const pick = tune.noVoice
          ? undefined
          : forced
            ? byName(forced)
            : line.speaker === "PBP"
              ? byName("daniel") ??
                voices.find((v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("male")) ??
                voices.find((v) => v.lang.startsWith("en"))
              : byName("samantha") ??
                voices.find((v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("female")) ??
                voices.find((v) => v.lang.startsWith("en"));
        if (pick) utterance.voice = pick;
        utterance.rate = line.speaker === "PBP" ? 1.08 : 0.96;
        utterance.pitch = line.speaker === "PBP" ? 1.1 : 0.9;

        // Logged per line so the voice in use is never a guess, and so you can
        // see the click correlates (or doesn't) with a particular engine.
        console.debug(
          `[audio] ${line.speaker} -> ${pick?.name ?? "(engine default)"} | "${spoken.slice(-28)}"`,
        );

        let settled = false;
        let watchdog: ReturnType<typeof globalThis.setInterval> | undefined;
        let health: ReturnType<typeof globalThis.setInterval> | undefined;
        const finish = () => {
          if (settled) return;
          settled = true;
          utterance.onend = null;
          utterance.onerror = null;
          if (watchdog !== undefined) globalThis.clearInterval(watchdog);
          if (health !== undefined) globalThis.clearInterval(health);
          resolve();
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        cancelLineRef.current = () => {
          softStopSynth(finish);
        };
        // NOTE: deliberately NO synth.cancel() before speak(). Cancelling right
        // at a clip boundary truncates the tail of the outgoing utterance, and
        // macOS turns that into a loud POP at the end of every line. Lines are
        // serialized here, so there is never a backlog that needs clearing --
        // we only cancel when the user actually interrupts.
        synth.speak(utterance);

        // SELF-HEAL. A dead engine swallows speak() with no error and no
        // `onend`: the line simply never plays, and since the watchdog is
        // 12s the show limps along silently instead of telling us. If nothing
        // is speaking or pending after ~600ms, wake the engine and re-speak
        // exactly once.
        let dead = 0;
        health = globalThis.setInterval(() => {
          if (settled) return;
          // While paused the engine is legitimately not speaking, and reviving
          // it here would talk over a show that is deliberately being held.
          if (pausedRef.current) {
            dead = 0;
            return;
          }
          if (synth.speaking || synth.pending) {
            dead = 0;
            return;
          }
          dead += 150;
          if (dead < 600) return;
          globalThis.clearInterval(health);
          health = undefined;
          console.warn("[audio] engine dropped the utterance -- reviving, retrying once");
          resurrectSynth();
          synth.speak(utterance);
        }, 150);

        // Same pause-aware watchdog as the mp3 path above.
        let waited = 0;
        watchdog = globalThis.setInterval(() => {
          if (pausedRef.current) return;
          waited += 250;
          if (waited >= 12000) finish();
        }, 250);
      });

      // LEAVE A BEAT BEFORE THE NEXT LINE. `onend` fires when synthesis
      // finishes, NOT when the audio device has finished draining the buffer.
      // Speaking again inside that window makes the engine truncate the tail,
      // and macOS renders that truncation as a loud click at the end of every
      // single line. A short gap lets the buffer drain clean instead.
      // (synth.cancel() here would "fix" it by blunt force, but blunt force IS
      // the truncation we are trying to avoid.) Pause-aware, so holding the
      // show mid-gap behaves like holding it mid-line.
      if (!tune.noGap) await sleep(tune.gap);
    },
    [sleep, softStopSynth, tune, resurrectSynth],
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

      // Token identifying this run: an interrupt bumps abortRef, which turns
      // every await below into a no-op so a new segment can take the air
      // instantly instead of waiting for this one's audio to drain.
      const gen = abortRef.current;

      try {
        const { commentary } = await fetchCommentary({
          plays: plays.slice(0, 3),
          stats: segmentStats,
          mode,
          verdicts: verdictsRef.current,
        });
        if (gen !== abortRef.current) return false;

        // Verdicts reveal AFTER the last line finishes (see playLine below).
        if (commentary.verdicts && commentary.verdicts.length > 0) {
          verdictQueueRef.current.push(...commentary.verdicts);
        }
        if (mode === "postgame" && commentary.finalReview) {
          setFinalReview(commentary.finalReview);
        }

        setChyron(commentary.chyron);
        setBusy(true);

        // Phase follows the segment, so the scoreboard can never get stuck on
        // HALFTIME while plays keep running (it used to, permanently).
        if (mode === "halftime") {
          halftimeSeenRef.current = true;
          setPhase("halftime");
        } else if (mode === "postgame") {
          setPhase("postgame");
        } else {
          setPhase(halftimeSeenRef.current ? "q2" : "q1");
        }

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
          if (gen !== abortRef.current) break;
          await waitIfPaused();
          if (gen !== abortRef.current) break;
          setActiveSpeaker(line.speaker);
          setCaption(`${line.speaker === "PBP" ? "MIKE" : "LINDA"}: ${line.text}`);
          triggerEffects(line.intensity);
          // playLine owns mute, pause, the mp3 declick, and the speechSynthesis
          // fallback, so the blob we prefetched above is handed straight over.
          await playLine(line, await audioPromises[index++]);
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
        // Postgame is the end of the broadcast: latch the queue shut.
        if (mode === "postgame") stoppedRef.current = true;
        return true;
      } catch (error) {
        console.warn("[broadcast] segment failed:", error);
        return false;
      } finally {
        // Only drop the ON AIR lamp if nothing else is already queued, so
        // cutting from one segment straight into the next doesn't flicker.
        if (queueRef.current.length === 0) setBusy(false);
      }
    },
    [
      allTransactions,
      balanceAfter,
      feed,
      liveStats,
      muted,
      playLine,
      startBalance,
      tickBalanceTo,
      triggerEffects,
      waitIfPaused,
    ],
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
    pausedRef.current = false;
    setPaused(false);
    halftimeSeenRef.current = false;
    setPhase("q1");
    // Wake the speech engine before the first line. Restart leaves it in an
    // unknown state, and a dead engine fails silently -- it just never speaks
    // again -- which is the single worst failure mode for a live demo.
    resurrectSynth();

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
  }, [data, pump, resurrectSynth]);

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

  /**
   * Cut the line that is on air and empty the queue. This is what makes
   * HALFTIME / POSTGAME behave like real broadcast buttons: they take the air
   * immediately instead of waiting for the current segment's audio to drain.
   * Returns the new abort token.
   */
  const interrupt = useCallback(() => {
    abortRef.current += 1;
    queueRef.current = [];
    const cancel = cancelLineRef.current;
    cancelLineRef.current = null;
    // Exactly one stop, and never a bare cancel() stacked on top of a tracked
    // line: that second call used to land a microtask later -- after finish()
    // had resolved and the runner had already begun the NEXT line -- chopping
    // it off mid-word.
    if (cancel) cancel();
    else softStopSynth(() => {});
    // Silence the mp3 path too. Nulling the handle without pausing leaves the
    // old clip running on top of whatever starts next, which reads as "restart
    // broke the audio" -- you get two shows at once.
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
    setActiveSpeaker(null);
    setPaused(false);
    pausedRef.current = false;
    pauseWaitersRef.current.splice(0).forEach((resolve) => resolve());
    return abortRef.current;
  }, [softStopSynth]);

  const callHalftime = useCallback(async () => {
    interrupt();
    setPhase("halftime");
    queueRef.current.push({ plays: [], mode: "halftime" });
    await pump();
  }, [interrupt, pump]);

  const callPostgame = useCallback(async () => {
    interrupt();
    setPhase("postgame");
    queueRef.current.push({ plays: [], mode: "postgame" });
    // runSegment latches stoppedRef shut once the postgame call wraps up.
    stoppedRef.current = false;
    await pump();
  }, [interrupt, pump]);

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
    pausedRef.current = false;
    setPaused(false);
    halftimeSeenRef.current = false;
    setBrowserVoice(false);
    setHasStarted(false);
    setPhase("pregame");
    setSegmentsPlayed(0);
    setChyron(null);
    setCaption("");
    setActiveSpeaker(null);
    // Hand the engine back in a known-good state rather than whatever the
    // interrupted show left behind.
    resurrectSynth();
    try {
      await resetSession();
    } catch {
      // Session reset is best-effort; the reload below restores the UI anyway.
    }
    await load();
  }, [load, resurrectSynth]);

  /** Emergency brake for a demo gone sideways. */
  const stopBroadcast = useCallback(() => {
    interrupt();
    stoppedRef.current = true;
    setBusy(false);
  }, [interrupt]);
  const stopBroadcastRef = useRef(stopBroadcast);
  stopBroadcastRef.current = stopBroadcast;

  /**
   * Pause / resume the whole show. Freezes the audio element or the browser
   * voice mid-word, and parks the segment runner until playback resumes.
   */
  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    const synth =
      typeof window !== "undefined" && "speechSynthesis" in window
        ? window.speechSynthesis
        : null;
    if (next) {
      activeAudioRef.current?.pause();
      // Only reach for synth.pause() if a voice is genuinely mid-sentence --
      // calling it on an idle engine leaves it in a wedged state that clicks
      // hard when the next line starts.
      if (synth?.speaking) synth.pause();
      return;
    }
    void activeAudioRef.current?.play().catch(() => {});
    // Mirror: only resume if we actually paused it, for the same reason.
    if (synth?.paused) synth.resume();
    pauseWaitersRef.current.splice(0).forEach((resolve) => resolve());
  }, []);

  /**
   * Mute cuts the line that is ALREADY on air. Toggling a flag and waiting for
   * the current line to finish is how the button ends up looking broken: you
   * press it, nothing happens for four seconds, and by then you've written the
   * button off.
   */
  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (!next) return;
    const cancel = cancelLineRef.current;
    cancelLineRef.current = null;
    cancel?.();
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
  }, []);

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
    paused,
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
    togglePause,
    toggleMute,
    reload: load,
    newestFirst: sortNewestFirst,
  };
}
