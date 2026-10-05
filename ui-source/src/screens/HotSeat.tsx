import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cue } from "@/audio/cues";
import { type Moment, ScoreMoment } from "@/motion/ScoreMoment";
import { EASE, useMotion } from "@/motion/tokens";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
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

/** The 0–100 meter, with the firing line marked. */
function Meter({ score, color }: { score: number; color: string }) {
  const motion = useMotion();
  return (
    <div
      role="img"
      aria-label={`Job security ${score} out of 100`}
      style={{ position: "relative", height: 10, borderRadius: 5, background: "var(--panel-sunken)", border: "1px solid var(--line)" }}
    >
      <m.div
        initial={{ width: motion.off ? `${score}%` : "0%" }}
        animate={{ width: `${score}%` }}
        transition={{ duration: motion.full ? 0.9 : 0.25, ease: EASE, delay: motion.full ? 0.15 : 0 }}
        style={{ height: "100%", borderRadius: 5, background: color }}
      />
      <div title={`Fired below ${FIRE_BELOW}`} style={{ position: "absolute", left: `${FIRE_BELOW}%`, top: -3, bottom: -3, width: 2, background: "var(--ink-faint)" }} />
    </div>
  );
}

function Seasons({ e }: { e: HotSeatEntry }) {
  return (
    <div style={{ display: "grid", gap: 2, marginTop: 10 }}>
      {e.seasons.map((x) => (
        <div key={x.season} style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
          <strong style={{ minWidth: 44 }}>{x.season}</strong>
          <span style={{ minWidth: 64 }}>
            {x.wins}-{x.losses}
            {x.ties ? `-${x.ties}` : ""}
          </span>
          <span style={{ flex: 1, color: "var(--ink-dim)" }}>
            {x.champion ? "Champions" : x.playoffs ? (x.roundsWon > 0 ? `Playoffs, won ${x.roundsWon} round${x.roundsWon === 1 ? "" : "s"}` : "Playoffs") : "Missed the playoffs"}
          </span>
          <span style={{ color: x.delta >= 0 ? "var(--good)" : "var(--bad)", fontVariantNumeric: "tabular-nums" }}>
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
      <Card maxWidth={800}>
        <CardHeader badge="FS" title="Hot Seat" subtitle="Offseason" />
        <div className="emptystate">The owners are still reviewing the season.</div>
      </Card>
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
    <Card maxWidth={800}>
      <ScoreMoment moment={moment} onDone={() => setMoment(null)} />
      <CardHeader
        badge={me?.teamCode ? TEAMS_BY_CODE[me.teamCode]?.abbr ?? "FS" : "FS"}
        title="Hot Seat"
        subtitle={`Offseason · ${s.season} season review`}
      />
      <Ticker
        stats={[
          { label: "Your job security", value: mine ? `${mine.score}` : "—", className: mine?.level === "secure" ? "good" : mine?.level ? "bad" : undefined },
          { label: "Status", value: mine ? LEVEL[mine.level].label : "—", className: "sm" },
          { label: "Seasons here", value: mine?.tenure ?? "—" },
          { label: "GMs on the hot seat", value: (hot?.entries ?? []).filter((e) => e.level === "hot" || e.level === "fired").length },
        ]}
      />
      <Tabs
        tabs={[
          { id: "yours", label: "Your job" },
          { id: "league", label: "Around the league" },
          { id: "how", label: "How it works" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="yours" open={active === "yours"}>
        {!mine ? (
          <div className="emptystate">You don&rsquo;t have a job to review.</div>
        ) : (
          <>
            {/* the verdict lands like a stamp: big, then home */}
            <m.p
              key={mine.level}
              initial={motion.off ? false : { opacity: 0, scale: motion.full ? 2.2 : 1, rotate: motion.full ? -6 : 0 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ duration: motion.full ? 0.5 : 0.15, ease: [0.2, 1.2, 0.3, 1] }}
              style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: LEVEL[mine.level].color, transformOrigin: "left center" }}
            >
              {LEVEL[mine.level].label}
            </m.p>
            <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--ink-dim)" }}>
              {mine.level === "fired"
                ? `After ${mine.tenure} seasons running ${label(mine.teamCode)}, the owner is going in a different direction.`
                : `${LEVEL[mine.level].blurb} ${mine.tenure < 3 ? "You have less than three seasons with this team, so you can't be fired yet." : ""}`}
            </p>
            <Meter score={mine.score} color={LEVEL[mine.level].color} />
            <Seasons e={mine} />
            {mine.droughtPenalty > 0 && (
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--bad)" }}>
                {mine.drought} seasons without winning a playoff game: −{mine.droughtPenalty}. It gets worse every
                year it continues.
              </p>
            )}
            {mine.drought === 2 && mine.tenure >= 2 && (
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--ink-faint)" }}>
                Two seasons without a playoff win. A third starts to cost you.
              </p>
            )}

            {mine.level === "fired" && (
              <div style={{ marginTop: 18 }}>
                <p className="sectionlabel" style={{ margin: "0 0 8px" }}>
                  {mine.chosen ? "Your new job" : "Teams that want you"}
                </p>
                {mine.chosen ? (
                  <p style={{ fontSize: 13 }}>
                    You&rsquo;re the new GM of <strong>{label(mine.chosen)}</strong>. Your clock starts over.
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {mine.options.map((code) => {
                      const t = s.teams[code]!;
                      const taken = t.controlledBy.kind !== "ai";
                      return (
                        <div key={code} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
                          <strong style={{ flex: 1 }}>{label(code)}</strong>
                          <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                            {t.wins}-{t.losses}
                            {t.ties ? `-${t.ties}` : ""} · roster #{t.ratings.overallRank} of {Object.keys(s.teams).length}
                          </span>
                          <button
                            type="button"
                            className="btn-primary"
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
                {error && (
                  <p className="form-error" style={{ margin: "8px 0 0", fontSize: 11.5 }}>
                    {error}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel id="league" open={active === "league"}>
        {others.length === 0 ? (
          <div className="emptystate">You&rsquo;re the only GM here.</div>
        ) : (
          others.map((e) => (
            <div key={e.gmId} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <strong>{s.gms.find((g) => g.id === e.gmId)?.name ?? e.gmId}</strong>
                <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>
                  {label(e.chosen ? e.teamCode : e.teamCode)}
                  {e.chosen ? ` (was ${label(e.teamCode)})` : ""}
                </span>
                <span style={{ marginLeft: "auto", color: LEVEL[e.level].color, fontWeight: 700, fontSize: 12.5 }}>
                  {e.chosen ? `Fired, now at ${label(e.chosen)}` : LEVEL[e.level].label}
                </span>
              </div>
              <div style={{ marginTop: 6 }}>
                <Meter score={e.score} color={LEVEL[e.level].color} />
              </div>
            </div>
          ))
        )}
      </Panel>

      <Panel id="how" open={active === "how"}>
        <div style={{ fontSize: 12.5, color: "var(--ink-dim)", lineHeight: 1.6, display: "grid", gap: 8 }}>
          <p style={{ margin: 0 }}>
            Your job security is a score out of 100, built from your last five seasons with your current team:
            wins above or below .500, making or missing the playoffs, and playoff rounds won, with a bonus for a title.
            You start at 60.
          </p>
          <p style={{ margin: 0 }}>
            Secure is 55 or more, warm is 40–54, and the hot seat is 20–39. Below 20 you&rsquo;re fired, but never before
            your third season with a team. A long run of good years is a cushion.
          </p>
          <p style={{ margin: 0 }}>
            From your third season, a stretch with no playoff win costs more every year (−10 for the third winless
            season, −20 for the fourth, −30 for the fifth). Making the playoffs and losing the first game doesn&rsquo;t
            end the drought; winning one does.
          </p>
          <p style={{ margin: 0 }}>
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
    </Card>
  );
}
