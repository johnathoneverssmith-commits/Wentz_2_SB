import { ManualPicksInput } from "@/components/ManualPicksInput";
import { CopyButton, inviteLink } from "@/components/CopyButton";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { displaySeasonFor } from "@/state/stageMachine";
import { TALENT_IMPACT_HINT, TALENT_IMPACT_LABEL, type TalentImpact } from "@/state/talentImpact";
import { humansOnlyLeagueSize, playoffFieldSize, seasonShapeFor } from "@/state/leagueFormat";
import { useNavigate, useSearchParams } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { InboxLeague, OnlineUser } from "@/sim/OnlineLeagueClient";
import { OnlineError, OnlineLeagueClient } from "@/sim/OnlineLeagueClient";
import { TURN_STAGES } from "@/components/TurnClock";
import { goLocal, isOnline, joinLeague, lastLeagueId, onlineSession } from "@/state/online";
import { leaveForDynasty } from "@/state/leagueOrigin";
import { STAGE_LABEL } from "@/state/stageMachine";
import { timeLeft } from "@/util/format";
import { useStore } from "@/state/store";
import type { DeadlineChoice, Difficulty, Stage } from "@/domain";

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
type Mode = "signin" | "register" | "reset";

const client = new OnlineLeagueClient();

interface LeagueRow {
  id: string;
  name: string;
  teamCode: string | null;
  stage: string;
  season: number;
  isCommissioner: boolean;
  inviteCode: string | null;
  /** Absent from an older server; treated as "maybe" and the code is shown. */
  openSeats?: number;
}

/** The server hands back the raw stage key; the app has a name for it. */
const stageName = (stage: string): string => STAGE_LABEL[stage as Stage] ?? stage;
/** Stages played a turn at a time — the only ones with a running clock. */

