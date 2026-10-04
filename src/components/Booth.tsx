import type { Speaker } from "../../shared/types";

/**
 * The broadcast booth: two commentator cards. The active speaker's card lights
 * up, a level meter runs under their name, and the live caption strip sits
 * underneath like subtitles.
 */

const COMMENTATORS: Array<{
  speaker: Speaker;
  name: string;
  role: string;
  avatar: string;
  text: string;
  frame: string;
}> = [
  {
    speaker: "PBP",
    name: "Big Mike Donovan",
    role: "Play-by-play",
    avatar: "\u{1F3A3}",
    text: "text-gold",
    frame: "bg-gold/10 ring-gold/40",
  },
  {
    speaker: "COLOR",
    name: "Linda Park",
    role: "Color",
    avatar: "\u{1F4CA}",
    text: "text-cyan",
    frame: "bg-cyan/10 ring-cyan/40",
  },
];

export function Booth({
  activeSpeaker,
  caption,
  browserVoice,
  ttsReason,
}: {
  activeSpeaker: Speaker | null;
  caption: string;
  browserVoice: boolean;
  /** Why the browser voices are in use — an exhausted quota and a bad voice id
   *  look identical otherwise, and need completely different fixes. */
  ttsReason?: string | null;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {COMMENTATORS.map((c) => {
          const isActive = activeSpeaker === c.speaker;
          return (
            <div
              key={c.speaker}
              className={`broadcast relative px-3 py-5 text-center ring-1 ring-inset transition-all duration-200 sm:px-6 sm:py-7 ${
                isActive
                  ? `animate-booth animate-glow ring-2 ${c.frame}`
                  : "bg-white/[0.04] ring-white/15"
              }`}
            >
              {/* On-air lamp */}
              <span
                aria-hidden
                className={`absolute right-2.5 top-2.5 h-3 w-3 sm:right-4 sm:top-4 ${
                  isActive ? "animate-blink bg-red" : "bg-white/25"
                }`}
              />

              <span className={`block text-4xl sm:text-6xl ${isActive ? "" : "opacity-70"}`}>
                {c.avatar}
              </span>
              <div
                className={`mt-2 text-2xl leading-tight sm:text-4xl ${
                  isActive ? c.text : "text-white/80"
                }`}
              >
                {c.name}
              </div>
              <div
                className={`mt-1.5 text-sm tracking-[0.25em] sm:text-base ${
                  isActive ? "text-white/60" : "text-white/45"
                }`}
              >
                {c.role}
              </div>

              {/* Level meter: only the speaker holding the mic. */}
              <div
                aria-hidden
                className={`mt-3 flex h-5 items-end justify-center gap-[4px] ${c.text}`}
              >
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={`w-1 bg-current ${isActive ? "eq-bar" : "h-1.5 opacity-30"}`}
                    style={isActive ? { animationDelay: `${i * 110}ms` } : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Caption strip. Big enough to read while the booth talks over each
          other, small enough that the booth and the feed keep the screen. */}
      <div className="min-h-[60px] border-l-4 border-gold bg-black/70 px-4 py-3 text-center sm:min-h-[76px] sm:px-8 sm:py-4">
        <p className="broadcast text-lg leading-snug text-white sm:text-2xl">
          {caption || "\u2026"}
        </p>
      </div>

      {browserVoice && (
        <div className="text-center">
          <p className="broadcast text-sm tracking-[0.2em] text-amber-300/90">
            browser voices &mdash; elevenlabs unavailable
          </p>
          {ttsReason && (
            <p className="mt-1 text-sm tracking-wide text-amber-200/60">{ttsReason}</p>
          )}
        </div>
      )}
    </section>
  );
}
