import { ManualPicksInput } from "@/components/ManualPicksInput";
import { CopyButton, inviteLink } from "@/components/CopyButton";
import { useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { isOnline, onlineSession } from "@/state/online";
import { useLeagueActions } from "@/state/useLeagueActions";
import { DIVISIONS, TEAMS_BY_CODE, teamFullName } from "@/data/teams";
import type { Difficulty, LeagueConfig, TeamMeta } from "@/domain";
import {
  formatOf,
  humansOnlyLeagueSize,
  playoffFieldSize,
  seasonShapeFor,
} from "@/state/leagueFormat";
import { currentScreen, STAGE_LABEL } from "@/state/stageMachine";
import { stepOf } from "@/state/reveal";
import { TALENT_IMPACT_HINT, TALENT_IMPACT_LABEL, type TalentImpact } from "@/state/talentImpact";
import { useStore } from "@/state/store";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function LeagueSetup() {
  const nav = useNavigate();
  const { active, setActive } = useTabs("lobby");

  const stage = useStore((s) => s.stage);
  const step = useStore((s) => stepOf(s, s.viewerGmId));
  const config = useStore((s) => s.config);
  const humansOnly = formatOf(config) === "humansOnly";
  const leagueSize = humansOnlyLeagueSize(config.humanGmCount);
  const seasonGames = seasonShapeFor("humansOnly", leagueSize).regularSeasonWeeks;
  const gms = useStore((s) => s.gms);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const actions = useLeagueActions();
  // online these are the league's settings, saved by the commissioner on the
  // server; the local store alone changed only this viewer's copy
  const [configError, setConfigError] = useState<string | null>(null);
  const setConfig = (patch: Partial<LeagueConfig>): void => {
    setConfigError(null);
    void actions.setConfig(patch).then((res) => {
      if (!res.ok) setConfigError(res.reason ?? "That setting didn't save.");
    });
  };
  const pickTeam = useStore((s) => s.pickTeam);

  // Once the league has started, this screen is a read-only summary: switching
  // teams or rules mid-dynasty would corrupt the season in progress.
  const locked = stage !== "setup";
  // the same screen serves both modes, and almost every sentence on it means
  // something different depending on which one you are in
  const online = isOnline();
  const commissioner = onlineSession()?.isCommissioner ?? false;
  // everyone sees the settings; only the commissioner changes them online
  const settingsLocked = locked || (online && !commissioner);

  const viewer = gms.find((g) => g.id === viewerGmId)!;
  /**
   * Everyone with a seat at this league, whether or not they are a person.
   *
   * Solo, the rival GM slots are named AI opponents holding real teams —
   * they are not human, because nothing is going to take their turns, but
   * they are still the franchises you are scored against and the lobby is
   * where you meet them. Filtering this list on `isHuman` left a solo
   * dynasty showing a lobby of one and every rival's team marked
   * "Available". Online it is unchanged: an unclaimed slot has no team and
   * is not human, so it stays out of here and `LeagueRoster` shows the
   * empty seats instead.
   */
  const lobby = gms.filter((g) => g.isHuman || g.teamCode);
  const takenBy = new Map<string, string>();
  for (const g of gms) {
    if (g.teamCode) takenBy.set(g.teamCode, g.id);
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
            : // an online league has a name; "New Dynasty" is the solo game's
              `${online ? (onlineSession()?.leagueName ?? "Online league") : "New Dynasty"} · ${config.humanGmCount} ${online ? "Human GMs" : "GMs"}`
        }
      />

      <Ticker
        stats={[
          // solo, the other seats are AI rivals rather than people, so
          // counting "human GMs" there reported 1 of 3 for a full league
          {
            label: online ? "Human GMs" : "GMs",
            value: `${lobby.filter((g) => g.teamCode).length} / ${config.humanGmCount}`,
          },
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
            people.{" "}
            {lobby.filter((g) => g.teamCode).length < config.humanGmCount
              ? "The league starts when every seat is taken and everyone has checked in — the readiness panel at the bottom says who is still missing."
              : "Every seat is taken; the league starts once everyone checks in at the bottom."}
            {/* the screen a commissioner waits on while people join: the code
                they need to send was only on the lobby */}
            {/* only while someone can still use it, as on the lobby */}
            {commissioner && onlineSession()?.inviteCode && lobby.filter((g) => g.teamCode).length < config.humanGmCount && (
              <>
                {" "}Invite code:{" "}
                <span className="oswald" style={{ letterSpacing: "0.08em" }}>
                  {onlineSession()!.inviteCode}
                </span>{" "}
                <CopyButton text={onlineSession()!.inviteCode!} /> ·{" "}
                <CopyButton text={inviteLink(onlineSession()!.inviteCode!)} label="Copy invite link" />
              </>
            )}
          </div>
        )}
        <FranchiseBanner meta={myMeta} locked={locked} humansOnly={formatOf(config) === "humansOnly"} />

        <p className="sectionlabel">GM lobby</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, marginBottom: 6 }}>
          {lobby.map((g) => {
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
                              // the badge, name and status ran together as "BALBaltimore RavensAvailable"
                              aria-label={`${t.city} ${t.name} — ${mine ? "your team" : otherTaken ? `taken by ${gmName(gms, owner)}` : "available"}`}
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
        {online && !locked && !commissioner && (
          <div className="notice" role="status" style={{ marginBottom: 14 }}>
            Only the commissioner can change these. They&rsquo;re shown so everyone knows the rules.
          </div>
        )}
        {configError && (
          <div className="notice bad" role="status" style={{ marginBottom: 14 }}>
            {configError}
          </div>
        )}
        {locked && (
          <p style={{ margin: "0 0 14px", fontSize: 11.5, color: "var(--ink-faint)" }}>
            Rules are shown for reference — they can&rsquo;t change once the league is underway.{" "}
            {online
              ? "For different rules, start another league from Online Leagues."
              : "Start a new league from the sidebar to play with different settings."}
          </p>
        )}
        <SettingRow
          label="League format"
          hint={
            humansOnly
              ? `Just the GMs' teams — ${leagueSize} teams (${config.humanGmCount} GM${config.humanGmCount === 1 ? "" : "s"} + ${leagueSize - config.humanGmCount} CPU), a round robin of ${seasonGames} games alternating home and away, and a playoff for the top ${playoffFieldSize(leagueSize)}. The other NFL franchises don't exist in this league.`
              : "All 32 NFL franchises, real divisions, a 17-game schedule and the 14-team playoff."
          }
        >
          <select
            value={config.leagueFormat ?? "nfl"}
            disabled={settingsLocked}
            onChange={(e) => {
              const leagueFormat = e.target.value as "nfl" | "humansOnly";
              // the NFL format's GM range is narrower; pull the count back into it
              const humanGmCount =
                leagueFormat === "nfl" ? Math.min(6, Math.max(2, config.humanGmCount)) : config.humanGmCount;
              setConfig({ leagueFormat, humanGmCount, ...(leagueFormat === "humansOnly" ? { fantasyDraft: true } : {}) });
            }}
          >
            <option value="nfl">Full NFL (32 teams)</option>
            <option value="humansOnly">Human GMs only (round robin)</option>
          </select>
        </SettingRow>
        <SettingRow
          label="Human GM slots"
          hint={
            online ? (
              // the solo explanation ("simulated opponents on this device")
              // was shown in online leagues, whose GMs are real people
              "The seats real people hold in this league — fixed when it was created."
            ) : (
              <>
                Simulated opponents on this device, not real people — this
                count doesn't create seats anyone else can join. For that,
                start a league from <Link to="/online">Online Leagues</Link>{" "}
                instead.
              </>
            )
          }
        >
          <select
            value={config.humanGmCount}
            // online the seats were fixed when the league was created
            disabled={settingsLocked || online}
            onChange={(e) => setConfig({ humanGmCount: Number(e.target.value) })}
          >
            {(humansOnly ? [1, 2, 3, 4, 5, 6, 7, 8] : [2, 3, 4, 5, 6]).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "GM" : "GMs"}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label="Fantasy draft"
          hint={
            humansOnly
              ? "Always on in a humans-only league — there are no NFL rosters to inherit, so every team is drafted from the full player pool."
              : "When off, every team starts with its real current NFL roster instead of drafting the full player pool."
          }
        >
          <select
            value={config.fantasyDraft ? "on" : "off"}
            disabled={settingsLocked || humansOnly}
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
            disabled={settingsLocked || !config.fantasyDraft}
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
            disabled={settingsLocked || !config.fantasyDraft}
            onChange={(e) => setConfig({ draftType: e.target.value as "snake" | "linear" })}
          >
            <option value="linear">Linear</option>
            <option value="snake">Snake</option>
          </select>
        </SettingRow>
        <SettingRow
          label="Manual picks each"
          hint="How many picks every GM makes by hand, from 1 to 53. Once the last GM reaches it, the draft carries on by itself until every team has a full 53-man roster."
        >
          <ManualPicksInput
            value={config.draftSimulateAfterPicks ?? 5}
            disabled={settingsLocked || !config.fantasyDraft}
            onChange={(n) => setConfig({ draftSimulateAfterPicks: n })}
          />
        </SettingRow>
        <SettingRow
          label="Talent impact"
          hint={TALENT_IMPACT_HINT[config.talentImpact ?? "realistic"]}
        >
          <select
            value={config.talentImpact ?? "realistic"}
            disabled={settingsLocked}
            onChange={(e) => setConfig({ talentImpact: e.target.value as TalentImpact })}
          >
            {(["realistic", "amplified", "extreme"] as const).map((v) => (
              <option key={v} value={v}>
                {TALENT_IMPACT_LABEL[v]}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label="AI Difficulty"
          hint="How competently CPU GMs make decisions — never a rules, rating, or cap change."
        >
          <select
            value={config.difficulty}
            disabled={settingsLocked}
            onChange={(e) => setConfig({ difficulty: e.target.value as Difficulty })}
          >
            {(["casual", "standard", "competitive", "expert", "master"] as const).map((d) => (
              <option key={d} value={d}>
                {cap(d)}
              </option>
            ))}
          </select>
        </SettingRow>

        {/* it described the old timed "live event"; the market runs in rounds now */}
        <SettingRow
          label="Free agency"
          hint="Five rounds, one offer or pass per team each round — the weakest roster acts last and sees every bid first. Offers are binding; nothing signs until a round closes."
        >
          <span className="pill">5 rounds</span>
        </SettingRow>
        <SettingRow
          label="League trade vote"
          hint={
            online
              ? "A trade between two GMs that involves a 90+ overall player is blocked if the league's value chart reads it as a fleecing either way."
              : "Trades involving a 90+ overall player and a human GM require a majority vote. Ties are blocked."
          }
        >
          <span className="pill">Always on</span>
        </SettingRow>
      </Panel>

      {locked ? (
        <Footer>
          <button type="button" className="btnlink btn-primary" onClick={() => nav("/")}>
            Back to {currentScreen(stage, step).label}
          </button>
        </Footer>
      ) : (
        <>
          <Footer>
            <span style={{ flex: 1, fontSize: 11, color: "var(--ink-faint)", alignSelf: "center" }}>
              {config.fantasyDraft
                ? "The fantasy draft begins once every GM is ready."
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
function FranchiseBanner({
  meta,
  locked,
  humansOnly,
}: {
  meta: TeamMeta | undefined;
  locked: boolean;
  humansOnly: boolean;
}) {
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
          {/* a humans-only league has no conferences or divisions */}
          {humansOnly ? "Humans-only league" : `${meta.conference} ${meta.division}`}
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
  // the title beside each select was plain text: an unnamed dropdown
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${id}-l`}
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
        <p id={`${id}-l`} style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{label}</p>
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
