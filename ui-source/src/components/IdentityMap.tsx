import { useMemo } from "react";

import { TEAMS_BY_CODE } from "@/data/teams";
import { AI_STRATEGY_IDENTITY, type AiSeasonStrategy } from "@/state/aiStrategy";
import { type IdentityGroup, identityGroups, UNIT_LABEL } from "@/state/draftIdentity";
import { useStore } from "@/state/store";

const COLOR: Record<AiSeasonStrategy | "human", string> = {
  balanced: "#8a94a6",
  offense_heavy: "#e8833a",
  defense_heavy: "#4aa3df",
  pass_heavy: "#e0b43a",
  run_heavy: "#7bc26a",
  high_floor: "#9b8be0",
  high_ceiling: "#e05d8a",
  trenches_first: "#3fbfae",
  human: "#c9ced8",
};
const NAME = (k: IdentityGroup["key"]): string => (k === "human" ? "Human GMs" : AI_STRATEGY_IDENTITY[k].label);

const ordinal = (n: number): string => {
  const v = n % 100;
  return `${n}${["th", "st", "nd", "rd"][(v - 20) % 10] ?? ["th", "st", "nd", "rd"][v] ?? "th"}`;
};

/**
 * The draft's teams, told apart: where each sits between offense and defense,
 * coloured by what its GM prioritizes, and then each identity's teams ranked
 * against each other (and the league) with what that group built stronger
 * than the league. One long list of bars said who was best; this says what
 * kind of team each one is.
 */
export function IdentityMap({ code }: { code: string | null | undefined }) {
  const s = useStore();
  const groups = useMemo(() => identityGroups(s), [s.teams, s.players, s.aiGms, s.gms]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = groups.flatMap((g) => g.teams.map((t) => ({ ...t, key: g.key })));
  if (all.length === 0) return null;
  const xs = all.map((t) => t.offense);
  const ys = all.map((t) => t.defense);
  const pad = 2;
  const x0 = Math.min(...xs) - pad;
  const x1 = Math.max(...xs) + pad;
  const y0 = Math.min(...ys) - pad;
  const y1 = Math.max(...ys) + pad;
  const W = 560;
  const H = 300;
  const L = 36;
  const B = 26;
  const px = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - 10);
  const py = (v: number) => H - B - ((v - y0) / (y1 - y0 || 1)) * (H - B - 10);
  // teams with the same two ratings sit on one spot: fan them out so every dot and label shows
  const spot = new Map<string, number>();
  const placed = all.map((t) => {
    const key = `${t.offense}|${t.defense}`;
    const k = spot.get(key) ?? 0;
    spot.set(key, k + 1);
    return { ...t, k };
  });
  const dx = (t: { offense: number; defense: number; k: number }): number => {
    const n = spot.get(`${t.offense}|${t.defense}`) ?? 1;
    return (t.k - (n - 1) / 2) * 13;
  };
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Every team by offense and defense, coloured by GM identity" style={{ width: "100%", height: "auto", display: "block" }}>
        <rect x={L} y={10} width={W - L - 10} height={H - B - 10} fill="var(--panel-sunken)" rx={4} />
        <line x1={px(mx)} x2={px(mx)} y1={10} y2={H - B} stroke="var(--line)" strokeDasharray="3 3" />
        <line x1={L} x2={W - 10} y1={py(my)} y2={py(my)} stroke="var(--line)" strokeDasharray="3 3" />
        <text x={W - 14} y={24} textAnchor="end" fontSize={10} fill="var(--ink-faint)">
          strong both ways
        </text>
        <text x={L + 6} y={H - B - 6} fontSize={10} fill="var(--ink-faint)">
          weak both ways
        </text>
        <text x={(L + W) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--ink-dim)">
          Starting offense →
        </text>
        <text x={10} y={(H - B) / 2} fontSize={11} fill="var(--ink-dim)" transform={`rotate(-90 10 ${(H - B) / 2})`} textAnchor="middle">
          Starting defense →
        </text>
        {placed.map((t) => {
          const mine = t.code === code;
          const x = px(t.offense) + dx(t);
          return (
            <g key={t.code}>
              <title>{`${TEAMS_BY_CODE[t.code]?.label ?? t.code} · ${t.gm} · ${NAME(t.key)} · off ${t.offense}, def ${t.defense}`}</title>
              <circle
                cx={x}
                cy={py(t.defense)}
                r={mine ? 7 : 5.5}
                fill={COLOR[t.key]}
                stroke={mine ? "var(--team)" : "var(--panel)"}
                strokeWidth={mine ? 2.5 : 1}
              />
              <text x={x} y={py(t.defense) - (t.k % 2 === 0 ? 8 : -15)} textAnchor="middle" fontSize={8.5} fill={mine ? "var(--team)" : "var(--ink-faint)"} fontWeight={mine ? 700 : 400}>
                {TEAMS_BY_CODE[t.code]?.abbr ?? t.code}
              </text>
            </g>
          );
        })}
      </svg>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10, marginTop: 12 }}>
        {groups.map((g) => (
          <div key={g.key} style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "8px 10px", background: "var(--panel-sunken)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: 5, background: COLOR[g.key], display: "inline-block", flexShrink: 0 }} />
              <strong style={{ fontSize: 12.5 }}>{NAME(g.key)}</strong>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-faint)" }}>
                {g.teams.length} · avg {g.average}
              </span>
            </div>
            {g.signature.length > 0 && (
              <p style={{ margin: "3px 0 0", fontSize: 10.5, color: "var(--ink-dim)" }}>
                Built stronger: {g.signature.map((x) => `${UNIT_LABEL[x.unit]} +${x.delta}`).join(", ")}
              </p>
            )}
            <div style={{ marginTop: 5, display: "grid", gap: 2 }}>
              {g.teams.map((t) => (
                <div key={t.code} style={{ display: "flex", gap: 6, fontSize: 11.5, color: t.code === code ? "var(--team)" : "var(--ink-dim)", fontWeight: t.code === code ? 700 : 400 }}>
                  <span style={{ width: 16, textAlign: "right", color: "var(--ink-faint)" }}>{t.groupRank}</span>
                  <span style={{ width: 34 }}>{TEAMS_BY_CODE[t.code]?.abbr ?? t.code}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.gm}</span>
                  <span className="oswald" style={{ width: 24, textAlign: "right" }}>
                    {t.overall}
                  </span>
                  <span style={{ width: 34, textAlign: "right", color: "var(--ink-faint)" }}>{ordinal(t.overallRank)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
