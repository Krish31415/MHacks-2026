import type { CommentaryLine, CommentaryResponse, Speaker } from "../shared/types";

/**
 * Fallback commentary used when Gemini is missing a key, errors, or returns
 * garbage twice in a row. These lines are deliberately generic enough to work
 * for any purchase, because the client shows real numbers on the scoreboard
 * regardless of what the booth says.
 */

type Canned = {
  speaker: Speaker;
  text: string;
  intensity: CommentaryLine["intensity"];
  chyron: string;
};

const CANNED_LINES: Canned[] = [
  {
    speaker: "PBP",
    text: "And another shot on goal, Linda! The crowd is on its feet and the balance is running out of time!",
    intensity: 4,
    chyron: "ANOTHER ONE GOES",
  },
  {
    speaker: "COLOR",
    text: "Let's be clear about what we're watching here. A man is spending money he already spent.",
    intensity: 3,
    chyron: "EXPENSIVE HABITS",
  },
  {
    speaker: "PBP",
    text: "That's cash leaving the building! The box score is getting uglier by the minute!",
    intensity: 4,
    chyron: "CASH OUT THE DOOR",
  },
  {
    speaker: "COLOR",
    text: "I've covered a lot of athletes. Never once did one finish a week this far in the red.",
    intensity: 3,
    chyron: "DEEP IN THE RED",
  },
  {
    speaker: "PBP",
    text: "He does not need this! He bought this! And yet here we are, live from the spending floor!",
    intensity: 5,
    chyron: "HE DID NOT NEED THIS",
  },
  {
    speaker: "COLOR",
    text: "Statistically speaking, the fridge at home is full. Statistically speaking, the fridge is winning.",
    intensity: 3,
    chyron: "THE FRIDGE IS WINNING",
  },
  {
    speaker: "PBP",
    text: "The hesitation! The look at the screen! That is the face of a man reconsidering his entire lifestyle!",
    intensity: 5,
    chyron: "THE HESITATION",
  },
  {
    speaker: "COLOR",
    text: "I'd like to speak about the word 'necessary.' Nobody has said it once tonight.",
    intensity: 2,
    chyron: "NOBODY SAID NECESSARY",
  },
  {
    speaker: "PBP",
    text: "Down goes the balance, up goes the regret! What a time to be alive in the checkout critics booth!",
    intensity: 4,
    chyron: "DOWN GOES THE SCORE",
  },
  {
    speaker: "COLOR",
    text: "We've seen a lot of turnovers in this room. Subscription turnovers. Same amount, every month.",
    intensity: 3,
    chyron: "SUBSCRIPTION TURNOVERS",
  },
];

/** Deterministic-ish pick so repeated fallbacks do not feel frozen. */
let cursor = 0;

export function cannedCommentary(
  merchant?: string,
  amount?: number,
): CommentaryResponse {
  const a = CANNED_LINES[cursor % CANNED_LINES.length];
  const b = CANNED_LINES[(cursor + 1) % CANNED_LINES.length];
  cursor += 2;

  const money =
    typeof amount === "number" ? `${amount.toFixed(2)} dollars` : "real money";
  const who = merchant ?? "that merchant";

  const lines: CommentaryLine[] = [
    { speaker: a.speaker, text: a.text, intensity: a.intensity },
    {
      speaker: b.speaker,
      text:
        typeof amount === "number"
          ? `${who}, ${money}. Put it on the board and try to act surprised.`
          : b.text,
      intensity: b.intensity,
    },
  ];

  return { lines, chyron: a.chyron };
}

/** Halftime + postgame need their own canned shapes so the demo still lands. */
export function cannedMode(mode: "halftime" | "postgame"): CommentaryResponse {
  if (mode === "halftime") {
    return {
      lines: [
        {
          speaker: "PBP",
          text: "Halftime, everybody. The score so far is brutal and the second half looks worse.",
          intensity: 3,
        },
        {
          speaker: "COLOR",
          text: "Every time this bank account opens, it gets quieter. That is the halftime read.",
          intensity: 3,
        },
        {
          speaker: "PBP",
          text: "Back in a moment, and by back I mean back at these numbers.",
          intensity: 2,
        },
      ],
      chyron: "HALFTIME REPORT",
    };
  }

  return {
    lines: [
      {
        speaker: "PBP",
        text: "That's the game! Final score is in, and the bank wins it in a walkover!",
        intensity: 5,
      },
      {
        speaker: "COLOR",
        text: "Final score posted. Nobody in this building is a winner tonight, least of all the balance.",
        intensity: 4,
      },
      {
        speaker: "PBP",
        text: "MVP, unquestionably, was the most expensive thing you bought. We'll take questions. There are none.",
        intensity: 4,
      },
      {
        speaker: "COLOR",
        text: "Same time next week? Assuming there is a next week. For the balance, I'm not sure.",
        intensity: 3,
      },
    ],
    chyron: "FINAL: THE BANK WINS",
  };
}
