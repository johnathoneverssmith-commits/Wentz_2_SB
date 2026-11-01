import { TEAMS } from "@/data/teams";
import { StadiumScene } from "@/visual/StadiumScene";
import { atmosphereName } from "@/visual/atmosphere";

/** Dev-only: every team's stadium at the three atmosphere extremes. */
export function VisualLab() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const only = params.get("team");
  const teams = TEAMS.filter((t) => !only || t.code === only);
  const levels = [1, 0.5, 0];
  return (
    <div style={{ display: "grid", gap: 12, padding: 12 }}>
      <h1>Visual lab</h1>
      {teams.map((t) => (
        <section key={t.code} aria-label={t.label}>
          <h2 style={{ margin: "0 0 4px" }}>{t.label} {t.name}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 8 }}>
            {levels.map((l) => (
              <figure key={l} style={{ margin: 0, aspectRatio: "1600/520", position: "relative", borderRadius: 10, overflow: "hidden" }}>
                <StadiumScene team={t.code} level={l} />
                <figcaption style={{ position: "absolute", left: 8, bottom: 6, background: "#000a", color: "#fff", padding: "2px 8px", borderRadius: 6, fontSize: 12 }}>{atmosphereName(l, l !== 0.5)}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
