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
              className={`broadcast relative px-3 py-4 text-center ring-1 ring-inset transition-all duration-200 sm:px-6 sm:py-6 ${
                isActive
                  ? `animate-booth animate-glow ring-2 ${c.frame}`
                  : "bg-white/[0.02] ring-white/10 opacity-55"
              }`}
            >
              {/* On-air lamp */}
              <span
                aria-hidden
                className={`absolute right-2 top-2 h-2.5 w-2.5 sm:right-3 sm:top-3 ${
                  isActive ? "animate-blink bg-red" : "bg-white/15"
                }`}
              />

              <span className="text-3xl sm:text-5xl">{c.avatar}</span>
              <div
                className={`mt-1 text-lg leading-tight sm:text-3xl ${
                  isActive ? c.text : "text-white/70"
                }`}
              >
                {c.name}
              </div>
              <div className="text-[9px] tracking-[0.25em] text-white/40 sm:text-[11px]">
                {c.role}
              </div>

              {/* Level meter: only the speaker holding the mic. */}
              <div
                aria-hidden
                className={`mt-2 flex h-4 items-end justify-center gap-[3px] ${c.text}`}
              >
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={`w-[3px] bg-current ${isActive ? "eq-bar" : "h-1 opacity-20"}`}
                    style={isActive ? { animationDelay: `${i * 110}ms` } : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Caption strip: subtitles, not a card. */}
      <div className="min-h-[76px] border-l-4 border-gold bg-black/70 px-4 py-3 text-center sm:min-h-[92px] sm:px-8 sm:py-5">
        <p className="broadcast text-lg leading-snug text-white/95 sm:text-3xl">
          {caption || "\u2026"}
        </p>
      </div>

      {browserVoice && (
        <div className="text-center">
          <p className="broadcast text-[10px] tracking-[0.2em] text-amber-300/80">
            browser voices &mdash; elevenlabs unavailable
          </p>
          {ttsReason && (
            <p className="mt-0.5 text-[10px] tracking-wide text-amber-200/50">
              {ttsReason}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
