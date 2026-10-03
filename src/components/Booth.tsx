import type { Speaker } from "../../shared/types";

/**
 * The broadcast booth: two commentator cards. The active speaker's card glows
 * and bounces, and the live caption strip sits underneath like subtitles.
 */

const COMMENTATORS: Array<{
  speaker: Speaker;
  name: string;
  role: string;
  avatar: string;
  accent: string;
}> = [
  {
    speaker: "PBP",
    name: "BIG MIKE DONOVAN",
    role: "PLAY-BY-PLAY",
    avatar: "\u{1F3A3}",
    accent: "text-gold ring-gold/50",
  },
  {
    speaker: "COLOR",
    name: "LINDA PARK",
    role: "COLOR",
    avatar: "\u{1F4CA}",
    accent: "text-cyan ring-cyan/50",
  },
];

export function Booth({
  activeSpeaker,
  caption,
  browserVoice,
}: {
  activeSpeaker: Speaker | null;
  caption: string;
  browserVoice: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        {COMMENTATORS.map((c) => {
          const isActive = activeSpeaker === c.speaker;
          return (
            <div
              key={c.speaker}
              className={`broadcast relative rounded-lg border-2 bg-panel/80 px-3 py-4 text-center transition-all duration-200 sm:px-6 sm:py-6 ${
                isActive
                  ? `animate-glow animate-booth border-transparent ring-2 ${c.accent}`
                  : "border-white/10 opacity-60"
              }`}
            >
              <div className="text-3xl sm:text-5xl">{c.avatar}</div>
              <div
                className={`mt-1 text-lg leading-tight sm:text-3xl ${isActive ? c.accent.split(" ")[0] : "text-white/70"}`}
              >
                {c.name}
              </div>
              <div className="text-[9px] tracking-[0.25em] text-white/40 sm:text-[11px]">
                {c.role}
              </div>
              {/* On-air lamp */}
              <div
                className={`absolute right-2 top-2 h-2.5 w-2.5 rounded-full sm:right-3 sm:top-3 ${
                  isActive ? "animate-blink bg-red" : "bg-white/15"
                }`}
              />
            </div>
          );
        })}
      </div>

      {/* Caption strip */}
      <div className="min-h-[76px] rounded-lg border-2 border-white/10 bg-black/60 px-4 py-3 text-center sm:min-h-[92px] sm:px-8 sm:py-5">
        <p className="broadcast text-lg leading-snug text-white/95 sm:text-3xl">
          {caption || "..."}
        </p>
      </div>

      {browserVoice && (
        <p className="text-center text-[10px] text-white/35">
          using browser voices (elevenlabs unavailable)
        </p>
      )}
    </section>
  );
}
