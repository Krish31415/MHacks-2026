/**
 * Lower-third chyron: the TV broadcast graphic that slides in from the left
 * for each segment. Re-mounts on change so the animation replays every time.
 *
 * The whole graphic is one slanted parallelogram, which is what a real lower
 * third actually is -- not a rectangle with a corner taken off it.
 */
export function Chyron({ text }: { text: string | null }) {
  if (!text) return <div className="h-10" aria-hidden />;

  return (
    <div className="flex h-10 items-stretch" role="status">
      <div
        key={text}
        className="animate-chyron flag flex items-stretch pr-4 sm:pr-6"
      >
        <span className="broadcast flex shrink-0 items-center bg-gold px-4 text-sm tracking-[0.3em] text-studio sm:px-5 sm:text-sm">
          CC
        </span>
        <span className="broadcast flex min-w-0 items-center truncate bg-black/85 pl-4 pr-3 text-sm text-white sm:pl-5 sm:text-lg">
          {text}
        </span>
      </div>
    </div>
  );
}
