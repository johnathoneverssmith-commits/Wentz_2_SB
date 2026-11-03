import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cue } from "@/audio/cues";
import { type Moment, ScoreMoment } from "@/motion/ScoreMoment";
import { EASE, useMotion } from "@/motion/tokens";
import { useNavigate } from "react-router-dom";

import { Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { GmIdentityPicker } from "@/components/GmIdentity";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "./season-end-gameday.css";
import { aiMovesOf, aiSecurity } from "@/state/aiGms";
import { AI_STRATEGY_IDENTITY } from "@/state/aiStrategy";
import { FIRE_BELOW, type HotSeatEntry, type SecurityLevel } from "@/state/hotSeat";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";

const LEVEL: Record<SecurityLevel, { label: string; color: string; blurb: string }> = {
  secure: { label: "Secure", color: "var(--good)", blurb: "The front office is happy." },
  warm: { label: "Warm", color: "var(--notice)", blurb: "Results are being noticed." },
  hot: { label: "On the hot seat", color: "var(--bad)", blurb: "One more bad year could cost the job." },
  fired: { label: "Fired", color: "var(--bad)", blurb: "The owner has made a change." },
};

const label = (code: string) => TEAMS_BY_CODE[code]?.label ?? code;

/**
 * The same review for the CPU GMs: who the owners let go, who they hired and
 * what that GM builds, and which CPU GMs are on the hot seat going into next year.
 */
function CpuGmMoves() {
  const s = useStore();
  const moves = aiMovesOf(s, s.season);
  const fired = moves.filter((m) => m.kind === "fired");
  const hired = moves.filter((m) => m.kind === "hired");
  const warm = (s.aiGms ?? [])
    .filter((g) => g.teamCode)
    .map((g) => ({ g, sec: aiSecurity(g) }))
    .filter((x) => x.sec && x.sec.level === "hot")
    .sort((a, b) => a.sec!.score - b.sec!.score);
  return (
    <div className="se-moves">
      <p className="sectionlabel">CPU GMs</p>
      {fired.length === 0 ? (
        <p className="se-note">No CPU GM was let go this offseason.</p>
      ) : (
        <div>
          {fired.map((f) => {
            const h = hired.find((x) => x.teamCode === f.teamCode);
            return (
              <div key={f.gmId} className="se-move">
                <strong>{label(f.teamCode)}</strong> let <strong>{f.name}</strong> ({AI_STRATEGY_IDENTITY[f.strategy].label}) go
                {h ? (
                  <>
                    {" "}and hired <strong>{h.name}</strong> ({AI_STRATEGY_IDENTITY[h.strategy].label}).
                  </>
                ) : (
                  "."
                )}
              </div>
            );
          })}
        </div>
      )}
      {warm.length > 0 && (
        <p className="se-note se-warm">
          On the hot seat: {warm.map((x) => `${x.g.name} (${TEAMS_BY_CODE[x.g.teamCode!]?.abbr ?? x.g.teamCode}, ${x.sec!.score})`).join(", ")}.
        </p>
      )}
    </div>
  );
}

/** The 0–100 meter, with the firing line marked. */
function Meter({ score, color }: { score: number; color: string }) {
  const motion = useMotion();
  return (
    <div role="img" aria-label={`Job security ${score} out of 100`} className="se-meter">
      <m.div
        initial={{ width: motion.off ? `${score}%` : "0%" }}
        animate={{ width: `${score}%` }}
        transition={{ duration: motion.full ? 0.9 : 0.25, ease: EASE, delay: motion.full ? 0.15 : 0 }}
        className="se-meter__fill"
        style={{ background: color }}
      />
      <div title={`Fired below ${FIRE_BELOW}`} className="se-meter__line" style={{ left: `${FIRE_BELOW}%` }} />
    </div>
  );
}

function Seasons({ e }: { e: HotSeatEntry }) {
  return (
    <div className="se-seasons">
      {e.seasons.map((x) => (
        <div key={x.season} className="se-season">
          <strong>{x.season}</strong>
          <span className="se-season__rec">
            {x.wins}-{x.losses}
            {x.ties ? `-${x.ties}` : ""}
          </span>
          <span>
            {x.champion ? "Champions" : x.playoffs ? (x.roundsWon > 0 ? `Playoffs, won ${x.roundsWon} round${x.roundsWon === 1 ? "" : "s"}` : "Playoffs") : "Missed the playoffs"}
          </span>
          <span className="se-season__delta" style={{ color: x.delta >= 0 ? "var(--good)" : "var(--bad)" }}>
            {x.delta >= 0 ? "+" : ""}
            {x.delta.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function HotSeat() {
  const motion = useMotion();
  const nav = useNavigate();
  const s = useStore();
  const actions = useLeagueActions();
  const { active, setActive } = useTabs("yours");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // made once per season when the stage opens; a league that arrives without
  // one (a reload, an older save) builds it from the same history
  const hot = s.hotSeat?.season === s.season ? s.hotSeat : null;
  const me = s.gms.find((g) => g.id === s.viewerGmId);
  const mine = hot?.entries.find((e) => e.gmId === s.viewerGmId);
  const others = (hot?.entries ?? []).filter((e) => e.gmId !== s.viewerGmId);
  if (!hot) {
    return (
      <GdPage code={me?.teamCode}>
        <GameDayMasthead
          code={me?.teamCode ?? ""}
          compact
          title="Offseason"
          heading="Hot seat"
          sub="The owners review each GM's seasons."
        />
        <div className="emptystate">The owners are still reviewing the season.</div>
      </GdPage>
    );
  }

  const waiting = mine?.level === "fired" && !mine.chosen;

  // taking a new job is an occasion: the new team's colours take over
  const [moment, setMoment] = useState<Moment | null>(null);
  const hadJob = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const now = mine?.chosen ?? null;
    if (hadJob.current !== undefined && now && now !== hadJob.current) {
      const t = TEAMS_BY_CODE[now];
      setMoment({ key: now, color: t?.color ?? "#444", label: t?.city ?? now, sub: "Your new team", from: "right" });
      cue("newJob");
    }
    hadJob.current = now;
  }, [mine?.chosen]);

  return (
    <GdPage code={me?.teamCode} className="gd-tabbed se">
      <ScoreMoment moment={moment} onDone={() => setMoment(null)} />
      <GameDayMasthead
        code={me?.teamCode ?? ""}
        compact
        title={`Offseason · ${s.season} season review`}
        heading="Hot seat"
        sub="The owners' verdict on the season, for you and for every GM in the league."
      />
      <Ticker
        stats={[
          { label: "Your job security", value: mine ? `${mine.score}` : "—", className: mine?.level === "secure" ? "good" : mine?.level ? "bad" : undefined },
          { label: "Status", value: mine ? LEVEL[mine.level].label : "—", className: "sm" },
          { label: "Seasons here", value: mine?.tenure ?? "—" },
          { label: "GMs on the hot seat", value: (hot?.entries ?? []).filter((e) => e.level === "hot" || e.level === "fired").length },
        ]}
      />
      <div className="gd-hub">
        <Tabs
          tabs={[
            { id: "yours", label: "Your job" },
            { id: "league", label: "Around the league" },
            { id: "how", label: "Methodology" },
          ]}
          active={active}
          onChange={setActive}
        />
      </div>

      <Panel id="yours" open={active === "yours"}>
        {!mine ? (
          <div className="emptystate">You don&rsquo;t have a job to review.</div>
        ) : (
          <>
            {/* the verdict lands like a stamp: big, then home */}
            <m.p
              key={mine.level}
              className="se-verdict"
              initial={motion.off ? false : { opacity: 0, scale: motion.full ? 2.2 : 1, rotate: motion.full ? -6 : 0 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ duration: motion.full ? 0.5 : 0.15, ease: [0.2, 1.2, 0.3, 1] }}
              style={{ color: LEVEL[mine.level].color }}
            >
              {LEVEL[mine.level].label}
            </m.p>
            <p className="se-note se-lede">
              {mine.level === "fired"
                ? `After ${mine.tenure} seasons running ${label(mine.teamCode)}, the owner is going in a different direction.`
                : `${LEVEL[mine.level].blurb} ${mine.tenure < 3 ? "You have less than three seasons with this team, so you can't be fired yet." : ""}`}
            </p>
            <Meter score={mine.score} color={LEVEL[mine.level].color} />
            <Seasons e={mine} />
            {mine.droughtPenalty > 0 && (
              <p className="se-note bad se-gap">
                {mine.drought} seasons without winning a playoff game: −{mine.droughtPenalty}. It gets worse every
                year it continues.
              </p>
            )}
            {mine.drought === 2 && mine.tenure >= 2 && (
              <p className="se-note se-gap">Two seasons without a playoff win. A third starts to cost you.</p>
            )}

            {mine.level === "fired" && (
              <div className="se-gap">
                <p className="sectionlabel">{mine.chosen ? "Your new job" : "Teams that want you"}</p>
                {mine.chosen ? (
                  <p className="se-note">
                    You&rsquo;re the new GM of <strong>{label(mine.chosen)}</strong>. Your clock starts over.
                  </p>
                ) : (
                  <div className="se-jobs">
                    {mine.options.map((code) => {
                      const t = s.teams[code]!;
                      const taken = t.controlledBy.kind !== "ai";
                      return (
                        <div key={code} className="se-job">
                          <strong>{label(code)}</strong>
                          <span>
                            {t.wins}-{t.losses}
                            {t.ties ? `-${t.ties}` : ""} · roster #{t.ratings.overallRank} of {Object.keys(s.teams).length}
                          </span>
                          <button
                            type="button"
                            className="gd-btn gd-go"
                            disabled={busy !== null || taken}
                            onClick={() => {
                              setBusy(code);
                              setError(null);
                              void actions
                                .chooseNewJob(code)
                                .then((r) => {
                                  if (!r.ok) setError(r.reason ?? "Couldn't take that job.");
                                })
                                .finally(() => setBusy(null));
                            }}
                          >
                            {taken ? "Taken" : busy === code ? "Signing…" : "Take the job"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {error && <p className="form-error se-note bad">{error}</p>}
              </div>
            )}
          </>
        )}
        {me && (
          <div className="se-gmidentity">
            <GmIdentityPicker value={me.strategy ?? "balanced"} onChange={(k) => void actions.setStrategy(k)} />
          </div>
        )}
      </Panel>

      <Panel id="league" open={active === "league"}>
        <CpuGmMoves />
        {others.length === 0 ? (
          <div className="emptystate">You&rsquo;re the only person running a team here.</div>
        ) : (
          others.map((e) => (
            <div key={e.gmId} className="se-gm">
              <span className="se-gm__name">
                {s.gms.find((g) => g.id === e.gmId)?.name ?? e.gmId}
                <span className="se-gm__team">
                  {label(e.chosen ? e.teamCode : e.teamCode)}
                  {e.chosen ? ` (was ${label(e.teamCode)})` : ""}
                </span>
              </span>
              <span className="se-gm__level" style={{ color: LEVEL[e.level].color }}>
                {e.chosen ? `Fired, now at ${label(e.chosen)}` : LEVEL[e.level].label}
              </span>
              <Meter score={e.score} color={LEVEL[e.level].color} />
            </div>
          ))
        )}
      </Panel>

      <Panel id="how" open={active === "how"}>
        <div className="se-how">
          <p>
            Your job security is a score out of 100, built from your last five seasons with your current team:
            wins above or below .500, making or missing the playoffs, and playoff rounds won, with a bonus for a title.
            You start at 60.
          </p>
          <p>
            Secure is 55 or more, warm is 40–54, and the hot seat is 20–39. Below 20 you&rsquo;re fired, but never before
            your third season with a team. A long run of good years is a cushion.
          </p>
          <p>
            From your third season, a stretch with no playoff win costs more every year (−10 for the third winless
            season, −20 for the fourth, −30 for the fifth). Making the playoffs and losing the first game doesn&rsquo;t
            end the drought; winning one does.
          </p>
          <p>
            A fired GM takes over one of the five worst teams in the league that no one else is running, and starts again:
            the old team goes to the CPU.
          </p>
        </div>
      </Panel>

      <ReadinessGate
        title="Hot seat readiness"
        onAdvance={(r) => nav(r)}
        disabled={waiting}
        disabledHint="Choose a new team first."
      />
    </GdPage>
  );
}
