import type { LeagueProfile } from "@/domain";

/**
 * The broad scouting read on a league or a draft class: a title, a few words
 * on what is deep and what is thin. Qualitative on purpose — no ratings, no
 * counts, no advice on how to draft.
 */
export function ScoutingBrief({ profile, kind }: { profile: LeagueProfile | undefined; kind: "league" | "class" }) {
  if (!profile) return null;
  return (
    <section
      aria-label={kind === "league" ? "League profile" : "Draft class scouting"}
      data-testid="scouting-brief"
      style={{ margin: "0 26px 12px", padding: "10px 14px", border: "1px solid var(--line-strong)", borderRadius: 8 }}
    >
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-faint)" }}>
        {kind === "league" ? `League Profile: ${profile.title}` : `Scouting Report: ${profile.title}`}
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45 }}>{profile.blurb}</p>
    </section>
  );
}
