import { Link, useNavigate } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { isOnline } from "@/state/online";
import { DIVISIONS, TEAMS_BY_CODE, teamFullName } from "@/data/teams";
import type { DeadlineChoice, Difficulty, RandomEventRate, TeamMeta } from "@/domain";
import { STAGE_HOME, STAGE_LABEL } from "@/state/stageMachine";
import { useStore } from "@/state/store";

const DEADLINES: DeadlineChoice[] = [2, 6, 12, 24, 48];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function LeagueSetup() {
  const nav = useNavigate();
  const { active, setActive } = useTabs("lobby");

  const stage = useStore((s) => s.stage);
  const config = useStore((s) => s.config);
  const gms = useStore((s) => s.gms);
  const teams = useStore((s) => s.teams);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const setConfig = useStore((s) => s.setConfig);
  const pickTeam = useStore((s) => s.pickTeam);

  // Once the league has started, this screen is a read-only summary: switching
  // teams or rules mid-dynasty would corrupt the season in progress.
  const locked = stage !== "setup";
  // the same screen serves both modes, and almost every sentence on it means
  // something different depending on which one you are in
  const online = isOnline();

  const viewer = gms.find((g) => g.id === viewerGmId)!;
  const humans = gms.filter((g) => g.isHuman);
  const takenBy = new Map<string, string>();
  for (const code of Object.keys(teams)) {
    const c = teams[code]!.controlledBy;
    if (c.kind === "human") takenBy.set(code, c.gmId);
  }
  const myMeta = viewer.teamCode ? TEAMS_BY_CODE[viewer.teamCode] : undefined;

  return (
    <Card maxWidth={940}>
      <CardHeader
        badge={myMeta ? myMeta.abbr : "GM"}
        title="League Setup"
        subtitle={
          locked
            ? `${STAGE_LABEL[stage]} · team and rules are locked while the league is running`
            : `New Dynasty · ${config.humanGmCount} Human GMs`
        }
      />

      <Ticker
        stats={[
          { label: "Human GMs", value: `${humans.filter((g) => g.teamCode).length} / ${config.humanGmCount}` },
          { label: "Your team", value: myMeta ? myMeta.name : "Not selected", className: myMeta ? "accent sm" : "sm" },
          { label: "Fantasy draft", value: config.fantasyDraft ? "On" : "Off", className: "sm" },
          { label: "Draft type", value: config.fantasyDraft ? cap(config.draftType) : "N/A", className: "sm" },
          { label: "Difficulty", value: cap(config.difficulty), className: "sm" },
        ]}
      />

      <Tabs
        tabs={[
          { id: "lobby", label: locked ? "League" : "Lobby" },
          { id: "settings", label: "League Settings" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="lobby" open={active === "lobby"}>
        {/* The single most common way to land here confused: this screen and
            the online one both say "GM" and both have a headcount, and only
            one of them lets another person actually sit down. Say so before
            anyone spends ten minutes configuring slots nobody can join. */}
        {!locked && !online && (
          <div className="notice">
            <strong>This is a solo dynasty.</strong> Every GM below runs on
            this device — the slot count is flavor for scoring, not an
            invitation. For real people to join over an invite code, start a
            league from <Link to="/online">Online Leagues</Link> instead.
          </div>
        )}
        {!locked && online && (
          <div className="notice">
            <strong>This is an online league.</strong> The GMs below are real
            people, and the league starts when every seat is taken — the
            readiness panel at the bottom says who is still missing.
          </div>
        )}
        <FranchiseBanner meta={myMeta} locked={locked} />

        <p className="sectionlabel">GM lobby</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, marginBottom: 6 }}>
          {humans.map((g) => {
            const meta = g.teamCode ? TEAMS_BY_CODE[g.teamCode] : undefined;
            const you = g.id === viewerGmId;
            return (
              <div
                key={g.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 11px",
                  background: "var(--panel-sunken)",
                  border: `1px solid ${you && meta ? "color-mix(in srgb, var(--team) 35%, transparent)" : "var(--line)"}`,
                  borderRadius: "var(--r-sm)",
                }}
              >
                {meta ? (
                  <TeamBadge code={meta.code} size={30} />
                ) : (
                  <span
                    className="oswald"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: "var(--panel-raised)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--ink-faint)",
                      flexShrink: 0,
                    }}
                  >
                    {(you ? "You" : g.name).charAt(0)}
                  </span>
                )}
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{you ? "You" : g.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: meta ? "var(--ink-dim)" : "var(--ink-faint)" }}>
                    {meta ? teamFullName(meta.code) : "Selecting…"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {!locked && (
          <>
            <p className="sectionlabel" style={{ marginTop: 22 }}>
              Select your team
            </p>
            <div className="conf-grid">
              {(["AFC", "NFC"] as const).map((conf) => (
                <div key={conf}>
                  <p className="subhead" style={{ marginTop: 0 }}>
                    {conf}
                  </p>
                  {DIVISIONS.filter((d) => d.conference === conf).map((d) => (
                    <div key={d.division} style={{ marginBottom: 14 }}>
                      <p style={{ margin: "0 0 6px", fontSize: 10.5, color: "var(--ink-faint)", fontWeight: 500 }}>
                        {conf} {d.division}
                      </p>
                      <div className="split-2" style={{ gap: 8 }}>
                        {d.teams.map((t) => {
                          const owner = takenBy.get(t.code);
                          const mine = owner === viewerGmId;
                          const otherTaken = !!owner && owner !== viewerGmId;
                          return (
                            <button
                              key={t.code}
                              type="button"
                              className={`team-tile${mine ? " mine" : ""}`}
                              disabled={otherTaken}
                              aria-pressed={mine}
                              onClick={() => pickTeam(viewerGmId, t.code)}
                            >
                              <TeamBadge code={t.code} size={30} />
                              <span style={{ minWidth: 0 }}>
                                <span className="tile-name">
                                  {t.city} <span>{t.name}</span>
                                </span>
                                <span className="tile-status">
                                  {mine ? "Your team" : otherTaken ? `Taken · ${gmName(gms, owner)}` : "Available"}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>

      <Panel id="settings" open={active === "settings"}>
        {locked && (
          <p style={{ margin: "0 0 14px", fontSize: 11.5, color: "var(--ink-faint)" }}>
            Rules are shown for reference — they can't change once the league is underway. Start a new league from the sidebar
            to play with different settings.
          </p>
        )}
        <SettingRow
          label="Human GM slots"
          hint={
            <>
              Simulated opponents on this device, not real people — this
              count doesn't create seats anyone else can join. For that,
              start a league from <Link to="/online">Online Leagues</Link>{" "}
              instead.
            </>
          }
        >
          <select
            value={config.humanGmCount}
            disabled={locked}
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
            disabled={locked}
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
            disabled={locked || !config.fantasyDraft}
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
            disabled={locked || !config.fantasyDraft}
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
            disabled={locked}
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
            disabled={locked}
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
            disabled={locked}
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
            disabled={locked}
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

      {locked ? (
        <Footer>
          <button type="button" className="btnlink btn-primary" onClick={() => nav(STAGE_HOME[stage])}>
            Back to {STAGE_LABEL[stage]}
          </button>
        </Footer>
      ) : (
        <>
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
        </>
      )}
    </Card>
  );
}

/** The "your franchise" moment at the top of the lobby. */
function FranchiseBanner({ meta, locked }: { meta: TeamMeta | undefined; locked: boolean }) {
  if (!meta) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "18px 20px",
          marginBottom: 22,
          background: "var(--panel-sunken)",
          border: "1px dashed var(--line-strong)",
          borderRadius: "var(--r-md)",
        }}
      >
        <span
          className="oswald"
          style={{
            width: 52,
            height: 52,
            borderRadius: 12,
            background: "var(--panel-raised)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 600,
            color: "var(--ink-faint)",
            flexShrink: 0,
          }}
        >
          ?
        </span>
        <div>
          <p style={{ margin: 0, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", fontWeight: 600 }}>
            Your franchise
          </p>
          <p className="oswald" style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 600 }}>
            Choose a team below
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-dim)" }}>
            Every GM builds from the same player pool in the fantasy draft — pick the colors you want to wear.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "18px 20px",
        marginBottom: 22,
        background: "linear-gradient(120deg, color-mix(in srgb, var(--team) 16%, var(--panel-sunken)), var(--panel-sunken) 72%)",
        border: "1px solid color-mix(in srgb, var(--team) 35%, transparent)",
        borderRadius: "var(--r-md)",
      }}
    >
      <TeamBadge code={meta.code} size={52} />
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--team)", fontWeight: 600 }}>
          Your franchise
        </p>
        <p className="oswald" style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>
          {meta.city} {meta.name}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-dim)" }}>
          {meta.conference} {meta.division}
          {locked ? "" : " · you can still switch teams until the league starts"}
        </p>
      </div>
    </div>
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
  hint: React.ReactNode;
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
