/**
 * The shouting.
 *
 * Old football-game soundtracks were workout rock with ridiculous lyrics, and
 * this is the ridiculous-lyrics half: a voice bellowing something absurd over
 * the riff. These are all original lines, spoken by the browser's own
 * speech synthesis — low, fast and loud — so there is no recording in the
 * bundle and no singing to get wrong. Where a browser has no speech voice,
 * or the player has the chants switched off, it does nothing at all.
 */
import { audio } from "./engine.ts";
import type { MoodName } from "./score.ts";

const LINES: Record<MoodName, string[]> = {
  lobby: [
    "Sign the papers! Sharpen the pencils!",
    "I was born in a weight room!",
    "Nobody told the cones they were safe!",
    "Lace them up! Lace them up! Lace them up!",
  ],
  frontOffice: [
    "Spreadsheets of fury!",
    "Trade trade trade trade trade!",
    "My cap space is a state of mind!",
    "Balance the books! Break the bones!",
  ],
  draft: [
    "Pick a giant! Pick a giant!",
    "The clock is a wolf!",
    "Write his name in iron!",
    "I draft with my fists!",
    "Bring me a man the size of a door!",
  ],
  freeAgency: [
    "Money goes in! Muscles come out!",
    "Sign the beast! Sign the beast!",
    "Outbid the thunder!",
    "Every contract has teeth!",
  ],
  gameday: [
    "Tackle the wind!",
    "I have one neck and it is plenty!",
    "My helmet is a house!",
    "Bench press the moon!",
    "Hike hike hike hike! Gravel for breakfast!",
    "Run through the wall, then run back for the wall!",
  ],
  playoffs: [
    "January has teeth!",
    "The trophy is hungry!",
    "Nobody leaves until somebody limps!",
    "Cold air! Hot blood!",
  ],
  champion: [
    "I am the king of the lawn!",
    "Bow to the big shiny trophy!",
    "Carry me on a couch!",
    "Victory tastes like Gatorade!",
  ],
};

let spoken = 0;

/** Shout a line for `mood` after `delayMs`, if chants are on and a voice exists. */
export function shout(mood: MoodName, bar: number, delayMs: number): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!audio.settings.enabled || !audio.settings.chants) return;
  const lines = LINES[mood];
  const line = lines[(bar + spoken++) % lines.length];
  if (!line) return;
  window.setTimeout(() => {
    // still wanted when the moment arrives
    if (!audio.settings.enabled || !audio.settings.chants) return;
    const synth = window.speechSynthesis;
    // one voice at a time: a chant on top of a chant is noise
    if (synth.speaking) return;
    const say = new SpeechSynthesisUtterance(line);
    say.pitch = 0.35;
    say.rate = 1.15;
    say.volume = Math.min(1, 0.35 + audio.settings.musicVolume);
    synth.speak(say);
  }, delayMs);
}

/** Stop a line mid-shout, e.g. when the player turns sound off. */
export function hush(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
