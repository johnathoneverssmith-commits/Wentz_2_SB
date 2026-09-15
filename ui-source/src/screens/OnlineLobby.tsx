import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { InboxLeague, OnlineUser } from "@/sim/OnlineLeagueClient";
import { OnlineError, OnlineLeagueClient } from "@/sim/OnlineLeagueClient";
import { goLocal, isOnline, joinLeague, onlineSession } from "@/state/online";
import { STAGE_LABEL } from "@/state/stageMachine";
import { useStore } from "@/state/store";
import type { DeadlineChoice, Difficulty, RandomEventRate, Stage } from "@/domain";

/**
 * The door into an online league.
 *
 * Everything underneath this screen has existed for a while — a server that
 * owns leagues, a client that talks to it, a session module that switches the
 * store's actions over — and none of it was reachable, because there was no
 * way to sign in. This is that way.
 *
 * It is the only screen that talks to the league server directly rather than
 * through the store. That is deliberate: signing in, creating a league and
 * claiming a team all happen *before* there is a league to put in the store,
 * so routing them through it would mean inventing store state for a league
 * you haven't joined.
 *
 * The server is deployed now. Running locally it is `npm run online` on
 * :8788; with nothing answering — a cold host, or no local server — every
 * call fails the same way and the screen says so plainly rather than
 * spinning.
 */
type Mode = "signin" | "register";

const client = new OnlineLeagueClient();

interface LeagueRow {
  id: string;
  name: string;
  teamCode: string | null;
  stage: string;
  season: number;
  isCommissioner: boolean;
  inviteCode: string | null;
}

/** The server hands back the raw stage key; the app has a name for it. */
const stageName = (stage: string): string => STAGE_LABEL[stage as Stage] ?? stage;

