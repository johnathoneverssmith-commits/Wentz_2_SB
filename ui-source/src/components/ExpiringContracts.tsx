import { useMemo, useState } from "react";
import { useLeagueActions } from "@/state/useLeagueActions";
import { useNavigate } from "react-router-dom";

import { OvrPill } from "@/components/bits";
import { extensionAsk } from "@/state/contracts";
import { planCoreResign } from "@/state/rules";
import { useStore } from "@/state/store";
import { millions, posLabel } from "@/util/format";

/**
 * Who walks at the end of this season unless the GM acts.
 *
 * A deal that runs out sends the player to the open market the moment the
 * season is finalized, and nothing said so: a GM who never opened Roster &
 * Cap lost his starters one contract year at a time. The CPU teams re-sign
 * their core (`resignAiCore`); this is the same information for the human,
 * with the price each player is asking, while there is still time to act.
 */
export function ExpiringContracts({ teamCode }: { teamCode: string }) {
  const nav = useNavigate();
  const actions = useLeagueActions();
  const [note, setNote] = useState<Record<string, string>>({});
  // an extended player stops expiring, so his row disappeared the moment it
  // worked — with nothing to say it had
  const [done, setDone] = useState<string[]>([]);
  const players = useStore((s) => s.players);
  const expiring = useMemo(
    () =>
      Object.values(players)
        .filter(
          (p) =>
            p.nfl_team === teamCode &&
            !p.retired &&
            !p.free_agent &&
            p.contract &&
            p.contract.years_remaining <= 1 &&
            p.overall >= 70,
        )
        .sort((a, b) => b.overall - a.overall),
    [players, teamCode],
  );
  // a star staying away from the team until he is paid: CPU teams pay theirs
  // as camp opens (`startHoldouts`); a person sees it here, with his price
  const holdouts = useMemo(
    () => Object.values(players).filter((p) => p.holdout === teamCode && p.nfl_team === teamCode && !p.retired),
    [players, teamCode],
  );
  if (expiring.length === 0 && done.length === 0 && holdouts.length === 0) return null;
  const shown = expiring.slice(0, 5);

  return (
    <div className="notice" role="status" style={{ marginBottom: 16 }}>
      {done.map((line) => (
        <p key={line} style={{ margin: "0 0 8px", fontSize: 12, color: "var(--good)" }}>
          {line}
        </p>
      ))}
      {holdouts.map((p) => {
        const ask = extensionAsk(p);
        return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, marginBottom: 10 }}>
            <OvrPill value={p.overall} />
            <span>
              <strong>{p.name}</strong> ({posLabel(p.position)}) is holding out and won&rsquo;t play until he&rsquo;s paid or the deadline passes. He wants{" "}
              {millions(ask.baseSalary)}/yr × {ask.years}.
            </span>
            {note[p.id] ? (
              <span style={{ color: "var(--ink-dim)" }}>{note[p.id]}</span>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: 11, padding: "3px 8px", marginLeft: "auto" }}
                aria-label={`Pay ${p.name} his ask`}
                onClick={() => {
                  if (!confirm(`Extend ${p.name} for ${ask.years} more year${ask.years === 1 ? "" : "s"} at ${millions(ask.baseSalary)}/yr to end the holdout?`)) return;
                  setNote((n) => ({ ...n, [p.id]: "Extending…" }));
                  void actions.extend(p.id, ask).then((r) => {
                    setNote((n) => ({ ...n, [p.id]: r.ok ? "Signed; he reports" : (r.reason ?? "He turned it down.") }));
                    if (r.ok) setDone((d) => [...d, `${p.name} signed and ended his holdout.`]);
                  });
                }}
              >
                Pay him
              </button>
            )}
          </div>
        );
      })}
      {expiring.length > 0 && (
        <>
          <strong>
            {expiring.length === 1 ? "1 contract expires" : `${expiring.length} contracts expire`} after this season.
          </strong>{" "}
          Anyone not extended by then goes to free agency.
          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            {shown.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                <OvrPill value={p.overall} />
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: "var(--ink-faint)" }}>
                  {posLabel(p.position)} · age {p.age} · asking {millions(extensionAsk(p).baseSalary)}/yr × {extensionAsk(p).years}
                </span>
                {note[p.id] ? (
                  <span style={{ color: "var(--ink-dim)" }}>{note[p.id]}</span>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 11, padding: "3px 8px", marginLeft: "auto" }}
                    // five identical "Extend at his ask" buttons, to a screen reader
                    aria-label={`Extend ${p.name} at his ask`}
                    onClick={() => {
                      const ask = extensionAsk(p);
                      // years of money in one click: say how much first
                      if (
                        !confirm(
                          `Extend ${p.name} for ${ask.years} more year${ask.years === 1 ? "" : "s"} at ${millions(ask.baseSalary)}/yr (${millions(Math.round(ask.baseSalary * ask.years * 10) / 10)} in all)?`,
                        )
                      ) {
                        return;
                      }
                      // the button goes the moment it's pressed: on a slow
                      // server it sat live for seconds, asking to be pressed again
                      setNote((n) => ({ ...n, [p.id]: "Extending…" }));
                      void actions.extend(p.id, ask).then((r) => {
                        setNote((n) => ({ ...n, [p.id]: r.ok ? "Extended" : (r.reason ?? "He turned it down.") }));
                        if (r.ok) {
                          setDone((d) => [
                            ...d,
                            `${p.name} extended: ${ask.years} more year${ask.years === 1 ? "" : "s"} at ${millions(ask.baseSalary)}/yr.`,
                          ]);
                        }
                      });
                    }}
                  >
                    Extend at his ask
                  </button>
                )}
              </div>
            ))}
            {expiring.length > shown.length && (
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>and {expiring.length - shown.length} more</span>
            )}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {expiring.length > 0 && (
          // the CPU teams keep their core at season's end (`resignAiCore`); a
          // person's staff proposes the same list, within next year's budget,
          // and signs it only on a yes
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 11.5 }}
            onClick={() => {
              const plan = planCoreResign(useStore.getState(), teamCode).filter((x) => !note[x.player.id]);
              if (plan.length === 0) {
                alert("Your staff wouldn't extend anyone: nobody expiring is a starter worth his ask within next year's budget.");
                return;
              }
              const total = plan.reduce((n, x) => n + x.ask.baseSalary, 0);
              const list = plan.map((x) => `${x.player.name} (${posLabel(x.player.position)} ${x.player.overall}) ${millions(x.ask.baseSalary)}/yr × ${x.ask.years}`).join(", ");
              if (!confirm(`Your staff would extend ${list}: ${millions(Math.round(total * 10) / 10)} a year in all. Go ahead?`)) return;
              void (async () => {
                for (const { player, ask } of plan) {
                  setNote((n) => ({ ...n, [player.id]: "Extending…" }));
                  const r = await actions.extend(player.id, ask);
                  setNote((n) => ({ ...n, [player.id]: r.ok ? "Extended" : (r.reason ?? "He turned it down.") }));
                  if (r.ok) setDone((d) => [...d, `${player.name} extended: ${ask.years} more year${ask.years === 1 ? "" : "s"} at ${millions(ask.baseSalary)}/yr.`]);
                }
              })();
            }}
          >
            Let my staff re-sign the core
          </button>
        )}
        <button className="btn-ghost" style={{ fontSize: 11.5 }} onClick={() => nav("/roster")}>
          Extend on Roster &amp; Cap
        </button>
      </div>
    </div>
  );
}
