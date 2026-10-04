import { useEffect, useMemo, useRef } from "react";

import { Booth } from "./components/Booth";
import { Chyron } from "./components/Chyron";
import { Controls } from "./components/Controls";
import { FinalReviewCard } from "./components/FinalReviewCard";
import { PlayFeed } from "./components/PlayFeed";
import { Scoreboard } from "./components/Scoreboard";
import { Ticker } from "./components/Ticker";
import { VerdictCard } from "./components/VerdictCard";
import { useBroadcast } from "./hooks/useBroadcast";

/**
 * Screen shake, applied through the Web Animations API.
 *
 * This used to be `<div key={shakeKey}>`, which remounted the ENTIRE tree on
 * every intensity 4-5 line: it wiped whatever you were typing into the
 * impulse-buy inputs, restarted the ticker, and re-popped every verdict card.
 * Animating the node directly shakes the same pixels with no remount.
 */
const SHAKE_KEYFRAMES: Keyframe[] = [
  { transform: "translate(0, 0) rotate(0deg)" },
  { transform: "translate(-6px, 3px) rotate(-0.35deg)" },
  { transform: "translate(5px, -4px) rotate(0.35deg)" },
  { transform: "translate(-4px, -2px) rotate(-0.2deg)" },
  { transform: "translate(3px, 3px) rotate(0.15deg)" },
  { transform: "translate(0, 0) rotate(0deg)" },
];

/**
 * Checkout Critics.
 *
 * Layout is a real TV broadcast: scoreboard on top, booth in the middle, play
 * feed on the side, ticker along the bottom, controls underneath.
 */
export default function App() {
  const broadcast = useBroadcast();
  const {
    data,
    source,
    loading,
    loadError,
    stats,
    feed,
    latestVerdicts,
    finalReview,
    phase,
    balance,
    activeSpeaker,
    caption,
    chyron,
    muted,
    paused,
    busy,
    browserVoice,
    ttsReason,
    shakeKey,
    crowd,
    startBroadcast,
    impulseBuy,
    callHalftime,
    callPostgame,
    startOver,
    togglePause,
    toggleMute,
    reload,
    hasStarted,
  } = broadcast;

  const shellRef = useRef<HTMLDivElement>(null);

  // Screen shake for intensity 4-5, without remounting anything.
  useEffect(() => {
    if (!shakeKey) return;
    const shell = shellRef.current;
    if (!shell?.animate) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    shell.animate(SHAKE_KEYFRAMES, { duration: 460, easing: "ease-in-out" });
  }, [shakeKey]);

  // Days spanned by the history, for the fake game clock.
  const dayCount = useMemo(() => {
    if (data?.transactions.length) {
      const times = data.transactions.map((t) => new Date(t.date).getTime());
      const days = Math.round((Math.max(...times) - Math.min(...times)) / 864e5);
      return Math.max(1, days);
    }
    return 1;
  }, [data]);

  return (
    <div ref={shellRef} className="studio-texture">
      <div className="flex min-h-screen flex-col bg-studio">
        <Scoreboard phase={phase} balance={balance} stats={stats} dayCount={dayCount} />

        <Ticker stats={stats} />

        <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-6">
          {/* Data source badge */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span
              className={`broadcast px-2 py-1 text-sm ring-1 ring-inset sm:text-sm ${
                source === "nessie"
                  ? "bg-green-500/15 text-green-300 ring-green-400/40"
                  : "bg-amber-500/15 text-amber-300 ring-amber-400/40"
              }`}
            >
              {source === "nessie" ? "Live: Nessie" : "Offline: demo data"}
            </span>
            <span className="broadcast text-sm tracking-[0.2em] text-white/35 sm:text-sm">
              {data?.accountLabel ?? "loading\u2026"} &mdash; checkout critics
            </span>
          </div>

          {loadError && (
            <div className="mb-3 rounded border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
              Could not reach the server: {loadError}.{" "}
              <button type="button" onClick={reload} className="underline">
                Retry
              </button>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            {/* Booth column */}
            <div className="flex flex-col gap-3">
              <Chyron text={chyron} />
              <Booth
                activeSpeaker={activeSpeaker}
                caption={caption}
                browserVoice={browserVoice}
                ttsReason={ttsReason}
              />

              {/* Verdict cards reveal after each segment's audio finishes. */}
              {latestVerdicts.length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {latestVerdicts.map((verdict) => {
                    // Impulse buys swap their optimistic id for the server id
                    // after the fact, so match on either the id or the verdict
                    // object the hook stored on the feed entry.
                    const entry = feed.find(
                      (f) =>
                        f.transaction.id === verdict.playId || f.verdict === verdict,
                    );
                    return entry ? (
                      <VerdictCard
                        key={verdict.playId}
                        transaction={entry.transaction}
                        verdict={verdict}
                      />
                    ) : null;
                  })}
                </div>
              )}

              <Controls
                onStart={startBroadcast}
                onImpulseBuy={impulseBuy}
                onHalftime={callHalftime}
                onPostgame={callPostgame}
                onTogglePause={togglePause}
                onToggleMute={toggleMute}
                muted={muted}
                paused={paused}
                busy={busy}
                hasStarted={hasStarted}
              />
            </div>

            {/* Feed column */}
            <div className="max-h-[70vh]">
              <PlayFeed feed={feed} />
            </div>
          </div>

          {loading && (
            <p className="broadcast mt-6 text-center text-white/40">Warming up...</p>
          )}

          <footer className="mt-6 text-center text-sm text-white/25">
            Built for MHacks 2026 with Nessie, Gemini, and ElevenLabs. Your balance
            is the score and you are losing.
          </footer>
        </main>

        {/* Crowd emoji burst overlay */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
          {crowd.map((item) => (
            <span
              key={item.id}
              className="crowd-emoji absolute bottom-24 text-3xl"
              style={
                {
                  left: `${item.left}%`,
                  "--spin": item.spin,
                } as React.CSSProperties
              }
            >
              {item.emoji}
            </span>
          ))}
        </div>

        {/* TV network bug: the CHECKOUT CRITICS logo in the corner. */}
        <div className="pointer-events-none fixed bottom-3 right-3 z-40 select-none text-right">
          <div className="broadcast flag bg-gold px-5 py-1.5 text-sm leading-none text-studio sm:px-6 sm:text-base">
            Checkout Critics
          </div>
          <div className="broadcast mt-1 text-sm leading-none tracking-[0.3em] text-white/40 sm:text-base">
            checkout-critics.tech &bull; LIVE
          </div>
        </div>

        {/* Postgame poster: final review scores, pull quote, and Start over. */}
        {phase === "postgame" && finalReview && (
          <FinalReviewCard
            review={finalReview}
            stats={stats}
            onStartOver={startOver}
          />
        )}
      </div>
    </div>
  );
}
