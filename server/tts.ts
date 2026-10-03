import type { Speaker } from "../shared/types";
import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_TTS_MODEL,
  ELEVENLABS_VOICE_COLOR,
  ELEVENLABS_VOICE_PBP,
  elevenLabsConfigured,
} from "./env";

/**
 * ElevenLabs text-to-speech, via plain fetch (no SDK needed).
 *
 * The API key stays on the server. The browser only ever talks to /api/tts, and
 * when that fails the client falls back to speechSynthesis (see useBroadcast).
 *
 * DOC NOTES (verified against the ElevenLabs API reference, Oct 2026):
 * - Endpoint: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 * - Auth header: `xi-api-key`
 * - mp3 output is requested with `output_format` (e.g. mp3_44100_128)
 * - "Flash v2.5" is the model id `eleven_flash_v2_5` (~75ms median latency)
 * - voice_settings: stability, similarity_boost, style, use_speaker_boost, speed
 */

const TTS_BASE_URL = "https://api.elevenlabs.io";
const TIMEOUT_MS = 10000;

/** Distinct delivery per announcer: Mike is a man shouting, Linda is ice. */
const VOICE_PRESETS: Record<
  Speaker,
  {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
    speed: number;
  }
> = {
  // Energetic male PBP: low stability + high style = loud, breathless.
  PBP: {
    stability: 0.28,
    similarity_boost: 0.8,
    style: 0.85,
    use_speaker_boost: true,
    speed: 1.14,
  },
  // Dry color commentator: high stability, zero style = deadpan.
  COLOR: {
    stability: 0.72,
    similarity_boost: 0.75,
    style: 0.1,
    use_speaker_boost: true,
    speed: 0.96,
  },
};

/** speaker+text -> mp3 bytes. Repeat lines during a demo cost nothing. */
const cache = new Map<string, Buffer>();

function cacheKey(speaker: Speaker, text: string): string {
  let h = 5381;
  const input = `${speaker}::${text}`;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function voiceIdFor(speaker: Speaker): string {
  return speaker === "COLOR" ? ELEVENLABS_VOICE_COLOR : ELEVENLABS_VOICE_PBP;
}

export class TtsError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "TtsError";
    this.status = status;
  }
}

/**
 * Synthesize one line. Resolves to mp3 bytes.
 * Throws TtsError so the route can return a 502 and the browser can fall back.
 */
export async function synthesizeSpeech(
  speaker: Speaker,
  text: string,
): Promise<Buffer> {
  const key = cacheKey(speaker, text);
  const cached = cache.get(key);
  if (cached) return cached;

  if (!elevenLabsConfigured) {
    throw new TtsError(
      "ElevenLabs is not configured (need ELEVENLABS_API_KEY and both voice IDs)",
      503,
    );
  }

  const voiceId = voiceIdFor(speaker);
  if (!voiceId) throw new TtsError(`No ElevenLabs voice ID for ${speaker}`, 503);

  let response: Response;
  try {
    response = await fetch(
      // output_format is a query param in the current API.
      `${TTS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_TTS_MODEL,
          voice_settings: VOICE_PRESETS[speaker],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw new TtsError(
      `ElevenLabs request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // 401 = bad key, 429 = out of credits/rate limited. Both are "use the
    // browser voice instead" situations for the client.
    throw new TtsError(
      `ElevenLabs HTTP ${response.status}: ${body.slice(0, 200)}`,
      response.status,
    );
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) throw new TtsError("ElevenLabs returned no audio");

  cache.set(key, audio);
  return audio;
}
