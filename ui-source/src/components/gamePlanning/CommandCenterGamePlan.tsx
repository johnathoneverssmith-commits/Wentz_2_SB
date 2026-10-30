import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { MotionSurface } from '@/motion/MotionSurface';
import { useStore } from '@/state/store';
import { useLeagueActions } from '@/state/useLeagueActions';
import { viewerTeamCode } from '@/state/selectors';
import { cleanPlan, type GamePlan } from '@/state/gamePlan';
import { lastLeagueId, isOnline, onOnlineChange, onlineSession } from '@/state/online';
import { previewOpponent } from '@/state/planPreview';
import { revealedWeek } from '@/state/reveal';
import { canManagePlan } from './model';
import { PlanProjection } from './PlanProjection';
import { useProjectionContext } from './useProjectionContext';
import './game-planning.css';
const connection = () => isOnline() ? `online:${onlineSession()?.leagueId}` : lastLeagueId() ? 'detached' : 'solo';
const signed = (n: number) => n > 0 ? `+${n}` : `${n}`;
export function CommandCenterGamePlan() {
    const s = useStore();
    const actions = useLeagueActions();
    const mode = useSyncExternalStore(onOnlineChange, connection, () => 'solo');
    const code = viewerTeamCode(s);
    const allowed = canManagePlan(s, mode === 'detached');
    const saved = useMemo(() => cleanPlan(code ? s.gamePlans?.[code] : undefined), [code, s.gamePlans]);
    const [plan, setPlan] = useState<GamePlan>(saved);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const saving = useRef(false);
    const savedKey = JSON.stringify(saved);
    useEffect(() => { setPlan(saved); setNote(''); }, [savedKey, code, mode]);
    const context = useProjectionContext(s, mode === 'detached' ? mode : `${mode}:${onlineSession()?.version ?? ''}`);
    const next = s.stage === 'preseason' && code ? previewOpponent(s, code, revealedWeek(s, s.viewerGmId, 'PRE')) : null;
    const validNext = !!next && next.opponent !== code && !!s.teams[next.opponent] && Number.isInteger(next.week) && next.week > 0
        && [code, next.opponent].every(team => Object.values(s.players).some(p => p.nfl_team === team && !p.retired && !p.free_agent));
    if (!code)
        return null;
    const dirty = JSON.stringify(saved) !== JSON.stringify(plan);
    const change = (patch: Partial<GamePlan>) => { setNote(''); setPlan(p => cleanPlan({ ...p, ...patch })); };
    async function save() {
        if (saving.current || !allowed)
            return;
        saving.current = true;
        setBusy(true);
        setNote('');
        try {
            const r = await actions.saveGamePlan(plan);
            setNote(r.ok ? 'Game plan saved. Applies to games not yet simulated.' : r.reason ?? 'Could not save the game plan.');
        }
        catch (e) {
            setNote(e instanceof Error ? e.message : 'Could not save the game plan. Try again.');
        }
        finally {
            saving.current = false;
            setBusy(false);
        }
    }
    return <section role="region" aria-label="Command center game plan" className="command-center-game-plan"><MotionSurface className="ui-surface game-plan-card">
  <div className="ui-section-heading"><div><h2>Game Plan</h2><p>Your play calls for games not yet simulated</p></div><Link className="ui-text-link" to="/game-plan">Full playbook</Link></div>
  <div className="game-plan-layout"><div>
   <fieldset disabled={!allowed || busy}><legend>Offensive and defensive strategy</legend>
    <label htmlFor="hub-pass-bias">Offense: {plan.passRate === 0 ? 'Balanced' : plan.passRate > 0 ? 'Pass leaning' : 'Run leaning'} <strong>{signed(plan.passRate)} pts</strong></label>
    <input id="hub-pass-bias" type="range" min="-15" max="15" step="1" value={plan.passRate} aria-label="Offensive pass bias" aria-describedby="hub-pass-help" onChange={e => change({ passRate: Number(e.target.value) })}/>
    <p id="hub-pass-help">More passing uses your quarterback and receivers, but exposes protection to sacks and interceptions. A run lean uses your backs and blocking and shortens the game. These are percentage-point shifts to play calling.</p>
    <label htmlFor="hub-blitz-bias">Defense: {plan.blitz === 0 ? 'Standard pressure' : plan.blitz > 0 ? 'More blitzes' : 'Less blitzing'} <strong>{signed(plan.blitz)}</strong></label>
    <input id="hub-blitz-bias" type="range" min="-100" max="100" step="1" value={plan.blitz} aria-label="Defensive blitz bias" aria-describedby="hub-blitz-help" onChange={e => change({ blitz: Number(e.target.value) })}/>
    <p id="hub-blitz-help">Pressure works best with a strong rush, fast linebackers and coverage behind them. Extra blitzes risk big plays, particularly against a strong quarterback and offensive line.</p>
   </fieldset>
   <p className="ui-caption">Saved: offense {signed(saved.passRate)} pts · defense {signed(saved.blitz)}. Other playbook settings are preserved. {mode.startsWith('online:') ? 'Online blocks already simulated cannot be changed.' : 'The engine uses saved plans; the standalone offline fallback does not model these tactics.'}</p>
   {!allowed && <p role="status">{mode === 'detached' ? 'Reconnect to your league before changing its game plan.' : 'Only this team’s human GM can save its game plan.'}</p>}
   <div className="game-plan-actions"><button type="button" className="btn-primary" disabled={!allowed || !dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save game plan'}</button><button type="button" disabled={!dirty || busy} onClick={() => { setPlan(saved); setNote(''); }}>Discard changes</button></div>
   <p role="status">{note || (dirty ? 'Unsaved preview. Save to use this plan.' : 'Using your saved plan.')}</p>
  </div>
  {s.stage === 'preseason' ? (validNext && allowed ? <PlanProjection enabled context={context} saved={saved} plan={plan}/> : <aside className="game-plan-projection"><h3>Preseason matchup lab</h3><p>{!allowed ? 'Connect as this team’s GM to preview its plan.' : 'No valid scheduled opponent is available to preview.'}</p></aside>) : <aside className="game-plan-projection"><h3>Prepare your next game</h3><p>The matchup lab is available during preseason. Saved changes apply only to future simulations; they cannot change results already produced.</p></aside>}
  </div>
 </MotionSurface></section>;
}
