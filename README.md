# Checkout Critics

**Live at [checkout-critics.tech](https://checkout-critics.tech)**

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
                        play feed, ticker tape
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

### Troubleshooting: `403 Restricted` in dev

Vite refuses to serve files from any directory path that contains a colon
(`isFileLoadingAllowed()` in Vite returns false on `path.includes(":")` *before*
it consults `server.fs.allow`). If you cloned this into a folder like
`Hackathons:Events/MHacks-2026`, plain dev mode 403s every request with "outside
of Vite serving allow list".

`vite.config.ts` detects a colon in the project path and relaxes
`server.fs.strict` only in that case. If you would rather keep strict mode, drop
the colon from the path and everything works untouched:

```bash
mv "/Users/you/Documents/Hackathons:Events" /Users/you/Documents/Hackathons-Events
```

`npm run build && npm start` is unaffected by this either way — the production
Express server on :8787 does its own static file serving and has no such rule.

### Notes on the audio

Two completely different engines with very different failure modes.

**ElevenLabs (primary).** Each line is a real mp3 decoded by the browser, so it
can be faded out before it's discarded — no hard cut, no click. The gain is
ridden down over the last 90 ms of every clip, driven off `currentTime` so it
freezes correctly while paused. **If you hear a click with this key present,
something is broken** — this path cannot produce one. Check that `POST /api/tts`
returns `200` / `audio/mpeg` and not `503`.

If ElevenLabs *does* fail, the booth now prints **why** under the caption strip
rather than just "unavailable", because "out of credits" and "wrong voice id"
look identical on screen and need completely different fixes:

```
browser voices — elevenlabs unavailable
out of credits — raise the key quota in ElevenLabs
```

Worth knowing: ElevenLabs reports an exhausted quota as an HTTP **401** with
`code: quota_exceeded` — not a 403 or 429 — so don't assume a 401 means a bad
key. Lines are cached by speaker+text in memory so repeats are free, but the
cache does **not** survive a server restart.

**Browser voices (fallback, only if ElevenLabs is unavailable).** This path is
genuinely clicky, and none of it is fixable in JS: `speechSynthesis` has no
graceful stop, so `cancel()` severs the output stream at whatever amplitude it
happens to be at, on every interrupt, and macOS renders that as a pop. Three
things soften it, each independently switchable from the URL bar so you can
bisect which one actually matters on your machine:

| Param | Effect |
|---|---|
| `?nopause=1` | Stop appending the trailing ` …` that gives the engine room to fade |
| `?nogap=1` | Stop pausing between lines so the output buffer can drain |
| `?gap=300` | Tune the inter-line gap in ms (default 180) |
| `?novoice=1` | Let the engine pick its own default voice |
| `?voice=Alex` | Force one voice for both critics (partial name match) |
| `?pbp=Alex&color=Samantha` | Force each critic separately |

Every fallback line logs the voice it actually used:

```
[audio] PBP -> Daniel | "…twenty eight dollars and forty cents …"
```

Two more behaviours worth knowing: interrupts ride the global volume down to
zero over ~70 ms before cutting, and **the stop operations are serialised** —
`speechSynthesis.volume` is global and persists between calls, so overlapping
interrupts used to ratchet the master volume toward silence. Also, watchdogs
count unpaused time only, so holding the show on Pause can never swallow the
rest of a line.

#### Debugging the click (browser voices only)

`speechSynthesis` has no graceful stop — `cancel()` severs the output stream at
whatever amplitude it happens to be at. Three things soften that, and each can be
switched off independently from the URL bar so you can bisect which one actually
matters on your machine:

| Param | Effect |
|---|---|
| `?nopause=1` | Stop appending the trailing ` …` that gives the engine room to fade |
| `?nogap=1` | Stop pausing between lines so the output buffer can drain |
| `?gap=300` | Tune the inter-line gap in ms (default 180) |
| `?novoice=1` | Let the engine pick its own default voice |
| `?voice=Alex` | Force one voice for both critics (partial name match) |
| `?pbp=Alex&color=Samantha` | Force each critic separately |

Every line logs the voice it actually used to the console:

```
[audio] PBP -> Daniel | "…twenty eight dollars and forty cents …"
```

So if the click tracks one specific voice, you'll see it immediately in the log
rather than guessing. If it survives all of the above, it is the engine — the
mp3 path (`ELEVENLABS_API_KEY`) has no equivalent problem, because a decoded
buffer can be faded out before it is discarded.

## API keys (all optional — every service degrades gracefully)

| Key | Where | Without it |
|---|---|---|
| `NESSIE_API_KEY` | http://api.nessieisreal.com | in-memory demo data, `OFFLINE: demo data` badge |
| `GEMINI_API_KEY` | Google AI Studio | canned lines from `server/canned.ts` |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_PBP` + `ELEVENLABS_VOICE_COLOR` | elevenlabs.io/app/voices | browser `speechSynthesis` with two distinct voices |

### Model tiers: cheap while you build, big on demo day

Development runs on the **cheapest tier that works**, so you are not paying for
commentary nobody is grading. Flip to the big models right before you present.

| | Development | Demo day |
|---|---|---|
| Commentary | `GEMINI_MODEL=gemini-3.5-flash-lite` | `GEMINI_MODEL=gemini-3.8-flash` |
| Voice | `eleven_flash_v2_5` (already the cheapest) | `eleven_v3` / `eleven_multilingual_v2` |

Both are one env var away — see `.env.example`. `MODEL_FALLBACKS` in
`server/gemini.ts` walks *in whichever direction that points*: cheap → pricier
while you develop, and big → cheaper if the headline model is saturated
mid-pitch, so a 503 never silently drops the booth to canned lines.

> `gemini-2.5-flash-lite` is retired for new users (404s) and
> `gemini-3.8-flash-lite` does not exist. Both are verified against a live key.

### Nessie: it works, and it writes

Live end to end: `GET /api/transactions` returns `source: "nessie"` with real
records read out of a real account, and **Impulse Buy POSTs straight into
Nessie** (`persisted: true`). The server creates its own customer, account,
merchants and purchase history on first run, then reads it all back — so a
judge can open the Nessie console and see the booth's data.

Four things the docs don't tell you, all verified against the live API:

1. **Accounts are created under the customer** — `POST /customers/{id}/accounts`.
   `POST /accounts` is not a route; it lands on another backend and answers
   `403 Missing Authentication Token`, which reads exactly like a bad API key.
2. **`type` is a closed enum** — `'Credit Card' | 'Savings' | 'Checking'`, and
   `rewards` is required even though we never use it.
3. **Purchases want snake_case and lowercase enums** — `merchant_id`,
   `medium: 'balance'`, `status: 'completed'`, and the date field is
   `purchase_date`. Sending `date` is rejected as an extra field.
4. **Writes wrap the response** — `{ code, message, objectCreated: {...} }`, so
   `created._id` is `undefined` unless you unwrap it. This one is silent: the
   purchase is created, then the next call fails on a missing `merchant_id`.

Two unavoidable quirks worth knowing before you demo:

- **Amounts are integers.** Nessie stores `-12.34` as `-12`, so cents do not
  survive the round trip. Fine for a sports broadcast, worth a shrug in a
  finance context.
- **`GET /merchants` (the list) is unusable.** It validates every merchant
  record on the key and 400s the entire response if any single one is
  malformed. The code never calls it — merchant names are resolved one at a
  time via `GET /merchants/{id}`, which is unaffected. If you ever create a
  merchant by hand in the console, give it a full street address.

> Restart the server after editing `.env`. `tsx watch` only watches `.ts` files,
> so without a restart your new keys are silently ignored and you spend an hour
> debugging a model that was never called.

## Show controls

The console is a real transport, not a set of static buttons. Every key acts
immediately.

The console is **four square keys in one row**, plus Impulse Buy as a full-width
bar underneath.

| Key | Behaviour |
|---|---|
| **Start Broadcast** | Replays your history, 2 plays per segment, halftime spliced in at the midpoint. |
| **Pause / Resume** | Freezes the line that is on air mid-word (audio element or browser voice) and parks the segment runner. Nothing advances until you resume. |
| **Mute** | Silent playback — lines still advance on a timed cadence so the visuals stay in sync. |
| **Halftime** | Jumps straight to a trend report. **Cuts the current line** instead of waiting for the segment to finish. |
| **Postgame** | Jumps straight to the final review poster. Also cuts the air immediately. |
| **Impulse Buy** | **Cuts the air.** The booth stops mid-sentence and reacts to this purchase immediately, then resumes the backlog it interrupted. Also writes straight to Nessie. |

There is deliberately no **Restart** and no **Stop**. Restarting is a page
reload, and Stop was a third way to say what Pause already does instantly. Both
are still implemented on the hook (`startOver`, `stopBroadcast`) if you ever
want them back on a keyboard shortcut.

Phase tracking is derived from the segments themselves, so the scoreboard
reads `Q1` before halftime and `Q2` after it — it never gets stuck on
`HALFTIME` while plays keep running.

## Demo script (90 seconds)

1. `npm run dev`, open the client, point at the `OFFLINE/LIVE` badge.
2. Hit **START BROADCAST** — history replays as plays, balance ticks down,
   halftime report lands mid-show.
3. Mid-sentence, hit **Impulse Buy** — the booth cuts off mid-word, the screen
   shakes, a $28 DoorDash lands in the feed with both critics' scores, and the
   show picks the backlog back up when the booth is done yelling. This is the
   moment the app exists for; make it the last thing you demo.
4. Hit **Pause** to hold the show mid-word, then **Resume**. Hit **Postgame**
   for the poster-style final review: whole-run scores, thumbs, a movie-poster
   pull quote, and a working **Start over**.
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

