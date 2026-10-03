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
// DOC ADAPTATION: spec guessed a "flash" model. Current stable flash tier is
// gemini-3.8-flash (verified against the Gemini model list, 2026-10-03).
export const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";

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
