export const BASE_TITLE = "Road to the Super Bowl";

/** "Browns" -> "Browns'", "Bears" -> "Bears'", a name not ending in s -> "'s". */
export function possessive(name: string): string {
  const n = name.trim();
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}

/**
 * Before a team is chosen: "Road to the Super Bowl".
 * After: "The Browns' Road to the Super Bowl". `teamName` is the nickname
 * (TeamMeta.name), never the city.
 */
export function gameTitle(teamName?: string | null): string {
  const n = teamName?.trim();
  return n ? `The ${possessive(n)} ${BASE_TITLE}` : BASE_TITLE;
}
