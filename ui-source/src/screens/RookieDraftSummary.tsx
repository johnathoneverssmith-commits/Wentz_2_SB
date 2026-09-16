import { useNavigate } from "react-router-dom";

import { useLeagueActions } from "@/state/useLeagueActions";

import { FantasyDraftSummary } from "./FantasyDraftSummary";

/**
 * How the rookie draft graded out.
 *
 * The same screen as the fantasy draft summary, because it answers the same
 * question about a different draft — and the button on the far side is the
 * only real difference. This one is not a checkpoint: it steps this GM into
 * rookie signings alone, and the league does not gather again until free
 * agency.
 */
export function RookieDraftSummary() {
  const nav = useNavigate();
  const actions = useLeagueActions();

  return (
    <FantasyDraftSummary
      title="Rookie Draft Summary"
      advanceLabel="Continue to Rookie Signings"
      onAdvance={async () => {
        const res = await actions.stepForward("rookieSignings");
        if (res.ok) nav("/rookie-signings");
        else alert(res.reason ?? "Couldn't advance.");
      }}
    />
  );
}
