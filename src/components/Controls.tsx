/**
 * Controls: the broadcast console -- START, the transport keys
 * (pause/stop/restart), HALFTIME/POSTGAME, and MUTE.
 *
 * Every key here does something immediately: halftime and postgame cut the line
 * that is on air rather than waiting for the segment to finish.
 *
 * The impulse-buy panel used to live here (six presets, two inputs, a submit --
 * the biggest block of clutter on screen). It is hidden for now because a
 * purchase queues behind every play still ahead of it in the history, so it
 * could never actually fire inside a 90-second show. Its markup is recoverable
 * from git history before the "hide impulse buy" commit, and the `impulseBuy`
 * hook plus the POST /api/purchase write path are both still wired up.
 */

const TONE = {
  gold: "border-gold/45 bg-gold/10 text-gold hover:border-gold hover:bg-gold/20",
  cyan: "border-cyan/45 bg-cyan/10 text-cyan hover:border-cyan hover:bg-cyan/20",
  red: "border-red/45 bg-red/10 text-red hover:border-red hover:bg-red/20",
  ghost: "border-white/25 bg-white/5 text-white/75 hover:border-white/60 hover:bg-white/15",
} as const;

type Tone = keyof typeof TONE;

/** One console key. Hard edges, a hard press, no gradients. */
function Key({
  label,
  tone,
  onClick,
  lit,
  className = "",
}: {
  label: string;
  tone: Tone;
  onClick: () => void;
  /** Draws the key as engaged (used for pause / mute). */
  lit?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={lit}
      className={`broadcast border px-3 py-2 text-sm leading-none tracking-wider transition-all duration-100 active:translate-y-px active:brightness-125 ${TONE[tone]} ${
        lit ? "ring-2 ring-inset ring-white/25" : ""
      } ${className}`}
    >
      {label}
    </button>
  );
}

export function Controls({
  onStart,
  onRestart,
  onImpulseBuy,
  onHalftime,
  onPostgame,
  onToggleMute,
  onTogglePause,
  onStop,
  muted,
  paused,
  busy,
  hasStarted,
}: {
  onStart: () => void;
  onRestart: () => void;
  onImpulseBuy: (merchant: string, amount: number, description?: string) => void;
  onHalftime: () => void;
  onPostgame: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onStop: () => void;
  muted: boolean;
  paused: boolean;
  busy: boolean;
  hasStarted: boolean;
}) {
  return (
    <section className="flex flex-col gap-4 border border-white/10 bg-panel/40 p-3 sm:p-4">
      {/* Start, then the transport strip once the show is rolling. */}
      {!hasStarted ? (
        <button
          type="button"
          onClick={onStart}
          className="broadcast flag w-full bg-gold py-4 text-2xl leading-none tracking-widest text-studio transition hover:brightness-110 active:translate-y-px sm:text-3xl"
        >
          Start Broadcast
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 ${
                paused ? "bg-gold" : busy ? "animate-blink bg-red" : "bg-white/20"
              }`}
            />
            <span className="broadcast text-[12px] tracking-[0.3em] text-white/45">
              {paused ? "HOLD" : busy ? "ON AIR" : "STANDBY"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Key
              label={paused ? "Resume" : "Pause"}
              tone={paused ? "gold" : "ghost"}
              lit={paused}
              onClick={onTogglePause}
            />
            <Key label="Stop" tone="ghost" onClick={onStop} />
            <Key label="Restart" tone="ghost" onClick={onRestart} />
          </div>
        </div>
      )}

      {/* IMPULSE BUY IS HIDDEN, NOT DELETED.
          It was 6 preset buttons, 2 inputs and a submit -- the single biggest
          block of clutter on a console that already carries six keys.

          It is back as ONE key rather than six presets, because it now preempts:
          the booth cuts off mid-sentence and reacts to this purchase
          immediately, then resumes the backlog. That is the moment the whole app
          exists for, so it gets the widest key on the console and nothing else.

          Custom purchases (merchant + amount) were dropped to keep the console
          readable; impulseBuy(merchant, amount, description) takes any of them. */}

      {/* The money shot. Cuts the air -- same path as Halftime and Postgame. */}
      <Key
        label="Impulse Buy — DoorDash $28"
        tone="red"
        className="w-full py-3 text-base"
        onClick={() =>
          onImpulseBuy("DoorDash", 28, "impulse buy at DoorDash, 2am, regrets already")
        }
      />

      {/* Broadcast keys. Both of these cut the air immediately. */}
      <div className="grid grid-cols-3 gap-2">
        <Key label="Halftime" tone="cyan" onClick={onHalftime} />
        <Key label="Postgame" tone="gold" onClick={onPostgame} />
        <Key
          label={muted ? "Unmute" : "Mute"}
          tone="ghost"
          lit={muted}
          onClick={onToggleMute}
        />
      </div>
    </section>
  );
}
