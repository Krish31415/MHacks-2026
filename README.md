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

## How we used each sponsor API

- **Capital One Nessie** — the server loads a real customer → account → purchases
  and normalizes them into our `Transaction` type; sparse demo accounts get seeded
  with the fake-spending history so judges can see real data in the Nessie console.
- **Google Gemini** — writes the two-person commentary script as strictly-schemaed
  JSON: 2–4 spoken lines, a TV lower-third chyron, and a `verdicts` array giving
  each purchase a 0–10 score from both critics.
- **ElevenLabs** — turns each line into an mp3 with a low-latency flash model,
  mapping Mike to one voice ID and Linda to another (browser voices as fallback).

**The critic scoring system:** every purchase gets two scores, one from each
critic — an integer 0–10 where essentials and good value score high and repeat
food delivery, impulse buys, and unused subscriptions score low. A purchase where
they disagree by 4+ points is flagged on screen as a **SPLIT DECISION**, and the
running **CRITICS' AVERAGE** is shown on the scoreboard and the ticker tape.

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
| `npm test` | stats engine unit tests (7 tests) |
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
   instantly, commentary queues behind the current line, screen shakes, and a
   verdict card pops in with both critics' scores.
4. Hit **Postgame** for the poster-style final review: whole-run scores, thumbs,
   a movie-poster pull quote, and a working **Start over**.
5. Talking points: stats engine vs LLM math, Nessie write-back (check the
   Nessie console — sparse accounts get seeded with the demo history),
   TTS cache (repeat lines cost nothing).

## API reference

- `GET /api/health` → `{ ok, service, config, sessionPurchases }`
- `GET /api/transactions[?source=seed]` → `{ transactions, stats, source, accountLabel }`
- `POST /api/commentate` `{ plays[≤3], stats, mode, verdicts? }` → `{ commentary: { lines[], chyron, verdicts[], finalReview? }, source: "gemini"|"canned" }`
- `POST /api/tts` `{ speaker: \"PBP\"|\"COLOR\", text }` → `audio/mpeg` (4xx/5xx → client falls back)
- `POST /api/purchase` `{ merchant, amount, description? }` → `{ transaction, persisted, stats }`

Broadcast modes: `play` (live reaction + one verdict per play) · `halftime`
(trend report, no verdicts) · `postgame` (final review: whole-run scores, an MVP
roast, and a movie-poster `pullQuote`). UI phases: `pregame → q1 → q2 →
halftime → postgame (FINAL)`.

## Entered in

**FinTech** (main track) plus the **Useless AI**, **Dumbest Idea**, and **Judged
by an LLM** side quests. Devpost blurb and side-quest pitches are in
[`DEVPOST.md`](./DEVPOST.md).


## Project layout

```
server/  index.ts (routes)  nessie.ts  gemini.ts  tts.ts  canned.ts  seed.ts  env.ts
shared/  types.ts  stats.ts (+ stats.test.ts)
src/     App.tsx  api.ts  hooks/useBroadcast.ts
         components/ Scoreboard Booth Chyron PlayFeed Ticker Controls
                     VerdictCard FinalReviewCard
```

## Notes for judges

- No database: session purchases live in server memory; TTS + commentary are
  in-memory cached by content hash (repeat demos are instant and free).
- Nessie writes use negative amounts (spending); transfers are excluded from
  Biggest Play; `GET /api/transactions?source=seed` forces the offline path.
- `?source=seed`, `/api/health`, and the `LIVE/OFFLINE` badge make every
  fallback testable in one click during judging.

