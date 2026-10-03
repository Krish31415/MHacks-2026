import type { Category } from "../../shared/types";
import type { FeedPlay } from "../hooks/useBroadcast";

/**
 * The scrolling play feed, newest at the top: "PLAY #7: Chipotle -$14.85".
 * The play currently being called is highlighted.
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
    <section className="flex min-h-0 flex-col rounded-lg border-2 border-white/10 bg-panel/50">
      <h2 className="broadcast border-b-2 border-white/10 px-3 py-1.5 text-sm text-gold">
        Play Feed
      </h2>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-sm">
        {ordered.length === 0 && (
          <li className="px-2 py-6 text-center text-white/40">No plays loaded.</li>
        )}
        {ordered.map((entry) => {
          const live = entry.status === "live";
          return (
            <li
              key={entry.transaction.id}
              className={`mb-1 flex items-baseline gap-2 rounded px-2 py-1.5 transition-colors ${
                live
                  ? "bg-gold/20 ring-1 ring-gold/60"
                  : entry.status === "done"
                    ? "text-white/55"
                    : "text-white/35"
              }`}
            >
              <span className="broadcast w-8 shrink-0 text-right text-xs text-white/40">
                #{entry.number}
              </span>
              <span aria-hidden className="shrink-0">
                {CATEGORY_ICON[entry.transaction.category]}
              </span>
              <span className="broadcast min-w-0 flex-1 truncate">
                {entry.transaction.merchant}
                {entry.impulse && <span className="ml-1 text-[10px] text-red">IMPULSE</span>}
              </span>
              {entry.verdict && (
                <span
                  className="broadcast shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[9px] tabular-nums text-white/80 sm:text-[10px]"
                  title="Mike's score / Linda's score"
                >
                  M {entry.verdict.scores.PBP} / L {entry.verdict.scores.COLOR}
                </span>
              )}
              <span className="broadcast shrink-0 tabular-nums text-red">
                -${entry.transaction.amount.toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
