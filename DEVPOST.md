# Checkout Critics — Devpost submission

## Blurb

> Checkout Critics puts two AI critics in a sports broadcast booth to review every purchase you make, live and out loud. Transactions come from Capital One's Nessie API, Gemini writes the commentary and scores each purchase using real numbers computed from your data, and ElevenLabs gives the critics their voices. Mike is easily impressed, Linda is not, and they will disagree about your 2am DoorDash on air. Hit IMPULSE BUY to watch them react in real time, then end the session for a final review with a pull quote worthy of a movie poster. Is it useful? No. Two thumbs down? Probably. Built with React, Express, Nessie, Gemini, and ElevenLabs, deployed on a .tech domain.

## Tags

Capital One Nessie · ElevenLabs · Google Gemini API · MLH · FinTech · Useless AI · Dumbest Idea · Judged by an LLM · .Tech domain

---

## Side-quest judge pitch

### Useless AI (3 lines)

1. We pointed a sports broadcast booth at a bank account and made it the game of the week.
2. Gemini calls every purchase like a game-winning drive, then gives it a 0–10 critic score with a thumbs verdict.
3. It solves absolutely nothing, produces no insight, and the final review is always "two thumbs down."

### Dumbest Idea (3 lines)

1. It is a TV show about a guy buying too much DoorDash, staffed entirely by AI, with a scoreboard.
2. Your bank balance is literally the score and the opponent is "THE BANK." You are losing.
3. The climactic feature is an IMPULSE BUY button that makes the commentators yell at you louder.

### Judged by an LLM (3 lines)

1. Every number — balance, totals, streaks, critics' average — is computed in TypeScript; the LLM only writes jokes around numbers it is given, so it cannot hallucinate a dollar amount.
2. The LLM emits strictly-validated JSON (lines, chyron, one 0–10 verdict per critic, and a postgame pull quote) via a response schema, and a canned fallback keeps the show alive if it misbehaves.
3. Critics are instructed to disagree by 3+ points about a third of the time, and the on-air dialogue must quote scores that exactly match the machine-readable verdicts — verifiable on screen.

---

## Challenges we actually ran into

**Building against three APIs that don't document themselves.** Nessie taught us the hardest lesson: it returned `403 Missing Authentication Token` when we tried to create an account — an error that reads exactly like a rejected key, and which we spent real time treating as one. The key was fine; `POST /accounts` simply isn't a route (accounts hang off their customer), and behind that were a closed `type` enum, a mandatory `rewards` field, `purchase_date` instead of `date`, and write responses that wrap the created object in `{objectCreated}` — so `created._id` was silently `undefined` and the *next* call failed on a missing `merchant_id`, which looked like a validation bug rather than the `undefined` it actually was. Gemini churns the same way: our dev model 404s for new users, a model we guessed at never existed, and the flagship intermittently returns 503 "high demand" — so the server now walks a fallback chain, cheapest-first in development and *down* from the headline model on demo day. And ElevenLabs reports an **exhausted quota as HTTP 401 with `code: "quota_exceeded"`** — not a 429, not obviously an auth error — which, since every service here degrades gracefully, surfaced as a generic *"browser voices — unavailable"*. An out-of-credits key was indistinguishable from a typo'd voice ID for far too long.

The pattern across all three: an undocumented detail surfaces as an error that points somewhere *plausible but wrong*, so the instinct is always to suspect your key, your tier, or your library. The lesson wasn't any single API — it was that **a graceful fallback is only useful if it's also an observable one**, and that a confusing error deserves to be reported rather than smoothed over into something generic.

**Browser speech cannot be trusted.** Our fallback path used `speechSynthesis`, and it failed in two ways we only understood by reading the engine's actual behaviour. First, calling `cancel()` while it is paused **wedges it permanently** — every later utterance is silently dropped for the life of the page, which is why "restart" appeared to kill audio forever. Second, `speechSynthesis.volume` is *global and persistent*: two overlapping interrupt ramps each restored the other's partially-lowered value, so every restart ratcheted the master volume a little further down until the show went permanently silent. Both were invisible from the outside — just "the audio stopped" — which is why real TTS (`ELEVENLABS_API_KEY`) is not a luxury here but the thing that makes audio trustworthy at all.

**A screen shake that rebooted the app.** To replay the impact animation we keyed the root element on a shake counter. That remounted the *entire React tree* on every high-intensity play — wiping whatever you had typed into the console, restarting the ticker, and re-popping every verdict card. The animation now runs on a single node via the Web Animations API and never remounts anything.

**Our best feature was unreachable.** IMPULSE BUY appended to the segment queue, so a purchase landed behind every play still ahead of it. In a 90-second show the booth spent the entire run narrating backfill and the button never once fired. It now cuts the line on air — the same `interrupt()` path Halftime and Postgame use — and resumes the backlog afterwards. A $28 DoorDash interrupting Mike mid-word is the whole point of the app, and it only worked once we stopped being polite about the queue.

---

## What we learned

- **Structured output plus validation makes LLM features far more reliable than trusting free-form text.** Every dollar figure is computed in TypeScript and handed to Gemini; the model only writes around numbers it is given. Its scores are clamped and validated against the machine-readable verdicts before they reach the screen — because if Linda says "2 out of 10" and the card shows a 4, the illusion collapses instantly.
- **A graceful fallback is not the same as an observable one.** Degrading quietly is good; degrading *identically for every cause* is how a quota bug masquerades as a config bug for an afternoon.
- **The funniest AI writing comes from real numbers.** Nothing generated is funnier than "twenty eight dollars and forty cents" when that is genuinely the amount you spent at 2am.

---

## Built with

React, from-scratch Express (TypeScript, `tsx`), Vite, Tailwind CSS, Capital One Nessie API, Google Gemini (`@google/genai`), ElevenLabs text-to-speech.

## Links

- Repo: https://github.com/Krish31415/MHacks-2026
- Live demo (target): https://checkout-critics.tech
