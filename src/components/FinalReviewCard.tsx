import type { FinalReview, Stats } from "../../shared/types";
import { verdictThumb } from "./VerdictCard";

/**
 * Postgame poster card: the movie-review payoff. Journal-style "FINAL REVIEW"
 * with both critics' whole-run scores, a thumbs verdict, and the pullQuote in a
 * big quoted display font. Includes the Start Over button that resets the demo.
 */
export function FinalReviewCard({
  review,
  stats,
  onStartOver,
}: {
  review: FinalReview;
  stats: Stats;
  onStartOver: () => void;
}) {
  const { PBP, COLOR } = review.scores;

  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      <div className="animate-poster w-full max-w-xl border-4 border-gold bg-studio-2 p-5 text-center sm:p-8">
        <div className="broadcast text-[10px] tracking-[0.45em] text-gold/70 sm:text-xs">
          Checkout Critics
        </div>
        <h2 className="broadcast mt-1 text-4xl leading-none text-gold sm:text-6xl">
          Final Review
        </h2>
        <div className="hairline-x mx-auto mt-3 h-px w-2/3" aria-hidden />

        <div className="mt-5 flex items-end justify-center gap-8 sm:gap-14">
          <FinalScore name="MIKE" score={PBP} tone="text-gold" delay="0ms" />
          <FinalScore name="LINDA" score={COLOR} tone="text-cyan" delay="320ms" />
        </div>

        <blockquote className="mt-6 text-lg italic leading-snug text-white/90 sm:text-2xl">
          &ldquo;{review.pullQuote}&rdquo;
        </blockquote>

        <div className="broadcast mt-4 text-[10px] tracking-[0.15em] text-white/40 sm:text-xs">
          Final score ${stats.currentBalance.toFixed(2)} &bull; {stats.playsCount} plays reviewed
        </div>

        <button
          type="button"
          onClick={onStartOver}
          className="broadcast flag mt-6 w-full bg-gold py-3 text-xl leading-none tracking-widest text-studio transition hover:brightness-110 active:translate-y-px sm:text-2xl"
        >
          Start Over
        </button>
      </div>
    </div>
  );
}

/** One critic's poster score: big thumbs, big number, name plate. */
function FinalScore({
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
    <div className="flex flex-col items-center">
      <span className="animate-flip text-5xl sm:text-6xl" style={{ animationDelay: delay }}>
        {verdictThumb(score)}
      </span>
      <span className={`broadcast animate-verdict mt-1 text-5xl leading-none tabular-nums sm:text-7xl ${tone}`} style={{ animationDelay: delay }}>
        {score}
      </span>
      <span className="broadcast text-[10px] tracking-[0.3em] text-white/50">{name}</span>
    </div>
  );
}
