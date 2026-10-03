import type { BroadcastPhase, Stats } from "../../shared/types";

/**
 * The top scoreboard: YOU vs THE BANK, with a fake game clock and a
 * quarter indicator. The balance ticks down as plays land.
 */

const PHASE_LABEL: Record<BroadcastPhase, string> = {
  pregame: "PREGAME",
  q1: "Q1",
  q2: "Q2",
  halftime: "HALFTIME",
  postgame: "FINAL",
};

export function Scoreboard({
  phase,
  balance,
  stats,
  dayCount,
}: {
  phase: BroadcastPhase;
  balance: number;
  stats: Stats;
  /** Days spanned by the transaction history, for the fake game clock. */
  dayCount: number;
}) {
  return (
    <header className="border-b-4 border-gold/70 bg-gradient-to-b from-studio-2 to-studio">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6">
        {/* YOU */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <div className="shrink-0 rounded bg-cyan/15 px-2 py-1 text-cyan ring-1 ring-cyan/40">
            <div className="broadcast text-[10px] leading-none tracking-widest sm:text-xs">
              YOU
            </div>
          </div>
          <div className="broadcast text-3xl leading-none text-cyan tabular-nums sm:text-5xl">
            ${balance.toFixed(2)}
          </div>
        </div>

        {/* Game clock + period */}
        <div className="flex shrink-0 flex-col items-center">
          <div className="broadcast rounded bg-gold px-3 py-0.5 text-sm text-studio sm:text-xl">
            {PHASE_LABEL[phase]}
          </div>
          <div className="broadcast mt-0.5 text-[9px] text-white/50 sm:text-[11px]">
            DAY {dayCount} • {stats.playsCount} PLAYS
          </div>
        </div>

        {/* THE BANK */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-4">
          <div className="broadcast text-3xl leading-none text-red tabular-nums sm:text-5xl">
            ${stats.totalSpent.toFixed(2)}
          </div>
          <div className="shrink-0 rounded bg-red/15 px-2 py-1 text-red ring-1 ring-red/40">
            <div className="broadcast text-[10px] leading-none tracking-widest sm:text-xs">
              THE BANK
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
