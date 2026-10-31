import { useMemo } from 'react';
import type { LeagueState } from '@/domain';
/** Invalidate measurements on every simulation input, never on ordinary UI renders. */
export function useProjectionContext(s: LeagueState, connection: string) {
    const inputs = useMemo(() => JSON.stringify([s.players, s.teams, s.coaches, s.depthChart, s.schedule, s.reveal, s.season, s.config, s.gamePlans, s.aiGms, s.gms, s.viewerGmId, s.offenseAdjust, s.stage, s.hoodedFigure, connection]), [s.players, s.teams, s.coaches, s.depthChart, s.schedule, s.reveal, s.season, s.config, s.gamePlans, s.aiGms, s.gms, s.viewerGmId, s.offenseAdjust, s.stage, s.hoodedFigure, connection]);
    // Equivalent polling snapshots must not restart an expensive measurement.
    return useMemo(() => ({ inputs }), [inputs]);
}
