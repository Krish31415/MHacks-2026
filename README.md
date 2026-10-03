# Checkout Critics — Wallet Sports Desk

Two AI sports commentators call your bank account like a championship game.
**Your balance is the score and you are losing.**

Built for **MHacks 2026**. Sponsor integrations:
- **Capital One Nessie** (FinTech track) — real customer → account → purchases data
- **Google Gemini** — writes the two-person commentary script
- **ElevenLabs** — real AI voices for both commentators (browser-voice fallback included)

## How it works

```
Nessie purchases ──▶ Express API ──▶ stats engine (pure TS, unit-tested)
                                         │ numbers are computed here, never by the LLM
                                         ▼
                              Gemini writes 2–4 line script (JSON mode)
                                         │
                              ┌──────────┴──────────┐
                              ▼                     ▼
                      ElevenLabs TTS (mp3)   browser speechSynthesis fallback
                              │                     │
                              └──────────┬──────────┘
                                         ▼
                        React broadcast: scoreboard, booth, chyron,
                        play feed, ticker tape, impulse-buy panel
```

**Anti-hallucination rule:** every dollar figure the booth says is computed by
`shared/stats.ts`. Gemini only gets the numbers and writes jokes around them.

## Quickstart

```bash
npm install
cp .env.example .env   # then fill in keys (see below)
npm run dev            # server :8787 + client :5173
```

Open http://localhost:5173 → **START BROADCAST**.

| Command | What it does |
|---|---|
| `npm run dev` | server + client with hot reload |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | stats engine unit tests (5 tests) |
| `npm run build` | typecheck + production Vite build → `dist/` |
| `npm start` | serve `dist/` + API from one Node process |

## API keys (all optional — every service degrades gracefully)

| Key | Where | Without it |
|---|---|---|
| `NESSIE_API_KEY` | http://api.nessieisreal.com | in-memory demo data, `OFFLINE: demo data` badge |
| `GEMINI_API_KEY` | Google AI Studio | canned lines from `server/canned.ts` |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_PBP` + `ELEVENLABS_VOICE_COLOR` | elevenlabs.io/app/voices | browser `speechSynthesis` with two distinct voices |

Defaults that already work: `GEMINI_MODEL=gemini-3.8-flash`,
`ELEVENLABS_TTS_MODEL=eleven_flash_v2_5`, `PORT=8787`.

## Demo script (90 seconds)

1. `npm run dev`, open the client, point at the `OFFLINE/LIVE` badge.
2. Hit **START BROADCAST** — history replays as plays, balance ticks down,
   halftime report lands mid-show.
3. Mid-sentence, hit **DoorDash $28** (or any Impulse Buy) — the play appears
   instantly, commentary queues behind the current line, screen shakes.
4. Hit **Postgame** for the final-score wrap-up and MVP (worst purchase).
5. Talking points: stats engine vs LLM math, Nessie write-back (check the
   Nessie console — sparse accounts get seeded with the demo history),
   TTS cache (repeat lines cost nothing).

## API reference

- `GET /api/health` → `{ ok, service, config, sessionPurchases }`
- `GET /api/transactions[?source=seed]` → `{ transactions, stats, source, accountLabel }`
- `POST /api/commentate` `{ plays[≤3], stats, mode }` → `{ commentary: { lines[], chyron }, source: \"gemini\"|\"canned\" }`
- `POST /api/tts` `{ speaker: \"PBP\"|\"COLOR\", text }` → `audio/mpeg` (4xx/5xx → client falls back)
- `POST /api/purchase` `{ merchant, amount, description? }` → `{ transaction, persisted, stats }`

Broadcast modes: `play` (live reaction) · `halftime` (trend report) ·
`postgame` (final score + MVP roast). UI phases: `pregame → q1 → q2 →
halftime → postgame (FINAL)`.

## Project layout

```
server/  index.ts (routes)  nessie.ts  gemini.ts  tts.ts  canned.ts  seed.ts  env.ts
shared/  types.ts  stats.ts (+ stats.test.ts)
src/     App.tsx  api.ts  hooks/useBroadcast.ts
         components/ Scoreboard Booth Chyron PlayFeed Ticker Controls
```

## Notes for judges

- No database: session purchases live in server memory; TTS + commentary are
  in-memory cached by content hash (repeat demos are instant and free).
- Nessie writes use negative amounts (spending); transfers are excluded from
  Biggest Play; `GET /api/transactions?source=seed` forces the offline path.
- `?source=seed`, `/api/health`, and the `LIVE/OFFLINE` badge make every
  fallback testable in one click during judging.

