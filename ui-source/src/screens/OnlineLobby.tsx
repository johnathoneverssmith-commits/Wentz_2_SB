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
import type { Stage } from "@/domain";

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
 * The server is not deployed and is not meant to be. Running locally it is
 * `npm run online` on :8788; with nothing there, every call fails the same
 * way and the screen says so plainly rather than spinning.
 */
type Mode = "signin" | "register";

const client = new OnlineLeagueClient();

interface LeagueRow {
  id: string;
  name: string;
  teamCode: string | null;
  stage: string;
  season: number;
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
            <strong>Nothing is listening on the league server.</strong> Online play needs it
            running — it is a separate process from the engine adapter, and it is deliberately not
            deployed anywhere yet.
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink-dim)", lineHeight: 1.6 }}>
            To run it locally: create a Postgres database, point <code>DATABASE_URL</code> at it,
            then <code>npm run online:migrate</code> once and <code>npm run online</code>. Your
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
        <CreateLeague busy={busy} attempt={attempt} onCreated={() => void attempt(refresh)} />
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
