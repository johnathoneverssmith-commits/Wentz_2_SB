/**
 * Who is actually in this online league, and who the AI is covering for.
 *
 * This exists because "my league looks empty" is ambiguous from the inside.
 * A league with three open slots and a league that is broken look identical
 * if nothing tells you which one you are in, and the honest answer — every
 * unclaimed team is run by the AI, so you can start right now and people can
 * still join later — is not something a player should have to be told once in
 * chat and then remember.
 *
 * So it reports rather than blocks. There is no waiting state to sit in: the
 * league is playable the moment you have a team, and the count is here to
 * tell you whether to chase anyone before you get going.
 */
import { TeamBadge } from "@/components/bits";
import { TEAMS_BY_CODE } from "@/data/teams";
import { onlineSession } from "@/state/online";
import { useStore } from "@/state/store";

export function LeagueRoster() {
  const gms = useStore((s) => s.gms);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const session = onlineSession();
  if (!session) return null;

  const taken = gms.filter((g) => g.isHuman && g.teamCode);
  const open = gms.length - taken.length;
  const everyone = open === 0;

  return (
    <div className="leagueroster">
      <div className="leagueroster-head">
        <p className="subhead" style={{ margin: 0 }}>
          GMs in this league
        </p>
        <span className={`leagueroster-count${everyone ? " full" : ""}`}>
          {taken.length} of {gms.length} claimed
        </span>
      </div>

      <div className="leagueroster-bar" aria-hidden="true">
        <span style={{ width: `${(taken.length / Math.max(1, gms.length)) * 100}%` }} />
      </div>

      <ul className="leagueroster-list">
        {taken.map(({ id, name, teamCode }) => (
          <li key={id}>
            <TeamBadge code={teamCode} size={20} />
            <span className="leagueroster-name">
              {name}
              {id === viewerGmId && <em> — you</em>}
            </span>
            <span className="leagueroster-team">
              {TEAMS_BY_CODE[teamCode]?.abbr ?? teamCode}
            </span>
          </li>
        ))}
        {open > 0 && (
          <li className="leagueroster-open">
            <span className="leagueroster-name">
              {open} {open === 1 ? "slot is" : "slots are"} still open — the AI runs those teams
              until somebody takes them.
            </span>
          </li>
        )}
      </ul>

      {session.inviteCode && open > 0 && (
        <p className="leagueroster-invite">
          Invite code{" "}
          <span className="oswald" style={{ fontSize: 14, letterSpacing: "0.08em" }}>
            {session.inviteCode}
          </span>{" "}
          — they register, then enter it under Join a League. You don't have to wait for them to
          start playing.
        </p>
      )}
    </div>
  );
}
