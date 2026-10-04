import "dotenv/config";

/**
 * Central place to read env vars, so no other file touches process.env directly
 * and the "is this service configured?" checks live in exactly one spot.
 */

export const NESSIE_BASE_URL =
  process.env.NESSIE_BASE_URL?.trim() || "https://api.nessieisreal.com";

// DOC ADAPTATION: the build spec says http://api.nessieisreal.com, but the live
// host now refuses plain HTTP (port 80 -> connection refused) and only serves
// HTTPS. Verified 2026-10-03. Docs win.
export const NESSIE_API_KEY = process.env.NESSIE_API_KEY?.trim() || "";

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() || "";

// MODEL TIER. While developing, leave this on a *-flash-lite model: it is far
// cheaper and plenty fast for the booth's short JSON scripts. Swap in the big
// model right before you demo (see .env.example for the switch).
// Verified against this key 2026-10-03. Note gemini-2.5-flash-lite is retired
// for new users and 404s; gemini-3.8-flash-lite does not exist.
export const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";

/**
 * Optional: pin a specific Nessie account id.
 *
 * The public demo host refuses POST /accounts outright -- 403 "Missing
 * Authentication Token" under ?key=, X-API-Key, x-api-key and Bearer alike --
 * while happily creating customers and merchants. So the server cannot bootstrap
 * its own account. Create one account in the Nessie console for the customer
 * below and paste its id here; without this we try to create one, fail, and
 * serve demo data instead.
 */
export const NESSIE_ACCOUNT_ID = process.env.NESSIE_ACCOUNT_ID?.trim() || "";

export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY?.trim() || "";
export const ELEVENLABS_VOICE_PBP =
  process.env.ELEVENLABS_VOICE_PBP?.trim() || "";
export const ELEVENLABS_VOICE_COLOR =
  process.env.ELEVENLABS_VOICE_COLOR?.trim() || "";
// DOC ADAPTATION: "Flash v2.5" is `eleven_flash_v2_5`, confirmed in the
// ElevenLabs models doc (~75ms median latency).
export const ELEVENLABS_TTS_MODEL =
  process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5";

export const PORT = Number(process.env.PORT || 8787);

export const nessieConfigured = Boolean(NESSIE_API_KEY);
export const geminiConfigured = Boolean(GEMINI_API_KEY);
export const elevenLabsConfigured = Boolean(
  ELEVENLABS_API_KEY && ELEVENLABS_VOICE_PBP && ELEVENLABS_VOICE_COLOR,
);

/** One-line readiness summary, surfaced at /api/health for demo-day debugging. */
export function configStatus() {
  return {
    nessie: nessieConfigured ? "configured" : "missing key -> using demo data",
    gemini: geminiConfigured ? "configured" : "missing key -> using canned lines",
    elevenlabs: elevenLabsConfigured
      ? "configured"
      : "missing key/voices -> using browser voices",
    geminiModel: GEMINI_MODEL,
    ttsModel: ELEVENLABS_TTS_MODEL,
  };
}
