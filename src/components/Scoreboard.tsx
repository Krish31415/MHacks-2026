import type { BroadcastPhase, Stats } from "../../shared/types";

/**
 * The top scoreboard: YOU vs THE BANK, with a fake game clock and a period
 * indicator. The balance ticks down as plays land.
 *
 * Built as a real score bug rather than a row of cards: two flat team cells
 * split by a slanted period block, hairline rules between them, and a thin stat
 * strip underneath. CBS rebuilt theirs bigger and more opaque in 2025 because
 * readable dense data beats decoration -- that is the brief here.
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
    <header className="border-b-2 border-gold/60 bg-studio-2/95">
      <div className="mx-auto max-w-6xl px-2 sm:px-4">
        {/* The bug proper: your balance, the period, what you've paid out. */}
        <div className="flex items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-2 border-r border-white/10 py-2 pr-2 sm:gap-3 sm:pr-3">
            <span className="broadcast shrink-0 text-[10px] leading-none tracking-[0.28em] text-cyan/70">
              You
            </span>
            <span className="num animate-tick truncate text-2xl leading-none text-cyan sm:text-5xl">
              ${balance.toFixed(2)}
            </span>
          </div>

          {/* The one angled element on screen: the period block. Solid gold so
              it reads instantly, the way a bug's period chip does. */}
          <div className="flag flex shrink-0 flex-col items-center justify-center bg-gold px-5 py-1.5 text-studio sm:px-7 sm:py-2">
            <span className="broadcast text-base leading-none tracking-[0.12em] sm:text-2xl">
              {PHASE_LABEL[phase]}
            </span>
            <span className="broadcast mt-0.5 text-[9px] leading-none tracking-[0.18em] opacity-70">
              {dayCount}d &middot; {stats.playsCount} pl
            </span>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 border-l border-white/10 py-2 pl-2 sm:gap-3 sm:pl-3">
            <span className="num animate-tick truncate text-2xl leading-none text-red sm:text-5xl">
              ${stats.totalSpent.toFixed(2)}
            </span>
            <span className="broadcast shrink-0 text-[10px] leading-none tracking-[0.28em] text-red/70">
              The Bank
            </span>
          </div>
        </div>

        {/* Sub-strip. Flat, hairline-ruled, chips only where a number needs a
            container -- never as decoration. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 py-1.5">
          <Stat label="Critics" value={stats.criticsAverage?.toFixed(1) ?? "\u2014"} suffix="/10" accent />
          <Stat label="Plays" value={String(stats.playsCount)} />
          <Stat label="Delivery streak" value={`\u00d7${stats.foodDeliveryStreak}`} />
          <Stat label="Subs" value={String(stats.subscriptionsCount)} />
          <span className="broadcast ml-auto hidden text-[9px] tracking-[0.2em] text-white/25 sm:block">
            Checkout Critics
          </span>
        </div>
      </div>
    </header>
  );
}

/** One label/value pair in the sub-strip. */
function Stat({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <span className="broadcast flex items-baseline gap-1.5 text-[10px] tracking-[0.16em] text-white/45">
      {label}
      <span className={`num text-sm leading-none ${accent ? "text-gold" : "text-white/85"}`}>
        {value}
      </span>
      {suffix ? <span className="text-[9px] text-white/30">{suffix}</span> : null}
    </span>
  );
}
