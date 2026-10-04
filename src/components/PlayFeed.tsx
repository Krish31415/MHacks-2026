import type { Category } from "../../shared/types";
import type { FeedPlay } from "../hooks/useBroadcast";

/**
 * The play-by-play ledger: "03 · Chipotle · M 7 / L 4 · -$14.85", newest on top.
 *
 * Laid out like an official play log rather than a card list: flat rows, hairline
 * separators, zero-padded numbers in tabular figures, and a chevron marking the
 * play currently being called.
 */

const CATEGORY_ICON: Record<Category, string> = {
  food_delivery: "\u{1F35A}",
  restaurant: "\u{1F372}",
  coffee: "\u{2615}",
  shopping: "\u{1F6D2}",
  subscription: "\u{1F504}",
  transport: "\u{1F697}",
  gaming: "\u{1F3AE}",
  groceries: "\u{1F34E}",
  transfer: "\u{1F4B8}",
  other: "\u{1F4B3}",
};

export function PlayFeed({ feed }: { feed: FeedPlay[] }) {
  const ordered = [...feed].reverse();

  return (
    <section className="flex min-h-0 flex-col border border-white/10 bg-panel/40">
      <h2 className="broadcast flex items-baseline justify-between border-b border-gold/40 px-3 py-1.5 text-sm text-gold">
        <span className="flex items-center gap-2">
          <span className="chev" aria-hidden>
            ❯
          </span>
          Play Feed
        </span>
        <span className="num text-sm text-white/30">{ordered.length}</span>
      </h2>
      <ul className="min-h-0 flex-1 overflow-y-auto text-base">
        {ordered.length === 0 && (
          <li className="px-3 py-6 text-center text-white/40">No plays loaded.</li>
        )}
        {ordered.map((entry) => {
          const live = entry.status === "live";
          return (
            <li
              key={entry.transaction.id}
              className={`flex items-baseline gap-2 border-b border-white/5 px-3 py-1.5 transition-colors ${
                live ? "bg-gold/10" : ""
              } ${entry.status === "done" ? "" : "opacity-45"}`}
            >
              <span
                className={`num w-7 shrink-0 text-right text-sm ${
                  live ? "text-gold" : "text-white/35"
                }`}
              >
                {String(entry.number).padStart(2, "0")}
              </span>
              <span aria-hidden className="shrink-0 text-sm">
                {CATEGORY_ICON[entry.transaction.category]}
              </span>
              <span
                className={`broadcast min-w-0 flex-1 truncate ${
                  live ? "text-white" : "text-white/70"
                }`}
              >
                {entry.transaction.merchant}
                {entry.impulse && (
                  <span className="ml-1.5 text-sm tracking-[0.15em] text-red">
                    IMPULSE
                  </span>
                )}
              </span>
              {entry.verdict && (
                <span
                  className="num shrink-0 text-sm text-white/55"
                  title="Mike's score / Linda's score"
                >
                  <span className="text-white/35">M</span> {entry.verdict.scores.PBP}
                  <span className="text-white/35"> L</span> {entry.verdict.scores.COLOR}
                </span>
              )}
              <span
                className={`num shrink-0 ${
                  live ? "text-red" : "text-red/70"
                }`}
              >
                −{entry.transaction.amount.toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
