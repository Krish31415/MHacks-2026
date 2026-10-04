/**
 * Controls: the broadcast console.
 *
 * Two buttons were removed as redundant rather than as clutter:
 *   Restart -- reloading the page is a full reset, and it is a key you should
 *              never need to hunt for mid-demo.
 *   Stop    -- Pause already takes the air instantly, and Postgame is how you
 *              actually end a show. Stop was a third way to say the same thing.
 * Both are still implemented on the hook (startOver, stopBroadcast) if a future
 * version wants a keyboard shortcut or an undo.
 *
 * The remaining keys are SQUARE and sit in one row. They used to be full-width
 * buttons in a 3-up grid, which came out around 7:1 — a letterbox strip, not a
 * control. Four keys across a capped panel make each one genuinely square, which
 * is the shape a hand expects to hit under pressure.
 *
 * Everything here acts immediately: pause, halftime, postgame and impulse buy
 * all cut the line that is on air rather than waiting for the segment to end.
 */

const TONE = {
  gold: "border-gold/45 bg-gold/10 text-gold hover:border-gold hover:bg-gold/20",
  cyan: "border-cyan/45 bg-cyan/10 text-cyan hover:border-cyan hover:bg-cyan/20",
  red: "border-red/45 bg-red/10 text-red hover:border-red hover:bg-red/20",
  ghost: "border-white/25 bg-white/5 text-white/75 hover:border-white/60 hover:bg-white/15",
} as const;

type Tone = keyof typeof TONE;

/** One console key. Square targets, a hard press, no gradients. */
function Key({
  label,
  tone,
  onClick,
  /** Draws the key as engaged (used for pause / mute). */
  lit,
  className = "",
}: {
  label: string;
  tone: Tone;
  onClick: () => void;
  lit?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={lit}
      className={`broadcast flex items-center justify-center border px-3 py-4 text-lg leading-none tracking-wider transition-all duration-100 active:translate-y-px active:brightness-125 sm:text-xl ${TONE[tone]} ${
        lit ? "ring-2 ring-inset ring-white/25" : ""
      } ${className}`}
    >
      {label}
    </button>
  );
}

export function Controls({
  onStart,
  onImpulseBuy,
  onHalftime,
  onPostgame,
  onToggleMute,
  onTogglePause,
  muted,
  paused,
  busy,
  hasStarted,
}: {
  onStart: () => void;
  onImpulseBuy: (merchant: string, amount: number, description?: string) => void;
  onHalftime: () => void;
  onPostgame: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  muted: boolean;
  paused: boolean;
  busy: boolean;
  hasStarted: boolean;
}) {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 border border-white/10 bg-panel/40 p-3 sm:p-4">
      {!hasStarted ? (
        <button
          type="button"
          onClick={onStart}
          className="broadcast flag w-full bg-gold py-12 text-3xl leading-none tracking-widest text-studio transition hover:brightness-110 active:translate-y-px sm:text-5xl"
        >
          Start Broadcast
        </button>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 ${
                paused ? "bg-gold" : busy ? "animate-blink bg-red" : "bg-white/20"
              }`}
            />
            <span className="broadcast text-base tracking-[0.3em] text-white/60">
              {paused ? "HOLD" : busy ? "ON AIR" : "STANDBY"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Key
              label={paused ? "Resume" : "Pause"}
              tone={paused ? "gold" : "ghost"}
              lit={paused}
              className="aspect-square"
              onClick={onTogglePause}
            />
            <Key
              label={muted ? "Unmute" : "Mute"}
              tone="ghost"
              lit={muted}
              className="aspect-square"
              onClick={onToggleMute}
            />
            <Key label="Halftime" tone="cyan" className="aspect-square" onClick={onHalftime} />
            <Key label="Postgame" tone="gold" className="aspect-square" onClick={onPostgame} />
          </div>
        </>
      )}

      {/* The money shot. Cuts the air -- same path as Halftime and Postgame, and
          the reason it gets a full-width bar rather than a square key. */}
      <Key
        label="Impulse Buy — DoorDash $28"
        tone="red"
        className="aspect-[7/1] text-lg sm:text-xl"
        onClick={() =>
          onImpulseBuy("DoorDash", 28, "impulse buy at DoorDash, 2am, regrets already")
        }
      />
    </section>
  );
}
