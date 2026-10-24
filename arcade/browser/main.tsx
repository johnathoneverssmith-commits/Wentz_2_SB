import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { advance, createClock } from '../core/clock';
import { choosePlay, snap, nextDown, switchDefender, throwPass, contestPass, kickBall, clockText, fieldGoalInRange, opposite, situation, SAFETY_POINTS, TOUCHDOWN_POINTS, type DownState, type Play } from '../core/down';
import { EXTRA_POINT_POINTS, FIELD_GOAL_POINTS } from '../core/kick';
import type { Inputs } from '../core/simulation';
import { SAVE_KEY, encodeSave, decodeSave } from './save';
import { drawField } from './field';
import './style.css';
const names = { home: 'Bluebirds', away: 'Foxes' };
const ordinal = (n: number) => ['1st', '2nd', '3rd', '4th'][n - 1] ?? `${n}th`;
function initialClock() {
    const fresh = createClock();
    try {
        const saved = decodeSave(localStorage.getItem(SAVE_KEY));
        return saved ? { ...fresh, match: saved, paused: saved.phase === 'live' || (saved.phase === 'kick' && saved.kick?.good === null) } : fresh;
    }
    catch {
        return fresh;
    }
}
function Sandbox() {
    const canvas = useRef<HTMLCanvasElement>(null);
    const clock = useRef<ReturnType<typeof createClock> | null>(null);
    if (clock.current === null)
        clock.current = initialClock();
    const current = () => clock.current!;
    const keys = useRef(new Set<string>()), previous = useRef<number | null>(null);
    const [view, setView] = useState(current());
    const [storageWarning, setStorageWarning] = useState(false);
    const persist = () => {
        try {
            localStorage.setItem(SAVE_KEY, encodeSave(current().match));
        }
        catch {
            setStorageWarning(true);
        }
    };
    const publish = () => {
        setView(current());
        if (canvas.current)
            drawField(canvas.current, current().match, current().paused);
        persist();
    };
    const clearInput = () => { keys.current.clear(); previous.current = null; };
    const pause = () => { clearInput(); clock.current = { ...current(), paused: true, accumulator: 0 }; publish(); };
    const togglePause = () => { clearInput(); clock.current = { ...current(), paused: !current().paused, accumulator: 0 }; publish(); canvas.current?.focus(); };
    const restart = () => { clearInput(); clock.current = createClock(); publish(); canvas.current?.focus(); };
    const command = (update: (s: DownState) => DownState, clear = false) => {
        if (current().paused)
            return;
        if (clear)
            clearInput();
        clock.current = { ...current(), match: update(current().match), accumulator: clear ? 0 : current().accumulator };
        publish();
        canvas.current?.focus();
    };
    useEffect(() => {
        let frame = 0, lastPublished = 0;
        const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
        const actions: Record<string, (s: DownState) => DownState> = {
            KeyQ: s => throwPass(s, 1, 'home'), KeyE: s => throwPass(s, 2, 'home'),
            Comma: s => throwPass(s, 1, 'away'), Period: s => throwPass(s, 2, 'away'),
            KeyF: s => switchDefender(s, 'home'), Slash: s => switchDefender(s, 'away'),
            KeyR: s => contestPass(s, 'home'), ShiftRight: s => contestPass(s, 'away'),
            KeyG: s => kickBall(s, 'home'), Quote: s => kickBall(s, 'away'),
        };
        const actionKeys = new Set(['Enter', ...Object.keys(actions)]);
        const keydown = (e: KeyboardEvent) => {
            if ((!movementKeys.has(e.code) && !actionKeys.has(e.code)) || e.altKey || e.ctrlKey || e.metaKey)
                return;
            if (e.target instanceof HTMLElement && e.target.closest('button,input,select,textarea,a,summary,[contenteditable]'))
                return;
            e.preventDefault();
            if (e.repeat || current().paused)
                return;
            if (movementKeys.has(e.code))
                keys.current.add(e.code);
            else if (e.code === 'Enter') {
                const phase = current().match.phase;
                if (phase === 'pre-snap')
                    command(snap, true);
                else if (phase === 'dead' || (phase === 'kick' && current().match.kick?.good !== null))
                    command(nextDown, true);
            }
            else
                command(actions[e.code]!);
        };
        const keyup = (e: KeyboardEvent) => { keys.current.delete(e.code); };
        const hidden = () => {
            if (document.hidden)
                pause();
        };
        const animate = (now: number) => {
            const elapsed = previous.current === null ? 0 : (now - previous.current) / 1000;
            previous.current = now;
            const held = (key: string) => Number(keys.current.has(key));
            const inputs: Inputs = { home: { x: held('KeyD') - held('KeyA'), y: held('KeyS') - held('KeyW') }, away: { x: held('ArrowRight') - held('ArrowLeft'), y: held('ArrowDown') - held('ArrowUp') } };
            const before = current().match;
            clock.current = advance(current(), elapsed, inputs);
            if (canvas.current)
                drawField(canvas.current, current().match, current().paused);
            if (now - lastPublished >= 100 || before.phase !== current().match.phase) {
                publish();
                lastPublished = now;
            }
            else if (before !== current().match)
                persist();
            frame = requestAnimationFrame(animate);
        };
        window.addEventListener('keydown', keydown);
        window.addEventListener('keyup', keyup);
        window.addEventListener('blur', pause);
        document.addEventListener('visibilitychange', hidden);
        frame = requestAnimationFrame(animate);
        return () => { cancelAnimationFrame(frame); clearInput(); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', hidden); };
    }, []);
    const state = view.match, result = state.result, sit = situation(state), kick = state.kick;
    const kickDone = state.phase === 'kick' && kick?.good !== null;
    const preview = state.phase === 'dead' || kickDone ? nextDown(state) : null;
    const down = (d: DownState) => `${ordinal(d.down)} & ${situation(d).goalToGo ? 'Goal' : situation(d).toGo.toFixed(1)}`;
    const periodName = (d: DownState) => d.mode === 'overtime' ? 'Overtime' : `Q${d.quarter}`;
    const kickHeadline = !kick ? '' : kick.good === null ? `${kick.kind === 'xp' ? 'Extra point' : 'Field goal'} — ${names[kick.team]}: stop the meter in the green` : kick.good ? (kick.kind === 'xp' ? `Extra point is good! ${names[kick.team]} +${EXTRA_POINT_POINTS}` : `Field goal is good! ${names[kick.team]} +${FIELD_GOAL_POINTS}`) : (kick.kind === 'xp' ? 'Extra point is no good' : 'Field goal is no good');
    const headline = state.phase === 'final' ? (state.winner === 'draw' ? 'Final: a draw' : `Final: ${names[state.winner as 'home' | 'away']} win`) : state.phase === 'kick' ? kickHeadline : !result ? 'Choose your play' : result.touchdown ? `Touchdown! ${names[state.offense]} +${TOUCHDOWN_POINTS}` : result.reason === 'safety' ? `Safety! ${names[opposite(state.offense)]} +${SAFETY_POINTS}` : result.reason === 'interception' ? 'Intercepted!' : result.turnoverOnDowns ? 'Turnover on downs' : result.firstDown ? 'First down!' : result.reason === 'incomplete' ? 'Incomplete pass' : `Play ended: ${result.reason}`;
    const clockNote = state.expired ? (state.quarter === 2 ? 'Time: halftime follows this play' : state.quarter === 4 ? 'Time: the game ends after this play' : 'Time: the quarter ends after this play') : '';
    const detail = state.phase === 'kick' ? (kick!.good === null ? `${kick!.distance}-yard attempt · ${names[kick!.team]} press ${kick!.team === 'home' ? 'G' : "'"} to kick` : `${kick!.distance}-yard attempt · meter locked at ${kick!.lockedAt} of ${kick!.good ? 'a good window' : 'a missed window'}`) : state.phase === 'final' ? `${names.home} ${state.score.home} – ${state.score.away} ${names.away}` : result ? `${names[state.offense]}: ${result.yards.toFixed(1)} offensive yards · Turnover: ${result.turnover || result.turnoverOnDowns ? 'Yes' : 'No'} · Touchdown: ${result.touchdown ? 'Yes' : 'No'}` : `Snap to begin. ${names[state.offense]} attacks ${state.offense === 'home' ? 'right' : 'left'}.`;
    const nextLine = !preview ? '' : preview.phase === 'final' ? `Final: ${preview.winner === 'draw' ? 'a draw' : `${names[preview.winner as 'home' | 'away']} win`}` : preview.phase === 'kick' ? `Next: ${names[preview.kick!.team]} kick the extra point` : `Next: ${names[preview.offense]} ball, ${down(preview)}${preview.mode !== state.mode ? ' · overtime begins' : preview.quarter !== state.quarter ? ` · ${preview.quarter === 3 ? 'second half' : `Q${preview.quarter}`} begins` : ''}`;
    const kicking = state.phase === 'kick', over = state.phase === 'final';
    return <main>
  <header><div><p className="series">Wentz 2 SB / Arcade lab</p><h1>Backyard football</h1><p className="intro">Two players. One keyboard. Four quarters, a kicker and a winner.</p></div><div className="actions"><button onClick={togglePause} disabled={over}>{view.paused ? 'Resume' : 'Pause'}</button><button className="secondary" onClick={restart}>Restart</button></div></header>
  <section className="stadium" aria-label="Playable football game">
   <div className="scoreboard"><div className="team blue"><span className="swatch"/>Bluebirds <b data-testid="score-home" className="points">{state.score.home}</b> <small>Player 1 · WASD</small></div><div className="drill"><strong data-testid="period">{periodName(state)}{state.mode === 'regulation' ? <> · <span data-testid="clock">{clockText(state.clock)}</span></> : null}</strong><span data-testid="situation">{over ? 'Final' : kicking ? (kick!.kind === 'xp' ? 'Extra point' : 'Field goal') : down(state)}</span><small><span data-testid="phase">{view.paused ? 'Paused' : state.phase === 'pre-snap' ? 'Pre-snap' : state.phase === 'live' ? 'Live play' : state.phase === 'kick' ? 'Kicking' : state.phase === 'final' ? 'Game over' : 'Play complete'}</span> · Play {state.playNumber} · {names[state.offense]} ball</small></div><div className="team orange">Foxes <b data-testid="score-away" className="points">{state.score.away}</b> <span className="swatch"/><small>Player 2 · Arrow keys</small></div></div>
   <canvas ref={canvas} width={1200} height={560} tabIndex={0} role="img" aria-label="Football field with ten numbered players; white rings mark human players and a gold ring marks the ball carrier" onClick={() => canvas.current?.focus()}/>
   <div className="field-footer"><span><span className="ball"/>{names[state.possession.team]} possession{state.ball.kind === 'flight' ? ' · Ball in flight' : ` · #${state.possession.carrier.split('-')[1]}`}</span><span>{state.phase === 'dead' || kickDone ? `Next offense: ${names[preview!.offense]}` : kicking || over ? clockNote : `Defense: ${names[opposite(state.offense)]} #${state.defender.split('-')[1]} · ${state.offense === 'home' ? 'Attack →' : '← Attack'}`}</span></div>
  </section>
  {over && <section className="final" data-testid="final" role="alert"><h2 data-testid="final-headline">{headline}</h2><p data-testid="final-score">{names.home} {state.score.home} – {state.score.away} {names.away}</p><button onClick={restart}>Rematch</button></section>}
  <section className="play-controls" aria-label="Play controls">
   <label>Play <select aria-label="Play" value={state.play} disabled={state.phase !== 'pre-snap' || view.paused} onChange={e => command(s => choosePlay(s, e.target.value as Play))}><option value="rush">Handoff</option><option value="slants">Slants</option><option value="go">Go routes</option><option value="fieldgoal" disabled={state.phase === 'pre-snap' && !fieldGoalInRange(state)}>Field goal</option></select></label>
   <button disabled={view.paused || state.phase !== 'pre-snap'} onClick={() => command(snap, true)}>{state.play === 'fieldgoal' ? 'Kick field goal' : 'Snap'}</button>
   <button disabled={view.paused || !kicking || kick!.good !== null} onClick={() => command(s => kickBall(s, s.kick!.team))}>Kick ({kick?.team === 'away' ? "'" : 'G'})</button>
   <button disabled={view.paused || state.phase !== 'live' || state.play === 'rush' || state.ball.kind === 'flight' || !state.possession.carrier.endsWith('-1')} onClick={() => command(s => throwPass(s, 1))}>Pass to #3 ({state.offense === 'home' ? 'Q' : ','})</button>
   <button disabled={view.paused || state.phase !== 'live' || state.play === 'rush' || state.ball.kind === 'flight' || !state.possession.carrier.endsWith('-1')} onClick={() => command(s => throwPass(s, 2))}>Pass to #4 ({state.offense === 'home' ? 'E' : '.'})</button>
   <button disabled={view.paused || (state.phase !== 'live' && state.phase !== 'pre-snap')} onClick={() => command(switchDefender)}>Switch defender ({state.offense === 'home' ? '/' : 'F'})</button>
   <button disabled={view.paused || state.phase !== 'live' || state.ball.kind !== 'flight'} onClick={() => command(s => contestPass(s, opposite(s.offense)))}>Hands ({state.offense === 'home' ? 'Right Shift' : 'R'})</button>
   <button disabled={view.paused || !(state.phase === 'dead' || kickDone)} onClick={() => command(nextDown, true)}>Next down</button>
  </section>
  <p data-testid="terminal-count">Completed plays: {state.terminalCount}</p>
  <section className="result" aria-live="polite"><h2 data-testid="headline">{headline}</h2><p data-testid="result">{detail}</p>{clockNote && !over && <p data-testid="clock-note">{clockNote}</p>}{nextLine && <p data-testid="next-situation">{nextLine}</p>}</section>
  {storageWarning && <p role="status">Arcade saving is unavailable. You can continue playing without a save.</p>}
  <section className="instructions" aria-label="How to play"><h2>Win the game.</h2>
    <p>Four 3-minute quarters on a game clock that runs only while a play is live (a tenth of a game second per simulation tick, so a quarter is half a minute of live play). A play in progress always finishes; the quarter then ends, halftime gives Orange the ball, and a tie goes to overtime: each team gets a possession from its own 28, first downs extend it, and the score is compared after both. Touchdown 6, extra point 1, field goal 3, safety 2.</p>
    <p>Blue: <kbd>WASD</kbd> move, <kbd>Q / E</kbd> pass, <kbd>F</kbd> switch and <kbd>R</kbd> hands on defense, <kbd>G</kbd> kick. Orange: arrow keys move, <kbd>, / .</kbd> pass, <kbd>/</kbd> switch and <kbd>Right Shift</kbd> hands, <kbd>'</kbd> kick. <kbd>Enter</kbd> snaps and starts the next down. Choose <b>Field goal</b> in the play menu when the kick is in range (up to 57 yards); a touchdown goes straight to the extra point.</p>
    <p>The kick meter swings by itself: press your kick key as it crosses the centre. The green zone is the margin that counts; it is wide for an extra point and narrow for a long field goal. The landing circle shows where a pass will arrive; break it up by standing there and intercept by pressing Hands as it lands. Blockers hold the closest defenders.</p>
  </section>
  <details><summary>Player positions <span>yards from the left end and upper sideline</span></summary><table><thead><tr><th>Player</th><th>Control</th><th>X</th><th>Y</th></tr></thead><tbody>{state.players.map(p => <tr key={p.id}><th>{names[p.team]} #{p.number}</th><td>{p.human ? 'Human' : 'AI'}</td><td data-testid={`${p.id}-x`}>{p.x.toFixed(2)}</td><td data-testid={`${p.id}-y`}>{p.y.toFixed(2)}</td></tr>)}</tbody></table></details>
  <footer>Local game <span>Only an arcade save. No franchise data. No server connection.</span></footer>
 </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Sandbox /></StrictMode>);