export function OnlineLobby() {
  const nav = useNavigate();
  const { active, setActive } = useTabs("leagues");
  const [claiming, setClaiming] = useState<{ leagueId: string; teams: string[] } | null>(null);

  const [user, setUser] = useState<OnlineUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [inbox, setInbox] = useState<InboxLeague[]>([]);

  /** One place to run a call, so every failure reads the same way. */
  const attempt = useCallback(async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      if (err instanceof OnlineError) setError(err.message);
      else {
        // a TypeError from fetch means nothing answered, which is a different
        // problem from the server saying no, and needs different advice
        setOffline(true);
        setError(null);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const mine = await client.myLeagues();
    setLeagues(mine.leagues);
    const box = await client.inbox();
    setInbox(box.leagues);
  }, []);

  /** Ask the server who we are; this is also what "try again" re-runs. */
  const check = useCallback(async () => {
    setChecking(true);
    try {
      const me = await client.me();
      setUser(me.user);
      setOffline(false);
      if (me.user) await refresh();
    } catch {
      setOffline(true);
    } finally {
      setChecking(false);
    }
  }, [refresh]);

  useEffect(() => {
    void check();
  }, [check]);

  const open = (leagueId: string) =>
    attempt(async () => {
      const { state } = await joinLeague(leagueId);
      useStore.setState(state as never);
      nav("/hub");
    });

  if (checking) {
    return (
      <Card maxWidth={720}>
        <CardHeader badge="ON" title="Online Leagues" subtitle="Looking for the league server…" />
        <div className="panel open">
          <div className="emptystate">One moment.</div>
        </div>
      </Card>
    );
  }

  if (offline) {
    return (
      <Card maxWidth={720}>
        <CardHeader badge="ON" title="Online Leagues" subtitle="No league server answered" />
        <div className="panel open">
          <div className="notice bad" role="status">
            <strong>The league server didn't answer.</strong> It sleeps when nobody has used it
            for a while and takes up to a minute to wake — if that's all this is, waiting a moment
            and trying again will fix it.
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink-dim)", lineHeight: 1.6 }}>
            If it keeps failing, the server is genuinely down. Running your own instead: create a
            Postgres database, point <code>DATABASE_URL</code> at it, then{" "}
            <code>npm run online:migrate</code> once and <code>npm run online</code>. Your
            single-player dynasty is untouched either way.
          </p>
        </div>
        <Footer>
          <button type="button" className="btnlink" onClick={() => void check()}>
            Try again
          </button>
          <button type="button" className="btnlink btn-primary" onClick={() => nav("/")}>
            Back to your dynasty
          </button>
        </Footer>
      </Card>
    );
  }

  if (!user) {
    return (
      <SignIn
        busy={busy}
        error={error}
        onDone={async (u) => {
          setUser(u);
          await attempt(refresh);
        }}
        attempt={attempt}
        onBack={() => nav("/")}
      />
    );
  }

  const session = onlineSession();
  const waiting = inbox.reduce((n, l) => n + l.items.length, 0);

  return (
    <Card maxWidth={760}>
      <CardHeader
        badge="ON"
        title="Online Leagues"
        subtitle={`Signed in as ${user.name}`}
        right={
          <button
            type="button"
            className="btnlink"
            onClick={() =>
              void attempt(async () => {
                await client.logout();
                goLocal();
                setUser(null);
                setLeagues([]);
                setInbox([]);
              })
            }
          >
            Sign out
          </button>
        }
      />
      <Ticker
        stats={[
          { label: "Your leagues", value: leagues.length },
          {
            label: "Waiting on you",
            value: waiting,
            className: waiting > 0 ? "bad" : undefined,
          },
          {
            label: "Playing",
            value: isOnline() ? (session?.teamCode ?? "—") : "Single player",
            className: "sm",
          },
        ]}
      />

      {error && (
        <div className="notice bad" role="status">
          {error}
        </div>
      )}

      <Tabs
        tabs={[
          { id: "leagues", label: "Your Leagues" },
          { id: "join", label: "Join a League" },
          { id: "create", label: "Start a League" },
        ]}
        active={active}
        onChange={setActive}
        label="Online league actions"
      />

      <Panel id="leagues" open={active === "leagues"}>
        {leagues.length === 0 ? (
          <div className="emptystate">
            You aren't in an online league yet. Join one with an invite code, or start your own.
          </div>
        ) : (
          leagues.map((l) => {
            const box = inbox.find((b) => b.leagueId === l.id);
            return (
              <div key={l.id} className="lobby-row">
                <div>
                  <p className="pname">
                    {l.name}
                    {l.teamCode && (
                      <span className="ppos">{TEAMS_BY_CODE[l.teamCode]?.abbr ?? l.teamCode}</span>
                    )}
                  </p>
                  <p className="lobby-sub">
                    {l.season} · {stageName(l.stage)}
                    {box?.msLeft != null && ` · ${timeLeft(box.msLeft)} left in this phase`}
                  </p>
                  {!l.teamCode && (
                    <p className="lobby-todo now">
                      Pick your franchise to start playing — the league is ready now, and any team
                      nobody claims is run by the AI.
                    </p>
                  )}
                  {l.inviteCode && (
                    <p className="lobby-sub">
                      Invite code:{" "}
                      <span className="oswald" style={{ fontSize: 14, letterSpacing: "0.08em" }}>
                        {l.inviteCode}
                      </span>{" "}
                      — send it to the other GMs; they register, then enter it under Join a League.
                    </p>
                  )}
                  {box?.items.map((item, i) => (
                    <p key={i} className={`lobby-todo${item.urgency === "now" ? " now" : ""}`}>
                      {item.title}
                      {item.detail ? ` ${item.detail}` : ""}
                    </p>
                  ))}
                </div>
                <div className="lobby-actions">
                  {l.teamCode && <TeamBadge code={l.teamCode} size={28} />}
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() =>
                      l.teamCode
                        ? void open(l.id)
                        : void attempt(async () => {
                            const { openTeams } = await client.openTeams(l.id);
                            setClaiming({ leagueId: l.id, teams: openTeams });
                          })
                    }
                  >
                    {l.teamCode ? "Open" : "Claim a team"}
                  </button>
                </div>
                {claiming?.leagueId === l.id && (
                  <TeamPicker
                    teams={claiming.teams}
                    busy={busy}
                    onPick={(teamCode) =>
                      void attempt(async () => {
                        await client.claimTeam(l.id, teamCode);
                        setClaiming(null);
                        await refresh();
                      })
                    }
                  />
                )}
              </div>
            );
          })
        )}
      </Panel>

      <Panel id="join" open={active === "join"}>
        <JoinByInvite
          busy={busy}
          attempt={attempt}
          onJoined={async (leagueId) => {
            await attempt(refresh);
            await open(leagueId);
          }}
        />
      </Panel>

      <Panel id="create" open={active === "create"}>
        <CreateLeague
          busy={busy}
          attempt={attempt}
          onCreated={() =>
            void attempt(async () => {
              await refresh();
              // the league is real but teamless; the next thing to do is claim
              // a team, and that lives on the list
              setActive("leagues");
            })
          }
        />
      </Panel>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/")}>
          Back to your dynasty
        </button>
      </Footer>
    </Card>
  );
}

