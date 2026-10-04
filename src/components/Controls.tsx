import { useState } from "react";

/**
 * Controls: the broadcast console. START, transport keys (pause/stop/restart),
 * the IMPULSE BUY panel, and HALFTIME/POSTGAME.
 *
 * Every key here does something immediately -- halftime and postgame cut the
 * line that is on air rather than waiting for the segment to finish. Presets
 * are deliberately ridiculous because that is the joke.
 */

const PRESETS = [
  { merchant: "DoorDash", amount: 28.0, label: "DoorDash $28" },
  { merchant: "Steam", amount: 49.99, label: "Steam Sale $49.99" },
  { merchant: "Insomnia Cookies", amount: 12.0, label: "3am Cookies $12" },
  { merchant: "Uber Black", amount: 64.0, label: "Uber Black $64" },
  { merchant: "Amazon", amount: 89.99, label: "Amazon $89.99" },
  { merchant: "Late Night Taco", amount: 7.75, label: "Tacos $7.75" },
];

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
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");

  const submitCustom = (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!merchant.trim() || !Number.isFinite(value) || value <= 0) return;
    onImpulseBuy(merchant, value);
    setMerchant("");
    setAmount("");
  };

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
            <span className="broadcast text-[10px] tracking-[0.3em] text-white/45">
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

      {/* Impulse buy */}
      <div>
        <h3 className="broadcast mb-2 flex items-baseline gap-2 text-sm text-red">
          <span className="text-red/50">//</span> Impulse Buy
          <span className="text-[10px] tracking-normal text-white/35">do not do this</span>
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() =>
                onImpulseBuy(preset.merchant, preset.amount, `impulse buy at ${preset.merchant}`)
              }
              className="broadcast border border-red/40 bg-red/10 px-2 py-2 text-xs leading-none tracking-wide text-red transition-all duration-100 hover:border-red hover:bg-red/20 active:translate-y-px sm:text-sm"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={submitCustom} className="mt-2 flex gap-2">
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="merchant"
            maxLength={40}
            className="min-w-0 flex-1 border-2 border-white/15 bg-black/50 px-2 py-1.5 text-sm text-white placeholder:text-white/25 focus:border-gold focus:outline-none"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="$0.00"
            inputMode="decimal"
            className="w-20 border-2 border-white/15 bg-black/50 px-2 py-1.5 text-sm text-white placeholder:text-white/25 focus:border-gold focus:outline-none"
          />
          <button
            type="submit"
            className="broadcast border border-gold bg-gold/90 px-3 py-1.5 text-xs leading-none tracking-wider text-studio transition hover:bg-gold active:translate-y-px"
          >
            Buy
          </button>
        </form>
      </div>

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
