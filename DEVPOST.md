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

**An hour lost to a 403 that was entirely our fault.** Nessie is very well documented — we simply hadn't read it. Creating an account returned `403 Missing Authentication Token`, which looks exactly like a rejected key, and we treated it like one: tried every auth header, blamed the account tier, suspected the key. The key was fine. Accounts aren't created with `POST /accounts` (they hang off their customer), `type` is a closed enum, `rewards` is a required field, the date field is `purchase_date`, and write responses wrap the created object in `{objectCreated}` — so `created._id` was silently `undefined`, and the *next* call then failed complaining about a missing `merchant_id`, which read as a validation bug rather than the `undefined` it actually was. Every one of those is in the docs. Most of them are in the first screen of them.

The same thing happened twice more. Gemini: our dev model 404s for new users, and a model we simply guessed at never existed — both listed in the models endpoint we hadn't called. ElevenLabs: an exhausted quota returns HTTP 401 with `code: "quota_exceeded"`, not a 429, so we spent time debugging voice IDs that were perfectly fine. And because every service here degrades gracefully, that last one surfaced as a generic *"browser voices — unavailable"* — an out-of-credits key rendered indistinguishable from a typo.

The pattern wasn't that the APIs were hard. It was that **every one of these errors pointed somewhere plausible but wrong**, so the instinct was always to debug the integration instead of going back and read. Nothing here needed a clever workaround; it needed reading the docs — and then making sure a fallback failure tells you *why* instead of smoothing it into something generic.

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