/** "2d 4h", "6h", "41m" — a deadline days away needs no minutes. */
function timeLeft(ms: number): string {
  if (ms <= 0) return "no time";
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

type Attempt = (run: () => Promise<void>) => Promise<void>;

function SignIn({
  busy,
  error,
  onDone,
  attempt,
  onBack,
}: {
  busy: boolean;
  error: string | null;
  onDone: (u: OnlineUser) => Promise<void>;
  attempt: Attempt;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const submit = (): void =>
    void attempt(async () => {
      const res =
        mode === "register" ? await client.register(name, password) : await client.login(name, password);
      await onDone(res.user);
    });

  return (
    <Card maxWidth={520}>
      <CardHeader
        badge="ON"
        title={mode === "register" ? "Create an Account" : "Sign In"}
        subtitle="One league, one team, played over months"
      />
      <div className="panel open">
        {error && (
          <div className="notice bad" role="status">
            {error}
          </div>
        )}
        <form
          className="lobby-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label>
            <span>Name</span>
            <input
              type="text"
              value={name}
              autoComplete="username"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || name.trim() === "" || password === ""}
          >
            {mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>
        <p style={{ margin: "14px 0 0", fontSize: 11.5, color: "var(--ink-faint)" }}>
          {mode === "register"
            ? "Your name is how other GMs in the league will see you."
            : "No account yet? You'll need one before you can be invited to a league."}
        </p>
      </div>
      <Footer>
        <button
          type="button"
          className="btnlink"
          onClick={() => setMode(mode === "register" ? "signin" : "register")}
        >
          {mode === "register" ? "I already have an account" : "Create an account"}
        </button>
        <button type="button" className="btnlink" onClick={onBack}>
          Back to your dynasty
        </button>
      </Footer>
    </Card>
  );
}

function JoinByInvite({
  busy,
  attempt,
  onJoined,
}: {
  busy: boolean;
  attempt: Attempt;
  onJoined: (leagueId: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [found, setFound] = useState<{ league: { id: string; name: string }; openTeams: string[] } | null>(
    null,
  );

  return (
    <>
      <form
        className="lobby-form inline"
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(async () => setFound(await client.lookUpInvite(code.trim().toUpperCase())));
        }}
      >
        <label>
          <span>Invite code</span>
          <input
            type="text"
            value={code}
            placeholder="ABC12345"
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy || code.trim() === ""}>
          Look it up
        </button>
      </form>

      {found && (
        <>
          <p className="subhead">{found.league.name}</p>
          <TeamPicker
            teams={found.openTeams}
            busy={busy}
            onPick={(codeStr) =>
              void attempt(async () => {
                await client.claimTeam(found.league.id, codeStr);
                await onJoined(found.league.id);
              })
            }
          />
        </>
      )}
    </>
  );
}

/**
 * One league rule, laid out like the single-player setup screen's.
 *
 * Kept local to this file rather than shared with `LeagueSetup`: that screen
 * edits a league that already exists and can save as you go, while this one
 * is a form that has to be complete before anything is created. They look the
 * same on purpose and behave differently for a reason.
 */
function OnlineSetting({
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
        padding: "12px 0",
        borderBottom: "1px solid var(--line)",
        gap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{label}</p>
        <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
          {hint}
        </p>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function CreateLeague({
  busy,
  attempt,
  onCreated,
}: {
  busy: boolean;
  attempt: Attempt;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slots, setSlots] = useState(4);
  const [hours, setHours] = useState(48);
  const [invite, setInvite] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // The rules, with the same defaults the single-player game uses. These are
  // fixed for the life of the league once it is created — there is no editing
  // them out from under GMs who joined on the strength of them — so the form
  // is the only place they can be set.
  const [fantasyDraft, setFantasyDraft] = useState(true);
  const [draftType, setDraftType] = useState<"snake" | "linear">("snake");
  const [draftOrder, setDraftOrder] = useState<"randomized" | "inOrder">("randomized");
  // Change 1: how many picks each GM makes before the board finishes itself.
  // "" is the Never option — the whole draft by hand.
  const [simAfter, setSimAfter] = useState<string>("5");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [randomEvents, setRandomEvents] = useState<RandomEventRate>("some");
  const [gameDayHours, setGameDayHours] = useState<DeadlineChoice>(24);

  return (
    <>
      <form
        className="lobby-form"
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(async () => {
            const made = await client.createLeague({
              name: name.trim(),
              humanSlots: slots,
              phaseTimeoutHours: hours,
              config: {
                fantasyDraft,
                draftType,
                draftOrder,
                draftSimulateAfterPicks: simAfter === "" ? null : Number(simAfter),
                difficulty,
                randomEvents,
                gameDayDeadlineHours: gameDayHours,
                offseasonStageDeadlineHours: hours > 48 ? 48 : (hours as DeadlineChoice),
              },
            });
            setInvite(made.inviteCode);
            onCreated();
          });
        }}
      >
        <label>
          <span>League name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Human GMs</span>
          <select value={slots} onChange={(e) => setSlots(Number(e.target.value))}>
            {[2, 3, 4, 6, 8, 12, 16].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Hours per phase</span>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {[12, 24, 48, 72, 168].map((n) => (
              <option key={n} value={n}>
                {n === 168 ? "A week" : `${n}h`}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btnlink"
          onClick={() => setShowSettings((v) => !v)}
          style={{ justifySelf: "start", padding: 0 }}
        >
          {showSettings ? "Hide league settings" : "League settings"}
        </button>

        {showSettings && (
          <div style={{ marginTop: 2 }}>
            <p style={{ margin: "0 0 4px", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
              These are fixed once the league is created — other GMs join on the strength of them,
              so there is no changing them afterwards.
            </p>

            <OnlineSetting
              label="Fantasy draft"
              hint="Every team starts empty and the whole league is drafted. Off, teams keep their real rosters."
            >
              <select
                value={fantasyDraft ? "on" : "off"}
                onChange={(e) => setFantasyDraft(e.target.value === "on")}
              >
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </OnlineSetting>

            <OnlineSetting
              label="Draft type"
              hint="Snake reverses each round, so a late first-rounder picks early in the second."
            >
              <select
                value={draftType}
                disabled={!fantasyDraft}
                onChange={(e) => setDraftType(e.target.value as "snake" | "linear")}
              >
                <option value="snake">Snake</option>
                <option value="linear">Linear</option>
              </select>
            </OnlineSetting>

            <OnlineSetting
              label="Draft order"
              hint="Randomized draws the whole league out of a hat. In order puts the GMs first, by slot."
            >
              <select
                value={draftOrder}
                disabled={!fantasyDraft}
                onChange={(e) => setDraftOrder(e.target.value as "randomized" | "inOrder")}
              >
                <option value="randomized">Randomized</option>
                <option value="inOrder">In order</option>
              </select>
            </OnlineSetting>

            <OnlineSetting
              label="Manual picks each"
              hint="How many picks every GM makes by hand. Once the last GM reaches it, the rest of the draft completes itself and everyone goes to the summary. Twenty rounds by hand is a long evening."
            >
              <select
                value={simAfter}
                disabled={!fantasyDraft}
                onChange={(e) => setSimAfter(e.target.value)}
              >
                {[1, 2, 3, 5, 8, 10, 15, 20].map((n) => (
                  <option key={n} value={String(n)}>
                    {n} {n === 1 ? "pick" : "picks"}
                  </option>
                ))}
                <option value="">Never — draft all 20 rounds by hand</option>
              </select>
            </OnlineSetting>

            <OnlineSetting
              label="Difficulty"
              hint="How hard the AI GMs work at their rosters and their in-game decisions."
            >
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              >
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
                <option value="impossible">Impossible</option>
              </select>
            </OnlineSetting>

            <OnlineSetting
              label="Random events"
              hint="Mid-season holdouts, locker-room stories and the rest. None keeps it purely on the field."
            >
              <select
                value={randomEvents}
                onChange={(e) => setRandomEvents(e.target.value as RandomEventRate)}
              >
                <option value="none">None</option>
                <option value="few">Few</option>
                <option value="some">Some</option>
                <option value="many">Many</option>
              </select>
            </OnlineSetting>

            <OnlineSetting
              label="Hours per game week"
              hint="How long a game week waits on a GM before their staff plays it for them."
            >
              <select
                value={gameDayHours}
                onChange={(e) => setGameDayHours(Number(e.target.value) as DeadlineChoice)}
              >
                {[2, 6, 12, 24, 48].map((n) => (
                  <option key={n} value={n}>
                    {n}h
                  </option>
                ))}
              </select>
            </OnlineSetting>
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={busy || name.trim() === ""}>
          Create league
        </button>
      </form>

      <p style={{ margin: "14px 0 0", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
        You'll be the commissioner: you can force a phase on when the league is stuck waiting, and
        reassign a team somebody has abandoned. The phase clock is what keeps a league moving when
        a GM goes quiet — when it runs out, their staff acts for them and play continues.
      </p>

      {invite && (
        <div className="notice" role="status" style={{ marginTop: 16 }}>
          <strong>League created.</strong> Send the other GMs this invite code:{" "}
          <span className="oswald" style={{ fontSize: 16, letterSpacing: "0.08em" }}>
            {invite}
          </span>
          . It stays on the league under <em>Your Leagues</em>, so you can come back for it —
          and that is where you pick your own team.
        </div>
      )}
    </>
  );
}

/**
 * Choosing a franchise.
 *
 * Shown both to someone arriving with an invite code and to a commissioner
 * who created a league and hasn't picked a team yet — the same decision, made
 * once, and kept for the life of the league.
 */
function TeamPicker({
  teams,
  busy,
  onPick,
}: {
  teams: string[];
  busy: boolean;
  onPick: (teamCode: string) => void;
}) {
  if (teams.length === 0) {
    return <div className="emptystate">Every team in that league is taken.</div>;
  }
  return (
    // a block of its own, so it drops below the league row it belongs to
    // rather than squeezing in beside the button that opened it
    <div className="lobby-claim">
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-dim)" }}>
        Pick the franchise you want to run. You keep it for the life of the league.
      </p>
      <div className="needgrid">
        {teams.map((codeStr) => (
          <button
            key={codeStr}
            type="button"
            className="lobby-team"
            disabled={busy}
            onClick={() => onPick(codeStr)}
          >
            <TeamBadge code={codeStr} size={22} />
            <span>{TEAMS_BY_CODE[codeStr]?.label ?? codeStr}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
