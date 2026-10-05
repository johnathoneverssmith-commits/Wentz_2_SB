import { type MotionLevel, setMotionLevel, useMotionLevel } from "./level";

const OPTIONS: { id: MotionLevel; label: string; hint: string }[] = [
  { id: "full", label: "Full", hint: "Slides, count-ups and the big moments" },
  { id: "subtle", label: "Subtle", hint: "The same, brisk, without the flourishes" },
  { id: "off", label: "Off", hint: "Nothing moves" },
];

/**
 * The motion setting: a three-way switch beside the sound control. A device
 * preference (see `level.ts`), so it takes effect at once and is remembered.
 */
export function MotionControl() {
  const level = useMotionLevel();
  return (
    <div className="motionbox" role="radiogroup" aria-label="Motion">
      <span className="motionlabel">Motion</span>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={level === o.id}
          className={level === o.id ? "on" : undefined}
          title={o.hint}
          onClick={() => setMotionLevel(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
