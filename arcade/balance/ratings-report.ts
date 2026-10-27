/**
 * `npm --prefix arcade run balance:ratings` prints how catch outcomes respond to player ratings (Phase C1b-1): receiver hands, defender
 * coverage and defender hands, over the whole pocket of both routes to both wideouts, under several game seeds, with 95% intervals. It
 * describes the rules and asserts nothing.
 */
import { rates, sweep, tickRange, type ThrowRecord } from './window';

const seeds = Array.from({ length: 8 }, (_, i) => i + 1), ticks = tickRange(0, 200, 4);
const pct = (x: number) => String(Math.round(100 * x)).padStart(3);
const line = (rs: ThrowRecord[]) => {
    const r = rates(rs);
    return `complete ${pct(r.complete.p)}% [${pct(r.complete.ci.lo)}-${pct(r.complete.ci.hi)}]  of which contested ${pct(r.contested.p)}%  intercepted ${pct(r.interception.p)}%  knocked down ${pct(r.breakup.p)}%  (n ${r.throws})`;
};
const all = (abilities: Record<string, Record<string, number>>) => sweep({ plays: ['slants', 'go'], targets: [1, 2], ticks, seeds, stopAtArrival: true, abilities: abilities as never });
const both = (ids: string[], ability: string, v: number) => Object.fromEntries(ids.map(id => [id, { [ability]: v }]));

export function main(): void {
    const wr = ['home-WR1', 'home-WR2'], cb = ['away-CB1', 'away-CB2'], defense = ['away-CB1', 'away-CB2', 'away-FS', 'away-SS', 'away-OLB1', 'away-OLB2', 'away-MLB'];
    const section = (title: string, ids: string[], ability: string, values: number[], keep?: (r: ThrowRecord) => boolean) => {
        console.log(`\n${title}`);
        for (const v of values) { const rs = all(both(ids, ability, v)); console.log(`  ${ability} ${String(v).padEnd(3)} ${line(keep ? rs.filter(keep) : rs)}`); }
    };
    console.log(`Rating sensitivity: both routes to both wideouts, every throw moment (ticks 0-200, every 4), game seeds ${seeds[0]}-${seeds.at(-1)}`);
    section('Receiver hands (both wideouts), every throw', wr, 'hands', [0, 30, 55, 78, 90, 99]);
    section('Receiver hands, only throws with a defender within 2.2 yd of the ball when it arrives (contested)', wr, 'hands', [30, 78, 99], r => r.defenderGap <= 2.2);
    section('Receiver hands, only throws with no defender within 3 yd (open): the receiver still has to hold it', wr, 'hands', [0, 30, 78, 99], r => r.defenderGap > 3);
    section('Defender coverage (both corners), every throw', cb, 'coverage', [0, 30, 55, 76, 90, 99]);
    section('Defender hands (both corners), every throw: hands decide intercepted against knocked down, not whether the pass is caught', cb, 'hands', [0, 30, 55, 80, 99]);
    section('Defender hands (every defender), only throws with a defender on the ball (within 1.6 yd)', defense, 'hands', [0, 30, 55, 80, 99], r => r.defenderGap <= 1.6);
}
if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('/ratings-report.ts')) main();
