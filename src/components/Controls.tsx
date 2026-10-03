import { useState } from "react";

/**
 * Controls: START BROADCAST, the IMPULSE BUY panel, halftime/postgame, and mute.
 * Presets are deliberately ridiculous because that is the joke.
 */

const PRESETS = [
  { merchant: "DoorDash", amount: 28.0, label: "DoorDash $28" },
  { merchant: "Steam", amount: 49.99, label: "Steam Sale $49.99" },
  { merchant: "Insomnia Cookies", amount: 12.0, label: "3am Cookies $12" },
  { merchant: "Uber Black", amount: 64.0, label: "Uber Black $64" },
  { merchant: "Amazon", amount: 89.99, label: "Amazon $89.99" },
  { merchant: "Late Night Taco", amount: 7.75, label: "Tacos $7.75" },
];

export function Controls({
  onStart,
  onImpulseBuy,
  onHalftime,
  onPostgame,
  onToggleMute,
  muted,
  busy,
  hasStarted,
}: {
  onStart: () => void;
  onImpulseBuy: (merchant: string, amount: number, description?: string) => void;
  onHalftime: () => void;
  onPostgame: () => void;
  onToggleMute: () => void;
  muted: boolean;
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
    <section className="flex flex-col gap-4 rounded-lg border-2 border-white/10 bg-panel/50 p-3 sm:p-4">
      {/* Start */}
      {!hasStarted && (
        <button
          type="button"
          onClick={onStart}
          className="broadcast w-full rounded-lg bg-gradient-to-b from-gold to-gold-dim px-4 py-4 text-2xl text-studio shadow-lg transition hover:brightness-110 active:scale-[0.99] sm:text-3xl"
        >
          Start Broadcast
        </button>
      )}

      {/* Impulse buy */}
      <div>
        <h3 className="broadcast mb-2 text-sm text-red">
          Impulse Buy <span className="text-white/40">(do not do this)</span>
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={busy && false}
              onClick={() =>
                onImpulseBuy(preset.merchant, preset.amount, `impulse buy at ${preset.merchant}`)
              }
              className="broadcast rounded border-2 border-red/40 bg-red/10 px-2 py-2 text-xs text-red transition hover:bg-red/25 active:scale-[0.97] sm:text-sm"
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
            className="min-w-0 flex-1 rounded border border-white/15 bg-black/50 px-2 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-gold focus:outline-none"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="$0.00"
            inputMode="decimal"
            className="w-20 rounded border border-white/15 bg-black/50 px-2 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-gold focus:outline-none"
          />
          <button
            type="submit"
            className="broadcast rounded bg-gold/90 px-3 py-1.5 text-xs text-studio transition hover:bg-gold"
          >
            Buy
          </button>
        </form>
      </div>

      {/* Show control */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onHalftime}
          className="broadcast flex-1 rounded border-2 border-cyan/40 bg-cyan/10 px-3 py-2 text-sm text-cyan transition hover:bg-cyan/25"
        >
          Halftime
        </button>
        <button
          type="button"
          onClick={onPostgame}
          className="broadcast flex-1 rounded border-2 border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold transition hover:bg-gold/25"
        >
          Postgame
        </button>
        <button
          type="button"
          onClick={onToggleMute}
          className={`broadcast rounded border-2 px-3 py-2 text-sm transition ${
            muted
              ? "border-white/40 bg-white/10 text-white/70"
              : "border-green-400/40 bg-green-500/10 text-green-300"
          }`}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      </div>
    </section>
  );
}
