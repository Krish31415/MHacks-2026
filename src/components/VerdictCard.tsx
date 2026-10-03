import type { Transaction, Verdict } from "../../shared/types";

/**
 * Verdict card: once a segment's audio lines finish, every judged play gets one
 * of these. It shows both critics' scores with a thumbs icon (>=5 is a thumb up)
 * and flags a SPLIT DECISION when they disagree by 4 or more. Animated like a TV
 * graphic: the card pops in, then each score/thumbs flips in.
 */

/** Score >= 5 is a thumbs up, below that is a thumbs down. */
export function verdictThumb(score: number): string {
  return score >= 5 ? "\u{1F44D}" : "\u{1F44E}";
}

export function VerdictCard({
  transaction,
  verdict,
}: {
  transaction: Transaction;
  /** The two critics' scores for this play. */
  verdict: Verdict;
}) {
  const { PBP, COLOR } = verdict.scores;
  const split = Math.abs(PBP - COLOR) >= 4;

  return (
    <div className="broadcast animate-verdict relative rounded-lg border-2 border-gold/60 bg-gradient-to-b from-panel to-studio px-3 py-2 text-center shadow-lg">
      {split && (
        <span className="animate-blink absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-red px-2 py-0.5 text-[9px] tracking-widest text-white">
          SPLIT DECISION
        </span>
      )}
      <div className="truncate text-[11px] text-white/60 sm:text-xs">
        {transaction.merchant} <span className="text-red">-${transaction.amount.toFixed(2)}</span>
      </div>
      <div className="mt-1 flex items-center justify-center gap-3 sm:gap-5">
        <CriticScore name="MIKE" score={PBP} tone="text-gold" delay="0ms" />
        <span className="text-white/15">|</span>
        <CriticScore name="LINDA" score={COLOR} tone="text-cyan" delay="260ms" />
      </div>
    </div>
  );
}

/** One critic's half of the card: thumbs icon + big score + name. */
function CriticScore({
  name,
  score,
  tone,
  delay,
}: {
  name: string;
  score: number;
  tone: string;
  delay: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="animate-flip text-xl sm:text-2xl" style={{ animationDelay: delay }}>
        {verdictThumb(score)}
      </span>
      <span className={`animate-verdict text-2xl leading-none tabular-nums sm:text-3xl ${tone}`} style={{ animationDelay: delay }}>
        {score}
      </span>
      <span className="text-[9px] tracking-widest text-white/40 sm:text-[10px]">{name}</span>
    </div>
  );
}
