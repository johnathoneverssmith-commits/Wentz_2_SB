import type { LeagueState } from "@/domain";

export type SkipKind = "freeAgency" | "tradeDeadline";

/** Whether the human running this team has chosen to sit this stage out. */
export function isSkipping(s: Pick<LeagueState, "gms">, teamCode: string, kind: SkipKind): boolean {
  return s.gms.some((g) => g.isHuman && g.teamCode === teamCode && !!g.skips?.[kind]);
}

/** Every GM back in: each market and each deadline starts with nobody skipping it. */
export function clearSkips(s: Pick<LeagueState, "gms">, kind: SkipKind): void {
  for (const g of s.gms) if (g.skips?.[kind]) g.skips = { ...g.skips, [kind]: false };
}

/** Set or clear one GM's skip. Their team's turns only; nobody else is touched. */
export function setSkip(s: Pick<LeagueState, "gms">, teamCode: string, kind: SkipKind, on: boolean): boolean {
  const gm = s.gms.find((g) => g.isHuman && g.teamCode === teamCode);
  if (!gm) return false;
  gm.skips = { ...gm.skips, [kind]: on };
  return true;
}
