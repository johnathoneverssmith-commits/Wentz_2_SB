import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS, teamFullName } from "@/data/teams";
import type { DeadlineChoice, Difficulty, RandomEventRate } from "@/domain";
import { useStore } from "@/state/store";

const DEADLINES: DeadlineChoice[] = [2, 6, 12, 24, 48];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function LeagueSetup() {
  const nav = useNavigate();
  const { active, setActive } = useTabs("lobby");

  const config = useStore((s) => s.config);
  const gms = useStore((s) => s.gms);
  const teams = useStore((s) => s.teams);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const setConfig = useStore((s) => s.setConfig);
  const pickTeam = useStore((s) => s.pickTeam);

  const viewer = gms.find((g) => g.id === viewerGmId)!;
  const humans = gms.filter((g) => g.isHuman);
  const takenBy = new Map<string, string>();
  for (const code of Object.keys(teams)) {
    const c = teams[code]!.controlledBy;
    if (c.kind === "human") takenBy.set(code, c.gmId);
  }

  return (
    <Card maxWidth={820}>
      <CardHeader
        badge="GM"
        title="League Setup"
        subtitle={`New Dynasty · ${config.humanGmCount} Human GMs`}
      />

      <Ticker
        stats={[
          { label: "Human GMs", value: `${humans.filter((g) => g.teamCode).length} / ${config.humanGmCount}` },
          { label: "Team", value: viewer.teamCode ? teamFullName(viewer.teamCode) : "Not selected", className: "sm" },
          { label: "Fantasy draft", value: config.fantasyDraft ? "On" : "Off", className: "sm" },
          { label: "Draft type", value: config.fantasyDraft ? cap(config.draftType) : "N/A", className: "sm" },
          { label: "Difficulty", value: cap(config.difficulty), className: "sm" },
        ]}
      />

      <Tabs
        tabs={[
          { id: "lobby", label: "Lobby" },
          { id: "settings", label: "League Settings" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel open={active === "lobby"}>
        <p className="sectionlabel">GM lobby</p>
        {humans.map((g) => (
          <div className="gmrow" key={g.id} style={{ justifyContent: "space-between" }}>
            <div className="who" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: "var(--panel-raised)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ink-dim)",
                }}
              >
                {(g.id === viewerGmId ? "You" : g.name).charAt(0)}
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 500 }}>
                  {g.id === viewerGmId ? "You" : g.name}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--ink-faint)" }}>
                  {g.teamCode ? teamFullName(g.teamCode) : "Selecting…"}
                </p>
              </div>
            </div>
          </div>
        ))}

        <p className="sectionlabel" style={{ marginTop: 22 }}>
          Select your team
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
            marginTop: 6,
          }}
        >
          {TEAMS.map((t) => {
            const owner = takenBy.get(t.code);
            const mine = owner === viewerGmId;
            const otherTaken = owner && owner !== viewerGmId;
            return (
              <button
                key={t.code}
                disabled={!!otherTaken}
                onClick={() => pickTeam(viewerGmId, t.code)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  textAlign: "left",
                  borderColor: mine ? "var(--team)" : "var(--line-strong)",
                  background: mine ? "rgba(255,60,0,0.08)" : "var(--panel-sunken)",
                  opacity: otherTaken ? 0.45 : 1,
                }}
              >
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: t.color,
                    color: t.onColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {t.abbr}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 500 }}>{t.city}</span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 10.5,
                      color: mine ? "var(--team)" : "var(--ink-faint)",
                      fontWeight: mine ? 600 : 400,
                    }}
                  >
                    {mine ? "Your team" : otherTaken ? `Taken · ${gmName(gms, owner!)}` : "Available"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel open={active === "settings"}>
        <SettingRow
          label="Human GM slots"
          hint="How many people are drafting a team. Remaining teams are AI-controlled."
        >
          <select
            value={config.humanGmCount}
            onChange={(e) => setConfig({ humanGmCount: Number(e.target.value) })}
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} GMs
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label="Fantasy draft"
          hint="When off, every team starts with its real current NFL roster instead of drafting the full player pool."
        >
          <select
            value={config.fantasyDraft ? "on" : "off"}
            onChange={(e) => setConfig({ fantasyDraft: e.target.value === "on" })}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </SettingRow>
        <SettingRow
          label="Draft order"
          hint="Randomized shuffles the pick order. In Order gives GM 1 the first pick, GM 2 the second, and so on."
        >
          <select
            value={config.draftOrder}
            disabled={!config.fantasyDraft}
            onChange={(e) => setConfig({ draftOrder: e.target.value as "randomized" | "inOrder" })}
          >
            <option value="randomized">Randomized</option>
            <option value="inOrder">In Order</option>
          </select>
        </SettingRow>
        <SettingRow
          label="Draft type"
          hint="Linear keeps the same pick order every round. Snake reverses it each round."
        >
          <select
            value={config.draftType}
            disabled={!config.fantasyDraft}
            onChange={(e) => setConfig({ draftType: e.target.value as "snake" | "linear" })}
          >
            <option value="linear">Linear</option>
            <option value="snake">Snake</option>
          </select>
        </SettingRow>
        <SettingRow
          label="Difficulty"
          hint="How aggressively the AI GMs optimise their roster moves and in-game decisions."
        >
          <select
            value={config.difficulty}
            onChange={(e) => setConfig({ difficulty: e.target.value as Difficulty })}
          >
            {(["easy", "normal", "hard", "impossible"] as const).map((d) => (
              <option key={d} value={d}>
                {cap(d)}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label="Random events"
          hint="How often mid-season storylines fire — holdouts, locker-room drama, surprise breakouts, coaching turmoil."
        >
          <select
            value={config.randomEvents}
            onChange={(e) => setConfig({ randomEvents: e.target.value as RandomEventRate })}
          >
            {(["none", "few", "some", "many"] as const).map((r) => (
              <option key={r} value={r}>
                {cap(r)}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label="Game-day readiness deadline"
          hint="How long the league waits for every GM to click Ready for Game Day before auto-simulating the week."
        >
          <select
            value={config.gameDayDeadlineHours}
            onChange={(e) => setConfig({ gameDayDeadlineHours: Number(e.target.value) as DeadlineChoice })}
          >
            {DEADLINES.map((h) => (
              <option key={h} value={h}>
                {h} hours
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label="Offseason stage deadline"
          hint="Same pattern applied to retirements, roster management, and draft-signing stages."
        >
          <select
            value={config.offseasonStageDeadlineHours}
            onChange={(e) =>
              setConfig({ offseasonStageDeadlineHours: Number(e.target.value) as DeadlineChoice })
            }
          >
            {DEADLINES.map((h) => (
              <option key={h} value={h}>
                {h} hours
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Free agency pace" hint="Live event: each in-game day advances on consensus or when the timer runs out.">
          <span className="pill">5 days · 12 min/day</span>
        </SettingRow>
        <SettingRow
          label="League trade vote"
          hint="Trades involving a 90+ overall player and a human GM require a majority vote. Ties are blocked."
        >
          <span className="pill">Always on</span>
        </SettingRow>
      </Panel>

      <Footer>
        <span style={{ flex: 1, fontSize: 11, color: "var(--ink-faint)", alignSelf: "center" }}>
          {config.fantasyDraft
            ? "Fantasy draft begins once every GM is ready, or after the offseason stage deadline."
            : "Teams keep their real roster. The season begins once every GM is ready."}
        </span>
      </Footer>

      <ReadinessGate
        title={config.fantasyDraft ? "Fantasy draft readiness" : "Season start readiness"}
        disabled={!viewer.teamCode}
        disabledHint="Select a team to continue"
        onAdvance={() => nav("/")}
      />
    </Card>
  );
}

function gmName(gms: { id: string; name: string }[], id: string): string {
  return gms.find((g) => g.id === id)?.name ?? id;
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "13px 0",
        borderBottom: "1px solid var(--line)",
        gap: 14,
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{label}</p>
        <p
          style={{
            margin: "3px 0 0",
            fontSize: 11.5,
            color: "var(--ink-faint)",
            maxWidth: 380,
            lineHeight: 1.4,
          }}
        >
          {hint}
        </p>
      </div>
      {children}
    </div>
  );
}
