import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { advance, createClock } from '../core/clock';
import { choosePlay, snap, nextDown, switchDefender, throwPass, contestPass, opposite, situation, SAFETY_POINTS, TOUCHDOWN_POINTS, type DownState, type Play } from '../core/down';
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
        return saved ? { ...fresh, match: saved, paused: saved.phase === 'live' } : fresh;
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
                if (current().match.phase !== 'live')
                    command(current().match.phase === 'dead' ? nextDown : snap, true);
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
    const state = view.match, result = state.result, sit = situation(state), preview = state.phase === 'dead' ? nextDown(state) : null;
    const headline = !result ? 'Choose your play' : result.touchdown ? `Touchdown! ${names[state.offense]} +${TOUCHDOWN_POINTS}` : result.reason === 'safety' ? `Safety! ${names[opposite(state.offense)]} +${SAFETY_POINTS}` : result.reason === 'interception' ? 'Intercepted!' : result.turnoverOnDowns ? 'Turnover on downs' : result.firstDown ? 'First down!' : result.reason === 'incomplete' ? 'Incomplete pass' : `Play ended: ${result.reason}`;
    return <main>
  <header><div><p className="series">Wentz 2 SB / Arcade lab</p><h1>Backyard football</h1><p className="intro">Two players. One keyboard. One playable down.</p></div><div className="actions"><button onClick={togglePause}>{view.paused ? 'Resume' : 'Pause'}</button><button className="secondary" onClick={restart}>Restart</button></div></header>
  <section className="stadium" aria-label="Playable football down">
   <div className="scoreboard"><div className="team blue"><span className="swatch"/>Bluebirds <b data-testid="score-home" className="points">{state.score.home}</b> <small>Player 1 · WASD</small></div><div className="drill"><strong data-testid="situation">{ordinal(state.down)} &amp; {sit.goalToGo ? 'Goal' : sit.toGo.toFixed(1)}</strong><small>Play {state.playNumber} · {names[state.offense]} ball</small><span data-testid="phase">{view.paused ? 'Paused' : state.phase === 'pre-snap' ? 'Pre-snap' : state.phase === 'live' ? 'Live play' : 'Play complete'}</span></div><div className="team orange">Foxes <b data-testid="score-away" className="points">{state.score.away}</b> <span className="swatch"/><small>Player 2 · Arrow keys</small></div></div>
   <canvas ref={canvas} width={1200} height={560} tabIndex={0} role="img" aria-label="Football field with ten numbered players; white rings mark human players and a gold ring marks the ball carrier" onClick={() => canvas.current?.focus()}/>
   <div className="field-footer"><span><span className="ball"/>{names[state.possession.team]} possession{state.ball.kind === 'flight' ? ' · Ball in flight' : ` · #${state.possession.carrier.split('-')[1]}`}</span><span>{state.phase === 'dead' ? `Next offense: ${names[state.result?.turnover ? opposite(state.offense) : state.offense]}` : `Defense: ${names[opposite(state.offense)]} #${state.defender.split('-')[1]} · ${state.offense === 'home' ? 'Attack →' : '← Attack'}`}</span></div>
  </section>
  <section className="play-controls" aria-label="Play controls">
   <label>Play <select aria-label="Play" value={state.play} disabled={state.phase !== 'pre-snap' || view.paused} onChange={e => command(s => choosePlay(s, e.target.value as Play))}><option value="rush">Handoff</option><option value="slants">Slants</option><option value="go">Go routes</option></select></label>
   <button disabled={view.paused || state.phase !== 'pre-snap'} onClick={() => command(snap, true)}>Snap</button>
   <button disabled={view.paused || state.phase !== 'live' || state.play === 'rush' || state.ball.kind === 'flight' || !state.possession.carrier.endsWith('-1')} onClick={() => command(s => throwPass(s, 1))}>Pass to #3 ({state.offense === 'home' ? 'Q' : ','})</button>
   <button disabled={view.paused || state.phase !== 'live' || state.play === 'rush' || state.ball.kind === 'flight' || !state.possession.carrier.endsWith('-1')} onClick={() => command(s => throwPass(s, 2))}>Pass to #4 ({state.offense === 'home' ? 'E' : '.'})</button>
   <button disabled={view.paused || state.phase === 'dead'} onClick={() => command(switchDefender)}>Switch defender ({state.offense === 'home' ? '/' : 'F'})</button>
   <button disabled={view.paused || state.phase !== 'live' || state.ball.kind !== 'flight'} onClick={() => command(s => contestPass(s, opposite(s.offense)))}>Hands ({state.offense === 'home' ? 'Right Shift' : 'R'})</button>
   <button disabled={view.paused || state.phase !== 'dead'} onClick={() => command(nextDown, true)}>Next down</button>
  </section>
  <p data-testid="terminal-count">Completed plays: {state.terminalCount}</p>
  <section className="result" aria-live="polite"><h2 data-testid="headline">{headline}</h2><p data-testid="result">{result ? `${names[state.offense]}: ${result.yards.toFixed(1)} offensive yards · Turnover: ${result.turnover || result.turnoverOnDowns ? 'Yes' : 'No'} · Touchdown: ${result.touchdown ? 'Yes' : 'No'}` : `Snap to begin. ${names[state.offense]} attacks ${state.offense === 'home' ? 'right' : 'left'}.`}</p>{preview && <p data-testid="next-situation">Next: {names[preview.offense]} ball, {ordinal(preview.down)} &amp; {situation(preview).goalToGo ? 'Goal' : situation(preview).toGo.toFixed(1)}</p>}</section>
  {storageWarning && <p role="status">Arcade saving is unavailable. You can continue playing without a save.</p>}
  <section className="instructions" aria-label="How to play"><h2>Position. Time your hands.</h2>
    <p>Blue: <kbd>WASD</kbd> move, <kbd>Q / E</kbd> pass on offense, <kbd>F</kbd> switch and <kbd>R</kbd> hands on defense. Orange: arrow keys move, <kbd>, / .</kbd> pass on offense, <kbd>/</kbd> switch and <kbd>Right Shift</kbd> hands on defense. Each player keeps their keys after a turnover. Snap / Next down: <kbd>Enter</kbd>.</p>
    <p>The landing circle shows where the one-second pass will arrive. Move a defender there to break it up. Press Hands near arrival (a 0.6-second window) and be within the smaller catch radius to intercept. Early hands expire; switching cancels the window. AI covers receivers before a throw, contests the landing point in flight and pursues a carrier after a catch. Touch the carrier to tackle.</p>
    <p>White rings = human control; gold = carrier. Interceptions end immediately and award zero offensive yards; possession changes for the next down. This is a practice loop without first downs, four-down limits, blocking or a scoreboard. A play ends after 15 seconds. Losing focus pauses and clears input; click the field to restore keyboard focus.</p>
  </section>
  <details><summary>Player positions <span>yards from the left end and upper sideline</span></summary><table><thead><tr><th>Player</th><th>Control</th><th>X</th><th>Y</th></tr></thead><tbody>{state.players.map(p => <tr key={p.id}><th>{names[p.team]} #{p.number}</th><td>{p.human ? 'Human' : 'AI'}</td><td data-testid={`${p.id}-x`}>{p.x.toFixed(2)}</td><td data-testid={`${p.id}-y`}>{p.y.toFixed(2)}</td></tr>)}</tbody></table></details>
  <footer>Local practice <span>Only an arcade save. No franchise data. No server connection.</span></footer>
 </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Sandbox /></StrictMode>);
