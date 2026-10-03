import type { Stats } from "../../shared/types";

/**
 * Bottom ticker tape: a continuously scrolling marquee of real computed stats.
 * The content is rendered twice so the CSS loop is seamless.
 */

function buildTicker(stats: Stats): string[] {
  const items = [
    `FOOD DELIVERY STREAK: ${stats.foodDeliveryStreak}`,
    stats.biggestPlay
      ? `BIGGEST PLAY: ${stats.biggestPlay.merchant.toUpperCase()} $${stats.biggestPlay.amount.toFixed(2)}`
      : "BIGGEST PLAY: NONE YET",
    `SUBSCRIPTION TURNOVERS: ${stats.subscriptionsCount}`,
    `TOTAL SPENT: $${stats.totalSpent.toFixed(2)}`,
    `SCORE: $${stats.currentBalance.toFixed(2)}`,
    `PLAYS: ${stats.playsCount}`,
  ];

  if (stats.criticsAverage != null) {
    items.push(`CRITICS' AVERAGE: ${stats.criticsAverage.toFixed(1)}`);
  }

  for (const [category, bucket] of Object.entries(stats.byCategory)) {
    if (bucket.count === 0) continue;
    items.push(
      `${category.replace(/_/g, " ").toUpperCase()}: ${bucket.count} ($${bucket.total.toFixed(2)})`,
    );
  }

  return items;
}

export function Ticker({ stats }: { stats: Stats }) {
  const items = buildTicker(stats);

  return (
    <div className="overflow-hidden border-y-2 border-gold/50 bg-black/70 py-1.5">
      <div className="ticker-track animate-ticker">
        {/* Two identical runs make the -50% translation loop perfectly. */}
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0" aria-hidden={copy === 1}>
            {items.map((item, i) => (
              <span
                key={`${copy}-${i}`}
                className="broadcast whitespace-nowrap px-4 text-xs text-gold/90 sm:text-sm"
              >
                {item}
                <span className="pl-4 text-red">{"\u{25C8}"}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
