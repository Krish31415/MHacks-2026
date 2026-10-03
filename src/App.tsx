import { useMemo } from "react";

import { Booth } from "./components/Booth";
import { Chyron } from "./components/Chyron";
import { Controls } from "./components/Controls";
import { PlayFeed } from "./components/PlayFeed";
import { Scoreboard } from "./components/Scoreboard";
import { Ticker } from "./components/Ticker";
import { useBroadcast } from "./hooks/useBroadcast";

/**
 * Checkout Critics - Wallet Sports Desk.
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
    phase,
    balance,
    activeSpeaker,
    caption,
    chyron,
    muted,
    busy,
    browserVoice,
    shakeKey,
    crowd,
    startBroadcast,
    impulseBuy,
    callHalftime,
    callPostgame,
    toggleMute,
    reload,
    hasStarted,
  } = broadcast;

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
    <div
      key={shakeKey}
      className={shakeKey > 0 ? "animate-shake" : ""}
    >
      <div className="flex min-h-screen flex-col bg-studio">
        <Scoreboard phase={phase} balance={balance} stats={stats} dayCount={dayCount} />

        <Ticker stats={stats} />

        <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-6">
          {/* Data source badge */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span
              className={`broadcast rounded px-2 py-1 text-[10px] ring-1 sm:text-xs ${
                source === "nessie"
                  ? "bg-green-500/15 text-green-300 ring-green-400/40"
                  : "bg-amber-500/15 text-amber-300 ring-amber-400/40"
              }`}
            >
              {source === "nessie" ? "LIVE: Nessie" : "OFFLINE: demo data"}
            </span>
            <span className="broadcast text-[10px] text-white/40 sm:text-xs">
              {data?.accountLabel ?? "loading..."} • checkout critics
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
              />
              <Controls
                onStart={startBroadcast}
                onImpulseBuy={impulseBuy}
                onHalftime={callHalftime}
                onPostgame={callPostgame}
                onToggleMute={toggleMute}
                muted={muted}
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

          <footer className="mt-6 text-center text-[10px] text-white/25">
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
      </div>
    </div>
  );
}
