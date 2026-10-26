import { describe, expect, it } from 'vitest';
import { choosePlay, lineUp, snap, direction, type Play } from '../core/down';
import { DEFENSE_CODES, DEFENSE_FORMATIONS, FRANCHISE_POSITION, JERSEY, OFFENSE_CODES, OFFENSE_FORMATIONS, baseAbilities, chooseFormations, codeOf, positionOfCode, playerId } from '../core/personnel';
import { FIELD, BODY } from '../core/simulation';

const PLAYS: Play[] = ['rush', 'slants', 'go'];
const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
const states = () => (['home', 'away'] as const).flatMap(team => PLAYS.flatMap(play => [1, 2, 3, 4].map(n => ({ team, play, n, state: choosePlay(lineUp(team, team === 'home' ? 50 : 70, { playNumber: n, play: 'rush' }), play) }))));

describe('personnel and formations', () => {
    it('every snap has exactly 11 offensive and 11 defensive players, with unique persistent ids', () => {
        for (const { team, play, n, state } of states()) {
            const label = `${team} ${play} #${n}`;
            expect(state.players, label).toHaveLength(22);
            expect(state.players.filter(p => p.team === team), label).toHaveLength(11);
            expect(new Set(state.players.map(p => p.id)).size, label).toBe(22);
            for (const p of state.players) expect(p.id).toBe(`${p.team}-${codeOf(p.id)}`);
        }
    });
    it('the offense is a legal personnel group: one QB, five linemen, at least one back and at least two wideouts', () => {
        for (const { state } of states()) {
            const offense = state.players.filter(p => p.team === state.offense);
            expect(offense.filter(p => p.position === 'QB')).toHaveLength(1);
            expect(offense.filter(p => OL.includes(p.position)).map(p => p.position).sort()).toEqual([...OL].sort());
            expect(offense.filter(p => p.position === 'RB' || p.position === 'FB').length).toBeGreaterThanOrEqual(1);
            expect(offense.filter(p => p.position === 'WR').length).toBeGreaterThanOrEqual(2);
            expect(offense.filter(p => p.position === 'TE').length).toBeGreaterThanOrEqual(1);
        }
    });
    it('the defense is a legal front: four down linemen, linebackers, and at least four defensive backs', () => {
        for (const { state } of states()) {
            const defense = state.players.filter(p => p.team !== state.offense);
            expect(defense.filter(p => p.position === 'DE' || p.position === 'DT')).toHaveLength(4);
            expect(defense.filter(p => p.position === 'OLB' || p.position === 'MLB').length).toBeGreaterThanOrEqual(2);
            expect(defense.filter(p => p.position === 'CB' || p.position === 'FS' || p.position === 'SS').length).toBeGreaterThanOrEqual(4);
        }
    });
    it('every named formation fills 11 slots with distinct roster codes, and both personnel packages are used', () => {
        for (const [name, slots] of Object.entries(OFFENSE_FORMATIONS)) {
            expect(slots, name).toHaveLength(11);
            expect(new Set(slots.map(s => s.code)).size, name).toBe(11);
            for (const s of slots) expect(OFFENSE_CODES).toContain(s.code);
        }
        for (const [name, slots] of Object.entries(DEFENSE_FORMATIONS)) {
            expect(slots, name).toHaveLength(11);
            expect(new Set(slots.map(s => s.code)).size, name).toBe(11);
            for (const s of slots) expect(DEFENSE_CODES).toContain(s.code);
        }
        const used = new Set(states().map(s => `${s.state.formation.offense}/${s.state.formation.defense}`));
        expect(used).toEqual(new Set(['singleback/fourThree', 'iformation/fourThree', 'shotgun/nickel']));
        expect(choosePlay(lineUp('home', 50, { playNumber: 2 }), 'go').formation).toEqual({ offense: 'shotgun', defense: 'nickel' });
        expect(chooseFormations('rush', 2)).toEqual({ offense: 'iformation', defense: 'fourThree' });
    });
    it('no two players overlap at the snap, in any formation, for either team', () => {
        for (const { team, play, n, state } of states()) {
            for (let i = 0; i < 22; i++)
                for (let j = i + 1; j < 22; j++) {
                    const a = state.players[i]!, b = state.players[j]!;
                    expect(Math.hypot(a.x - b.x, a.y - b.y), `${team} ${play} #${n}: ${a.id} and ${b.id}`).toBeGreaterThanOrEqual(BODY * 1.4);
                }
        }
    });
    it('the offense lines up behind the line of scrimmage, the defense in front of it, inside the field and facing the right way', () => {
        for (const { team, state } of states()) {
            const dir = direction(team);
            for (const p of state.players) {
                const ahead = (p.x - state.line) * dir;
                if (p.team === team) expect(ahead, p.id).toBeLessThan(0); else expect(ahead, p.id).toBeGreaterThan(0);
                expect(p.x).toBeGreaterThan(FIELD.radius); expect(p.x).toBeLessThan(FIELD.length - FIELD.radius);
                expect(p.y).toBeGreaterThan(FIELD.radius); expect(p.y).toBeLessThan(FIELD.width - FIELD.radius);
            }
        }
    });
    it('a player keeps his id, position and jersey from play to play (so a franchise roster can attach to him)', () => {
        const a = lineUp('home', 50, { playNumber: 1 }), b = choosePlay(lineUp('home', 50, { playNumber: 2 }), 'go');
        for (const code of ['QB', 'WR1', 'LT', 'C']) {
            const pa = a.players.find(p => p.id === playerId('home', code as never))!, pb = b.players.find(p => p.id === playerId('home', code as never))!;
            expect([pa.position, pa.number]).toEqual([pb.position, pb.number]);
            expect(pa.number).toBe(JERSEY[code as never]);
        }
        const jerseys = OFFENSE_CODES.map(c => JERSEY[c]);
        expect(new Set(jerseys).size).toBe(jerseys.length);
    });
    it('every position maps to a franchise position and has a full ability profile (the 5C integration point)', () => {
        for (const code of [...OFFENSE_CODES, ...DEFENSE_CODES]) {
            const pos = positionOfCode(code);
            expect(FRANCHISE_POSITION[pos], pos).toMatch(/^(QB|RB|WR|TE|OT|OG|C|EDGE|DT|ILB|OLB|CB|S)$/);
            const abilities = baseAbilities(pos);
            for (const v of Object.values(abilities)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(99); }
        }
        expect(baseAbilities('CB').speed).toBeGreaterThan(baseAbilities('LT').speed);
        expect(baseAbilities('LT').strength).toBeGreaterThan(baseAbilities('WR').strength);
    });
    it('a snap assigns every player a role: routes, blocks, coverage or rush, never none', () => {
        for (const play of PLAYS) {
            const s = snap(choosePlay(lineUp('home', 50, { playNumber: 1 }), play));
            for (const p of s.players) expect(p.behavior, `${play} ${p.id}`).not.toBe('stance');
            if (play !== 'rush') {
                for (const code of ['WR1', 'WR2', 'TE1']) expect(s.players.find(p => p.id === `home-${code}`)!.assign?.points?.length, `${play} ${code} route`).toBeGreaterThan(0);
                for (const code of ['LT', 'LG', 'C', 'RG', 'RT']) expect(s.players.find(p => p.id === `home-${code}`)!.behavior).toBe('passBlock');
            }
            else for (const code of ['LT', 'LG', 'C', 'RG', 'RT']) expect(s.players.find(p => p.id === `home-${code}`)!.behavior).toBe('runBlock');
            for (const code of ['DE1', 'DE2', 'DT1', 'DT2']) expect(s.players.find(p => p.id === `away-${code}`)!.behavior).toBe('rush');
            for (const code of ['CB1', 'CB2']) { const cb = s.players.find(p => p.id === `away-${code}`)!; expect(cb.behavior).toBe('man'); expect(cb.assign?.target).toMatch(/^home-WR/); }
        }
    });
    it('cornerbacks cover the receiver on their own side', () => {
        const s = snap(choosePlay(lineUp('home', 50, { playNumber: 1 }), 'go'));
        const target = (cb: string) => s.players.find(p => p.id === `away-${cb}`)!.assign!.target;
        const cb1 = s.players.find(p => p.id === 'away-CB1')!, cb2 = s.players.find(p => p.id === 'away-CB2')!;
        expect(Math.sign(s.players.find(p => p.id === target('CB1'))!.y - 26.67)).toBe(Math.sign(cb1.y - 26.67));
        expect(Math.sign(s.players.find(p => p.id === target('CB2'))!.y - 26.67)).toBe(Math.sign(cb2.y - 26.67));
    });
});