export function OnlineLobby() {
  const nav = useNavigate();
  // an invite link: open on the Join tab with its code ready
  const invited = (useSearchParams()[0].get("invite") ?? "").trim().toUpperCase();
  const { active, setActive } = useTabs(invited ? "join" : "leagues");
  const [claiming, setClaiming] = useState<{ leagueId: string; teams: string[] } | null>(null);

  const [user, setUser] = useState<OnlineUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [inbox, setInbox] = useState<InboxLeague[]>([]);
  const [changingPassword, setChangingPassword] = useState(false);
  const [managingLeague, setManagingLeague] = useState<string | null>(null);

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

  const [wakeTries, setWakeTries] = useState(0);
  const unmounted = useRef(false);
  useEffect(() => {
    // set here too: StrictMode mounts, unmounts and mounts again, and a flag
    // left true by the first cleanup stopped every later check dead
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  /**
   * Ask the server who we are; this is also what "try again" re-runs.
   *
   * A sleeping free-tier server takes up to a minute to wake, and the first
   * request of the day often fails while it does. Keep asking for about a
   * minute before calling it down, rather than making every GM's first visit
   * start with an error and a button.
   */
  const check = useCallback(async () => {
    setChecking(true);
    for (let tries = 0; ; tries++) {
      setWakeTries(tries);
      try {
        const me = await client.me();
        if (unmounted.current) return;
        setUser(me.user);
        setOffline(false);
        if (me.user) await refresh();
        break;
      } catch (err) {
        if (unmounted.current) return;
        // the server said something definite: waiting won't change it
        if (err instanceof OnlineError || tries >= 5) {
          setOffline(true);
          break;
        }
        await new Promise((r) => setTimeout(r, 10_000));
        if (unmounted.current) return;
      }
    }
    setChecking(false);
  }, [refresh]);

  useEffect(() => {
    void check();
  }, [check]);

  // The lobby is where a GM in several leagues sees whose turn it is — and it
  // only ever knew as of the moment it opened. Keep it current while it's
  // being looked at; a hidden tab waits until it's looked at again.
  useEffect(() => {
    if (!user) return;
    const tick = (): void => {
      if (document.hidden) return;
      void refresh().catch(() => undefined);
    };
    const timer = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [user, refresh]);

  const open = (leagueId: string, path = "/") =>
    attempt(async () => {
      const { state } = await joinLeague(leagueId);
      useStore.setState(state as never);
      // wherever the league is — the draft room mid-draft, a gate screen at
      // a checkpoint — not the hub every time; or straight to the thing a
      // to-do line was about
      nav(path);
    });

  if (checking) {
    return (
      <Card maxWidth={720}>
        <CardHeader badge="ON" title="Online Leagues" subtitle="Looking for the league server…" />
        <div className="panel open">
          <div className="emptystate">
            {wakeTries === 0
              ? "One moment."
              : "Waking the league server — it sleeps when nobody has played for a while. This can take up to a minute."}
          </div>
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
            If it keeps failing, the server is down — try again later. Your single-player dynasty
            is untouched either way.
            {/* setup instructions are for whoever runs the server, not for players */}
            {import.meta.env.DEV && (
              <>
                {" "}
                Running your own: create a Postgres database, point <code>DATABASE_URL</code> at it,
                then <code>npm run online:migrate</code> once and <code>npm run online</code>.
              </>
            )}
          </p>
        </div>
        <Footer>
          <button type="button" className="btnlink" onClick={() => void check()}>
            Try again
          </button>
          <button type="button" className="btnlink btn-primary" onClick={() => leaveForDynasty() || nav("/")}>
            Back to your dynasty
          </button>
        </Footer>
      </Card>
    );
  }

  if (!user) {
    return (
      <SignIn
        invited={!!invited}
        busy={busy}
        error={error}
        onDone={async (u) => {
          setUser(u);
          await attempt(refresh);
          // signed out mid-league (an expired session, a password changed on
          // another device): back into the league they were in, not the
          // lobby with it to find again — unless they came on an invite
          const back = lastLeagueId();
          if (back && !invited && !isOnline()) {
            const mine = await client.myLeagues().catch(() => null);
            if (mine?.leagues.some((l) => l.id === back && l.teamCode)) await open(back);
          }
        }}
        attempt={attempt}
        onBack={() => leaveForDynasty() || nav("/")}
      />
    );
  }

  const session = onlineSession();
  // leagues, not items: one league on the clock and waiting on a ready-up
  // is one league waiting on you, not two
  // something actually waiting on you — not a "whenever" note like an empty
  // seat or a roster to trim before the season
  const waiting =
    inbox.filter((l) => l.items.some((i) => i.urgency !== "whenever")).length +
    // a league you made and haven't picked a team in yet can't start without
    // you — it has no inbox (no team to ask about), and counted as nothing
    leagues.filter((l) => !l.teamCode && l.stage === "setup" && !inbox.some((x) => x.leagueId === l.id)).length;

  return (
    <Card maxWidth={760}>
      <CardHeader
        badge="ON"
        title="Online Leagues"
        subtitle={`Signed in as ${user.name}`}
        right={
          <span style={{ display: "flex", gap: 12 }}>
            <button type="button" className="btnlink" onClick={() => setChangingPassword((v) => !v)}>
              Change password
            </button>
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
          </span>
        }
      />
      {changingPassword && <ChangePassword userName={user.name} onDone={() => setChangingPassword(false)} />}
      <Ticker
        stats={[
          { label: "Your leagues", value: leagues.length },
          {
            label: "Waiting on you",
            value: waiting,
            className: waiting > 0 ? "bad" : undefined,
          },
          {
            // the league open on this device, when there is one
            label: "Open now",
            // the league, not the team: a GM in two leagues as GB saw "GB" either way
            value: isOnline() ? (session ? `${session.leagueName} · ${session.teamCode}` : "—") : "Single player",
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
        onChange={(id) => {
          // a bad invite code's error followed the GM onto "Start a League"
          setError(null);
          setActive(id);
        }}
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
                    {/* read aloud, "Cycle 7 leagueGB" */}
                    {l.teamCode && <span className="sr-only">, your team: </span>}
                    {l.teamCode && (
                      <span className="ppos">{TEAMS_BY_CODE[l.teamCode]?.abbr ?? l.teamCode}</span>
                    )}
                  </p>
                  <p className="lobby-sub">
                    {displaySeasonFor(l.season, l.stage as Stage)} · {stageName(l.stage)}
                    {/* only a turn has a clock; a check-in waits for everyone */}
                    {box?.msLeft != null && TURN_STAGES.has(l.stage) && ` · ${timeLeft(box.msLeft)} left on this turn`}
                  </p>
                  {!l.teamCode && (
                    <p className="lobby-todo now">
                      {/* "the league is ready now" — it starts only when every GM seat is
                          claimed and everyone checks in */}
                      Pick your franchise. The league starts once every GM seat is claimed and
                      everyone has checked in; the teams no GM runs are the AI&rsquo;s.
                    </p>
                  )}
                  {/* a full league has nobody left to invite */}
                  {l.inviteCode && (l.openSeats ?? 1) > 0 && (
                    <p className="lobby-sub">
                      Invite code:{" "}
                      <span className="oswald" style={{ fontSize: 14, letterSpacing: "0.08em" }}>
                        {l.inviteCode}
                      </span>{" "}
                      <CopyButton text={l.inviteCode} /> ·{" "}
                      <CopyButton text={inviteLink(l.inviteCode)} label="Copy invite link" />{" "}
                      — send it to the other GMs; they register, then enter it under Join a League.
                    </p>
                  )}
                  {box?.items.map((item, i) => (
                    // each line says where it's about — it used to be just text
                    <p key={i} className={`lobby-todo${item.urgency === "now" ? " now" : ""}`}>
                      <button
                        type="button"
                        className="btnlink"
                        // a 16px-tall line under a thumb: the padding is the tap
                        // area, the margin takes it back so the text sits as before
                        style={{ padding: "8px 0", margin: "-8px 0", font: "inherit", textAlign: "left", color: "inherit" }}
                        disabled={busy || !l.teamCode}
                        onClick={() => void open(l.id, item.href || "/")}
                      >
                        {item.title}
                      </button>
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
                    // one "Open" per league read as a list of identical buttons
                    aria-label={`${l.teamCode ? "Open" : "Claim a team in"} ${l.name}`}
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
                  {/* the way out: there was none short of never opening it again */}
                  {l.isCommissioner ? (
                    <>
                    <button
                      type="button"
                      className="btnlink sm"
                      aria-expanded={managingLeague === l.id}
                      aria-label={`Manage GMs in ${l.name}`}
                      onClick={() => setManagingLeague((m) => (m === l.id ? null : l.id))}
                    >
                      Manage GMs
                    </button>
                    <button
                      type="button"
                      className="btnlink sm"
                      disabled={busy}
                      aria-label={`Archive ${l.name}`}
                      onClick={() => {
                        if (!confirm(`Archive ${l.name}? It leaves every GM's list and can't be joined or played again.`)) return;
                        void attempt(async () => {
                          await client.archiveLeague(l.id);
                          if (onlineSession()?.leagueId === l.id) goLocal();
                          await refresh();
                        });
                      }}
                    >
                      Archive
                    </button>
                    </>
                  ) : (
                    l.teamCode && (
                      <button
                        type="button"
                        className="btnlink sm"
                        disabled={busy}
                        aria-label={`Leave ${l.name}`}
                        onClick={() => {
                          if (!confirm(`Leave ${l.name}? The CPU runs your team until someone claims the open seat with the invite code.`)) return;
                          void attempt(async () => {
                            await client.leaveLeague(l.id);
                            if (onlineSession()?.leagueId === l.id) goLocal();
                            await refresh();
                          });
                        }}
                      >
                        Leave
                      </button>
                    )
                  )}
                </div>
                {managingLeague === l.id && (
                  <ManageGms leagueId={l.id} client={client} onChanged={() => void refresh().catch(() => undefined)} />
                )}
                {claiming?.leagueId === l.id && (
                  <TeamPicker
                    teams={claiming.teams}
                    busy={busy}
                    onPick={(teamCode) =>
                      void attempt(async () => {
                        await client.claimTeam(l.id, teamCode);
                        setClaiming(null);
                        // straight in, as joining by invite does — it used to
                        // leave the GM on the lobby to press Open as well
                        await open(l.id);
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
          initialCode={invited}
          mine={leagues.map((l) => l.id)}
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
        {/* the lobby loads once; "waiting on you" went stale while it sat open */}
        <button type="button" className="btnlink" disabled={busy} onClick={() => void attempt(refresh)}>
          Refresh
        </button>
        {isOnline() ? (
          <>
            {/* the only way back to a solo dynasty used to be signing out */}
            <button
              type="button"
              className="btnlink"
              onClick={() => {
                goLocal();
                if (!leaveForDynasty()) nav("/");
              }}
            >
              Play single-player
            </button>
            <button type="button" className="btnlink" onClick={() => nav("/")}>
              Back to {onlineSession()?.leagueName ?? "your league"}
            </button>
          </>
        ) : (
          <button type="button" className="btnlink" onClick={() => leaveForDynasty() || nav("/")}>
            Back to your dynasty
          </button>
        )}
      </Footer>
    </Card>
  );
}

type Attempt = (run: () => Promise<void>) => Promise<void>;

function SignIn({
  invited = false,
  busy,
  error,
  onDone,
  attempt,
  onBack,
}: {
  /** Arrived on an invite link: say so, and that an account comes first. */
  invited?: boolean;
  busy: boolean;
  error: string | null;
  onDone: (u: OnlineUser) => Promise<void>;
  attempt: Attempt;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const submit = (): void =>
    void attempt(async () => {
      const res =
        mode === "register"
          ? await client.register(name, password)
          : mode === "reset"
            ? await client.resetPassword(name, code, password)
            : await client.login(name, password);
      await onDone(res.user);
    });

  return (
    <Card maxWidth={520}>
      <CardHeader
        badge="ON"
        title={mode === "register" ? "Create an Account" : mode === "reset" ? "Reset Your Password" : "Sign In"}
        subtitle="One league, one team, played over months"
      />
      <div className="panel open">
        {invited && (
          <div className="notice" role="status">
            You&rsquo;ve been invited to a league. Sign in — or create an account if you&rsquo;re new — and
            you&rsquo;ll be taken straight to it to pick your team.
          </div>
        )}
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
              // the server's limits, so a long name stops at the field rather
              // than coming back as an error after the press
              maxLength={40}
              // a phone capitalised and "corrected" names as they were typed
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {mode === "reset" && (
            <label>
              <span>Reset code</span>
              <input
                type="text"
                value={code}
                autoComplete="one-time-code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          <label>
            <span>{mode === "reset" ? "New password" : "Password"}</span>
            <input
              type="password"
              value={password}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              maxLength={200}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || name.trim() === "" || password === "" || (mode === "reset" && code.trim() === "")}
          >
            {mode === "register" ? "Create account" : mode === "reset" ? "Set new password" : "Sign in"}
          </button>
        </form>
        <p style={{ margin: "14px 0 0", fontSize: 11.5, color: "var(--ink-faint)" }}>
          {mode === "register"
            ? "Your name is how other GMs in the league will see you. Passwords need at least 8 characters."
            : mode === "reset"
              ? "Accounts have no email, so resets go through your league's commissioner: ask them for a code. It works once, for 24 hours, and signs you out everywhere else."
              : invited
                ? "No account yet? Create one below — it takes a name and a password."
                : "No account yet? You'll need one before you can be invited to a league."}
        </p>
      </div>
      <Footer>
        <button
          type="button"
          className="btnlink"
          onClick={() => setMode(mode === "signin" ? "register" : "signin")}
        >
          {mode === "signin" ? "Create an account" : mode === "register" ? "I already have an account" : "Back to sign in"}
        </button>
        {mode === "signin" && (
          <button type="button" className="btnlink" onClick={() => setMode("reset")}>
            Forgot your password?
          </button>
        )}
        <button type="button" className="btnlink" onClick={onBack}>
          Back to your dynasty
        </button>
      </Footer>
    </Card>
  );
}

/** A new password; every other device signed in to this account is signed out. */
function ChangePassword({ onDone, userName }: { onDone: () => void; userName: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = (): void => {
    setBusy(true);
    setNote(null);
    void client
      .changePassword(current, next)
      .then(() => {
        setCurrent("");
        setNext("");
        setNote({ ok: true, text: "Password changed. Any other device signed in to this account is signed out." });
      })
      .catch((err: unknown) =>
        setNote({ ok: false, text: err instanceof OnlineError ? err.message : "The server didn't answer." }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="panel open">
      {note && (
        <div className={`notice${note.ok ? "" : " bad"}`} role="status">
          {note.text}
        </div>
      )}
      <form
        className="lobby-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* a password manager files a changed password under a username, and
            this form had none for it to find — so the new one was saved as a
            nameless entry, or not at all */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={userName}
          readOnly
          hidden
          aria-hidden="true"
        />
        <label>
          <span>Current password</span>
          <input
            type="password"
            value={current}
            autoComplete="current-password"
            maxLength={200}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          {/* the button stayed grey below 8 characters with nothing saying why */}
          <span>New password · at least 8 characters</span>
          <input type="password" value={next} autoComplete="new-password" maxLength={200} onChange={(e) => setNext(e.target.value)} />
        </label>
        <div style={{ display: "flex", gap: 12 }}>
          <button type="submit" className="btn-primary" disabled={busy || current === "" || next.length < 8}>
            {busy ? "Saving…" : "Change password"}
          </button>
          <button type="button" className="btnlink" onClick={onDone}>
            Close
          </button>
        </div>
      </form>
    </div>
  );
}

function JoinByInvite({
  initialCode = "",
  busy,
  attempt,
  onJoined,
  mine = [],
}: {
  /** From an invite link: filled in and looked up straight away. */
  initialCode?: string;
  busy: boolean;
  attempt: Attempt;
  onJoined: (leagueId: string) => Promise<void>;
  /** Leagues this account is already in. */
  mine?: string[];
}) {
  const [code, setCode] = useState(initialCode);
  const [found, setFound] = useState<{
    league: { id: string; name: string; season?: number; stage?: string };
    openTeams: string[];
  } | null>(
    null,
  );
  const lookedUp = useRef(false);
  useEffect(() => {
    if (!initialCode || lookedUp.current) return;
    lookedUp.current = true;
    void attempt(async () => setFound(await client.lookUpInvite(initialCode)));
  }, [initialCode, attempt]);

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
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
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
          {/* your own league's code read "Every team in that league is taken" */}
          {mine.includes(found.league.id) ? (
            <div className="emptystate">
              You&rsquo;re already in this league.{" "}
              <button type="button" className="btnlink" onClick={() => void onJoined(found.league.id)}>
                Open it
              </button>
            </div>
          ) : (
          <TeamPicker
            teams={found.openTeams}
            underway={found.league.stage && found.league.stage !== "setup" ? { season: found.league.season ?? 0, stage: found.league.stage } : null}
            busy={busy}
            onPick={(codeStr) =>
              void attempt(async () => {
                await client.claimTeam(found.league.id, codeStr);
                await onJoined(found.league.id);
              })
            }
          />
          )}
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
  // the title sat beside its select as plain text: a screen reader reached
  // eleven unnamed dropdowns
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${id}-l`}
      aria-describedby={`${id}-h`}
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
        <p id={`${id}-l`} style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{label}</p>
        <p id={`${id}-h`} style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
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
  // check-ins wait for everyone, so a per-phase clock did nothing: the
  // control is gone and the server keeps its default
  const hours = 48;
  const [turnHours, setTurnHours] = useState(12);
  const [invite, setInvite] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // The rules, with the same defaults the single-player game uses. These are
  // fixed for the life of the league once it is created — there is no editing
  // them out from under GMs who joined on the strength of them — so the form
  // is the only place they can be set.
  const [fantasyDraft, setFantasyDraft] = useState(true);
  const [leagueFormat, setLeagueFormat] = useState<"nfl" | "humansOnly">("nfl");
  const humansOnly = leagueFormat === "humansOnly";
  const leagueSize = humansOnlyLeagueSize(slots);
  const [draftType, setDraftType] = useState<"snake" | "linear">("snake");
  const [draftOrder, setDraftOrder] = useState<"randomized" | "inOrder">("randomized");
  // Change 1: how many picks each GM makes before the board finishes itself.
  // "" is the Never option — the whole draft by hand.
  const [simAfter, setSimAfter] = useState<string>("5");
  const [draftRounds, setDraftRounds] = useState<string>("3");
  const [faRounds, setFaRounds] = useState<string>("3");
  const [difficulty, setDifficulty] = useState<Difficulty>("standard");
  const [talentImpact, setTalentImpact] = useState<TalentImpact>("amplified");
  const gameDayHours: DeadlineChoice = 24;

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
              pickTimeoutHours: turnHours,
              config: {
                leagueFormat,
                // a humans-only league has no NFL rosters to inherit
                fantasyDraft: humansOnly || fantasyDraft,
                draftType,
                draftOrder,
                draftSimulateAfterPicks: Number(simAfter),
                draftHumanRounds: draftRounds === "all" ? null : Number(draftRounds),
                faHumanRounds: faRounds === "all" ? null : Number(faRounds),
                difficulty,
                talentImpact,
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
          <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>League format</span>
          <select
            value={leagueFormat}
            onChange={(e) => {
              const f = e.target.value as "nfl" | "humansOnly";
              setLeagueFormat(f);
              if (f === "humansOnly") setSlots((n) => Math.min(8, n));
            }}
          >
            <option value="nfl">Full NFL (32 teams)</option>
            <option value="humansOnly">Human GMs only (round robin)</option>
          </select>
        </label>
        {humansOnly && (
          <p style={{ margin: "-4px 0 0", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
            {leagueSize} teams ({slots} human + {leagueSize - slots} CPU), a round robin of{" "}
            {seasonShapeFor("humansOnly", leagueSize).regularSeasonWeeks} games, and a playoff for the top{" "}
            {playoffFieldSize(leagueSize)}. The other NFL franchises don&rsquo;t exist in this league.
          </p>
        )}
        <label>
          <span>Human GMs</span>
          <select value={slots} onChange={(e) => setSlots(Number(e.target.value))}>
            {(humansOnly ? [2, 3, 4, 5, 6, 7, 8] : [2, 3, 4, 6, 8, 12, 16]).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          {/* picks, hires, bids and deadline offers: when this runs out on a
              GM's turn, their staff takes it for them */}
          <span>Hours per turn</span>
          <select value={turnHours} onChange={(e) => setTurnHours(Number(e.target.value))}>
            {[1, 4, 12, 24, 48].map((n) => (
              <option key={n} value={n}>
                {`${n}h`}
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
              You can still change these in League settings until the league starts; once it
              kicks off they&rsquo;re fixed for everyone.
            </p>

            <OnlineSetting label="Rookie draft rounds by hand" hint="How many rounds of each year's rookie draft the human GMs pick by hand. After them the staff picks for everyone, so nobody waits on seven rounds of special-teamers.">
              <select value={draftRounds} onChange={(e) => setDraftRounds(e.target.value)}>
                {["1", "2", "3", "all"].map((v) => (
                  <option key={v} value={v}>
                    {v === "all" ? "All 7" : v}
                  </option>
                ))}
              </select>
            </OnlineSetting>
            <OnlineSetting label="Free agency rounds by hand" hint="How many of free agency's five rounds a human GM takes their own turn in. After them their staff takes the turn. You can change both at the start of each offseason.">
              <select value={faRounds} onChange={(e) => setFaRounds(e.target.value)}>
                {["1", "2", "3", "4", "all"].map((v) => (
                  <option key={v} value={v}>
                    {v === "all" ? "All 5" : v}
                  </option>
                ))}
              </select>
            </OnlineSetting>

            <OnlineSetting
              label="Fantasy draft"
              hint="Every team starts empty and the whole league is drafted. Off, teams keep their real rosters."
            >
              <select
                value={humansOnly || fantasyDraft ? "on" : "off"}
                disabled={humansOnly}
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
                disabled={!(humansOnly || fantasyDraft)}
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
                disabled={!(humansOnly || fantasyDraft)}
                onChange={(e) => setDraftOrder(e.target.value as "randomized" | "inOrder")}
              >
                <option value="randomized">Randomized</option>
                <option value="inOrder">In order</option>
              </select>
            </OnlineSetting>

            <OnlineSetting
              label="Manual picks each"
              hint="How many picks every GM makes by hand, from 1 to 53. Once the last GM reaches it, the draft carries on by itself until every team has a full 53-man roster."
            >
              <ManualPicksInput
                value={Number(simAfter)}
                disabled={!(humansOnly || fantasyDraft)}
                onChange={(n) => setSimAfter(String(n))}
              />
            </OnlineSetting>

            <OnlineSetting label="Talent impact" hint={TALENT_IMPACT_HINT[talentImpact]}>
              <select value={talentImpact} onChange={(e) => setTalentImpact(e.target.value as TalentImpact)}>
                {(["realistic", "amplified", "extreme"] as const).map((v) => (
                  <option key={v} value={v}>
                    {TALENT_IMPACT_LABEL[v]}
                  </option>
                ))}
              </select>
            </OnlineSetting>

            <OnlineSetting
              label="AI Difficulty"
              hint="How competently CPU GMs make decisions — never a rules, rating, or cap change."
            >
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              >
                <option value="casual">Casual</option>
                <option value="standard">Standard</option>
                <option value="competitive">Competitive</option>
                <option value="expert">Expert</option>
                <option value="master">Master</option>
              </select>
            </OnlineSetting>

          </div>
        )}

        <button type="submit" className="btn-primary" disabled={busy || name.trim() === ""}>
          Create league
        </button>
      </form>

      <p style={{ margin: "14px 0 0", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
        You'll be the commissioner, and can force the league on when it's stuck waiting. When a GM
        runs out the clock on their turn — a draft pick, a coaching hire, a free-agency bid, a
        trade — their staff takes it for them. Check-ins between stages wait for everyone.
      </p>

      {invite && (
        <div className="notice" role="status" style={{ marginTop: 16 }}>
          <strong>League created.</strong> Send the other GMs this invite code:{" "}
          <span className="oswald" style={{ fontSize: 16, letterSpacing: "0.08em" }}>
            {invite}
          </span>{" "}
          <CopyButton text={invite} /> · <CopyButton text={inviteLink(invite)} label="Copy invite link" />
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
  underway = null,
}: {
  teams: string[];
  busy: boolean;
  onPick: (teamCode: string) => void;
  /** A league already playing: the seat is a team as it stands, not a fresh pick. */
  underway?: { season: number; stage: string } | null;
}) {
  if (teams.length === 0) {
    return <div className="emptystate">Every team in that league is taken.</div>;
  }
  return (
    // a block of its own, so it drops below the league row it belongs to
    // rather than squeezing in beside the button that opened it
    <div className="lobby-claim">
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-dim)" }}>
        {underway
          ? // years into a league, "switch until the league starts" was wrong:
            // the seat is someone's roster, contracts and record, as it stands
            `This league is already under way — ${displaySeasonFor(underway.season, underway.stage as Stage)}, ${stageName(underway.stage)}. You take over the team as it stands: its roster, contracts and record. It's yours for good.`
          : "Pick the franchise you want to run. You can switch on the setup screen until the league starts; after that it’s yours for good."}
      </p>
      <div className="needgrid">
        {teams.map((codeStr) => (
          <button
            key={codeStr}
            type="button"
            className="lobby-team"
            disabled={busy}
            // badge and name ran together: "NONew Orleans"
            aria-label={`Claim ${TEAMS_BY_CODE[codeStr]?.label ?? codeStr}`}
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

/**
 * The commissioner's seat controls, from the lobby. They lived only in the
 * check-in panel, which a draft or a free-agency market doesn't have — so a
 * GM who quit mid-draft couldn't be replaced until it ended.
 */
function ManageGms({
  leagueId,
  client,
  onChanged,
}: {
  leagueId: string;
  client: OnlineLeagueClient;
  /** The league row above went stale: an opened seat still read as "waiting on" its old GM. */
  onChanged: () => void;
}) {
  const [gms, setGms] = useState<{ teamCode: string; name: string; you: boolean }[] | null>(null);
  const [turnHours, setTurnHoursState] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void client
      .leagueGms(leagueId)
      .then((r) => {
        setGms(r.gms);
        setTurnHoursState(r.turnHours ?? null);
      })
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : "Couldn't load the GMs."));
  }, [client, leagueId]);
  useEffect(load, [load]);

  const run = (what: () => Promise<string | null>): void => {
    setBusy(true);
    setNote(null);
    void what()
      .then((msg) => {
        if (msg) setNote(msg);
        load();
        onChanged();
      })
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : "That didn't work."))
      .finally(() => setBusy(false));
  };

  if (!gms) return <p className="lobby-sub">{note ?? "Loading…"}</p>;
  return (
    <div className="lobby-claim" style={{ marginTop: 10 }}>
      {/* the clock was set at creation and never again */}
      {turnHours != null && (
        <label className="neg-row" style={{ fontSize: 12.5 }}>
          <span>Hours per turn (drafts, markets, the deadline)</span>
          <select
            value={turnHours}
            disabled={busy}
            onChange={(e) => {
              const h = Number(e.target.value);
              run(async () => {
                await client.setTurnHours(leagueId, h);
                return `Turns now run on a ${h}-hour clock, from the next one.`;
              });
            }}
          >
            {[1, 4, 12, 24, 48].map((h) => (
              <option key={h} value={h}>
                {h}h
              </option>
            ))}
          </select>
        </label>
      )}
      {gms.map((g) => (
        <div key={g.teamCode} className="neg-row">
          <span style={{ fontSize: 12.5 }}>
            {g.you ? "You" : g.name} · {TEAMS_BY_CODE[g.teamCode]?.label ?? g.teamCode}
          </span>
          {!g.you && (
            <span style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btnlink sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await client.issueResetCode(leagueId, g.teamCode);
                    return `Reset code for ${r.name}: ${r.code} — they use it under "Forgot your password?". Works once, for 24 hours.`;
                  })
                }
                // three of each, one per GM: say whose it is, and keep the
                // label on one line
                aria-label={`Reset code for ${g.name}`}
                style={{ whiteSpace: "nowrap" }}
              >
                reset code
              </button>
              <button
                type="button"
                className="btnlink sm"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Make ${g.name} the commissioner? You'll lose these controls.`)) return;
                  run(async () => {
                    await client.transferCommissioner(leagueId, g.teamCode);
                    return `${g.name} is now the commissioner.`;
                  });
                }}
                // three of each, one per GM: say whose it is, and keep the
                // label on one line
                aria-label={`Make commissioner: ${g.name}`}
                style={{ whiteSpace: "nowrap" }}
              >
                make commissioner
              </button>
              <button
                type="button"
                className="btnlink sm"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Take ${g.name} out of the league? The CPU runs ${g.teamCode} until someone joins with your invite code.`)) return;
                  run(async () => {
                    await client.vacateSeat(leagueId, g.teamCode);
                    return `${g.teamCode}'s seat is open.`;
                  });
                }}
                // three of each, one per GM: say whose it is, and keep the
                // label on one line
                aria-label={`Open the seat of ${g.name}`}
                style={{ whiteSpace: "nowrap" }}
              >
                open seat
              </button>
            </span>
          )}
        </div>
      ))}
      {note && (
        <p className="lobby-sub" role="status" style={{ userSelect: "all" }}>
          {note}
        </p>
      )}
    </div>
  );
}
