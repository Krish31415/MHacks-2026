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

## Built with

React, from-scratch Express (TypeScript, `tsx`), Vite, Tailwind CSS, Capital One Nessie API, Google Gemini (`@google/genai`), ElevenLabs text-to-speech.

## Links

- Repo: https://github.com/Krish31415/MHacks-2026
- Live demo (target): https://checkout-critics.tech
