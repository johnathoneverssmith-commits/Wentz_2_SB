/** `npm --prefix arcade run balance` prints these measurements. They describe the rules against scripted players; they assert nothing. */
import { mix } from '../core/seed';
import { DEFENSES, DEFENSE_TEXT, OFFENSES, drive, emptyStats, game, minutes, sum, type DefensePolicy, type OffensePolicy, type Stats, type Team } from './sim';

export const STARTS = [28, 38, 50, 62, 74, 86, 98] as const;
const pad = (v: string | number, n: number) => String(v).padEnd(n);
const num = (v: number, d = 1) => v.toFixed(d);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');

export function driveStats(off: OffensePolicy, def: DefensePolicy, reaction = 12) {
    let st: Stats = emptyStats(); const ends: Record<string, number> = {}; let n = 0;
    for (const team of ['home', 'away'] as const)
        for (const l of STARTS) {
            // each drive is its own game, so each gets its own seed (catches are chance): the same drives always give the same totals
            const r = drive(team, team === 'home' ? l : 120 - l, off, def, { reaction, thinkTicks: 0 }, mix(0xd51e, l, team === 'home' ? 0 : 1));
            st = sum(st, r.stats); ends[r.end] = (ends[r.end] ?? 0) + 1; n++;
        }
    return { st, ends, n, pointsPerDrive: st.points / n, td: (ends['touchdown'] ?? 0) / n };
}

export function printReport(label: string): void {
    console.log(`\n=== ${label} ===`);
    console.log('\nDrive matrix (7 starting spots x both teams, reaction 12 ticks; points include the point after or field goal)');
    console.log(pad('offense', 22), pad('defense', 12), 'pts/drive  TD%  FG%  lost%  plays/drive  live/play  comp%  INT%  rush yd/att');
    for (const [key, off] of Object.entries(OFFENSES)) for (const def of DEFENSES) {
        const r = driveStats(off, def);
        const lost = ((r.ends['interception'] ?? 0) + (r.ends['downs'] ?? 0) + (r.ends['safety'] ?? 0)) / r.n;
        const fg = ((r.ends['field goal'] ?? 0) + (r.ends['missed field goal'] ?? 0)) / r.n;
        console.log(pad(key, 22), pad(def, 12), num(r.pointsPerDrive, 2).padStart(9), pct(r.td * r.n, r.n).padStart(5), pct(fg * r.n, r.n).padStart(4), pct(lost * r.n, r.n).padStart(6), num(r.st.plays / r.n).padStart(11), num(r.st.liveTicks / Math.max(1, r.st.plays), 0).padStart(10), pct(r.st.completions, r.st.passes).padStart(6), pct(r.st.interceptions, r.st.passes).padStart(5), r.st.rushes ? num(r.st.rushYards / r.st.rushes) : '-');
    }
    console.log('\nReaction sweep: points per drive against a defender who starts for the ball this many ticks after the throw');
    for (const def of ['attentive', 'cover'] as const) for (const reaction of [0, 12, 24, 36])
        console.log(pad(def, 10), `reaction ${String(reaction).padStart(2)}:`, Object.entries(OFFENSES).map(([k, o]) => `${k} ${num(driveStats(o, def, reaction).pointsPerDrive)}`).join('  '));
    console.log('\nWhole regulation games (think = real seconds a player takes before each snap; minutes = live + think + 3 s per kick)');
    console.log(pad('matchup', 46), 'think  plays  possessions  live/play  minutes  score      TD  FG   INT  comp%');
    const same = (key: string, def: DefensePolicy): Team => ({ off: OFFENSES[key]!, def });
    const pairs: [string, Team, Team][] = [
        ['rush + chase  vs the same', same('rush', 'chase'), same('rush', 'chase')],
        ['early + attentive vs the same', same('early', 'attentive'), same('early', 'attentive')],
        ['intermediate + attentive vs the same', same('intermediate', 'attentive'), same('intermediate', 'attentive')],
        ['late + attentive vs the same', same('late', 'attentive'), same('late', 'attentive')],
        ['balanced + attentive vs the same', same('balanced', 'attentive'), same('balanced', 'attentive')],
        ['balanced + cover vs the same', same('balanced', 'cover'), same('balanced', 'cover')],
        ['balanced + cover vs late + idle', same('balanced', 'cover'), same('late', 'idle')],
    ];
    for (const [name, h, a] of pairs) for (const think of [2, 4, 8]) {
        const g = game(h, a, { reaction: 12, thinkTicks: think * 60 });
        const t = g.stats;
        console.log(pad(name, 46), String(think).padStart(5), String(t.plays).padStart(6), `${g.possessions.home}/${g.possessions.away}`.padStart(12), num(t.liveTicks / Math.max(1, t.plays), 0).padStart(10), num(minutes(g)).padStart(8), pad(`${g.score.home}-${g.score.away}${g.ended === 'overtime' ? ' OT' : ''}`, 10), String(t.touchdowns).padStart(3), String(t.fieldGoals).padStart(3), String(t.interceptions).padStart(5), pct(t.completions, t.passes).padStart(6));
    }
}
if (process.argv[1] && /report\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) printReport(process.env.BALANCE_LABEL ?? 'balance report');
