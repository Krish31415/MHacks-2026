/**
 * Lower-third chyron: the TV broadcast graphic that slides in from the left
 * for each segment. Re-mounts on change so the animation replays every time.
 */
export function Chyron({ text }: { text: string | null }) {
  if (!text) return <div className="h-9" aria-hidden />;

  return (
    <div className="flex h-9 items-center overflow-hidden" role="status">
      <div
        key={text}
        className="animate-chyron flex items-center gap-2 bg-gradient-to-r from-gold to-gold-dim px-4 py-1 shadow-lg"
      >
        <span className="broadcast text-xs text-studio/70">WSD</span>
        <span className="broadcast text-sm text-studio sm:text-lg">{text}</span>
      </div>
    </div>
  );
}
