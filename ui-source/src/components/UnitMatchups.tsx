import { useMemo } from "react";

import { TEAMS_BY_CODE } from "@/data/teams";
import { useStore } from "@/state/store";
import { unitReport, type UnitReport } from "@/state/unitReport";

/**
 * Where this game is won: the unit-against-unit clashes the engine actually
 * resolves. A great pass rush against a weak line is where sacks and bad
 * throws come from, a receiver group against a secondary is where the
 * passing game lives, and the run game is the back and his line against the
 * interior and the linebackers. Each side's number is its unit strength
 * (pulled toward its weakest starter), so a mismatch here is a mismatch on
 * the field.
 */
export function UnitMatchups({
  teamCode,
  oppCode,
  names,
}: {
  teamCode: string;
  oppCode: string;
  /** Both teams' names, when the game isn't the viewer's. */
  names?: [string, string];
}) {
  const players = useStore((s) => s.players);
  const teams = useStore((s) => s.teams);
  const depthChart = useStore((s) => s.depthChart);
  const [mine, theirs] = useMemo(() => {
    const st = { players, teams, depthChart } as Parameters<typeof unitReport>[0];
    return [unitReport(st, teamCode), unitReport(st, oppCode)];
  }, [players, teams, depthChart, teamCode, oppCode]);

  const u = (r: UnitReport, key: string) => r.units.find((x) => x.key === key)?.strength ?? 0;
  const avg = (r: UnitReport, keys: string[]) => keys.reduce((n, k) => n + u(r, k), 0) / keys.length;
  const you = names ? names[0] : "Your";
  const them = names ? `${names[1]}` : "their";
  const rows = [
    { label: "Your pass rush vs their line", a: u(mine, "passRush"), b: u(theirs, "offensiveLine") },
    { label: "Your line vs their pass rush", a: u(mine, "offensiveLine"), b: u(theirs, "passRush") },
    { label: "Your passing game vs their secondary", a: (mine.pairing.value + u(mine, "receivers")) / 2, b: avg(theirs, ["corners", "safeties"]) },
    { label: "Your secondary vs their passing game", a: avg(mine, ["corners", "safeties"]), b: (theirs.pairing.value + u(theirs, "receivers")) / 2 },
    { label: "Your run game vs their front", a: avg(mine, ["runningBack", "offensiveLine"]), b: avg(theirs, ["interior", "linebackers"]) },
    { label: "Your front vs their run game", a: avg(mine, ["interior", "linebackers"]), b: avg(theirs, ["runningBack", "offensiveLine"]) },
  ];
  const opp = TEAMS_BY_CODE[oppCode]?.abbr ?? oppCode;
  const mineName = names ? names[0] : "you";
  const label = (text: string): string =>
    names ? text.replace("Your ", `${you} `).replace(" their ", ` ${them} `).replace("vs their", `vs ${them}`) : text;

  return (
    <div>
      <div className="msection">Where the game is won</div>
      <div>
        {rows.map((r) => {
          const edge = r.a - r.b;
          const tone = edge >= 3 ? "var(--good)" : edge <= -3 ? "var(--bad)" : "var(--ink-faint)";
          const word = edge >= 3 ? `edge ${mineName}` : edge <= -3 ? `edge ${opp}` : "even";
          return (
            <div key={r.label} className="mrow mgrid">
              <span className="mlabel">
                {label(r.label)}
                <small style={{ color: tone, fontWeight: 600 }}>{word}</small>
              </span>
              <span className={`mval ${edge >= 3 ? "fav" : ""}`}>{Math.round(r.a)}</span>
              <span className={`mval ${edge <= -3 ? "fav" : ""}`}>{Math.round(r.b)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
