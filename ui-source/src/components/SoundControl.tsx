import { useEffect, useState } from "react";

import { audio } from "@/audio/engine";

/**
 * The switch for the soundtrack.
 *
 * Off until asked, because a browser will not start an audio context without
 * a gesture and because a management sim that starts playing music at you is
 * a management sim you mute once and never unmute. So the control is visible
 * rather than buried, says what it will do, and remembers the answer.
 *
 * The two sliders only appear once sound is on: three controls for a feature
 * that is off is two controls too many.
 */
export function SoundControl() {
  const [, force] = useState(0);
  useEffect(() => audio.onChange(() => force((n) => n + 1)), []);
  const { enabled, musicVolume, sfxVolume } = audio.settings;

  return (
    <div className={`soundbox${enabled ? " on" : ""}`}>
      <button
        type="button"
        className="soundtoggle"
        aria-pressed={enabled}
        // the click *is* the gesture that unlocks the context, so this must
        // stay synchronous — see `AudioEngine.unlock`
        onClick={() => audio.setEnabled(!enabled)}
        title={enabled ? "Turn the soundtrack off" : "Original music, generated as you play"}
      >
        <Speaker on={enabled} />
        <span>{enabled ? "Sound on" : "Sound off"}</span>
      </button>

      {enabled && (
        <div className="soundmix">
          <label>
            <span>Music</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(musicVolume * 100)}
              aria-label="Music volume"
              onChange={(e) => audio.setMusicVolume(Number(e.target.value) / 100)}
            />
          </label>
          <label>
            <span>Effects</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(sfxVolume * 100)}
              aria-label="Effects volume"
              onChange={(e) => audio.setSfxVolume(Number(e.target.value) / 100)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Speaker({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden="true" focusable="false">
      <path
        d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      {on ? (
        <>
          <path
            d="M15.4 9.1a4 4 0 0 1 0 5.8"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <path
            d="M17.9 6.8a7.4 7.4 0 0 1 0 10.4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            opacity={0.65}
          />
        </>
      ) : (
        <path
          d="M15.5 9.5l5 5m0-5l-5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
