import { BETWEEN_PLAY_TICKS, QUARTER_TICKS, SAFETY_POINTS, TOUCHDOWN_POINTS, firstDownMarker, lineUp, type DownState, type Play } from '../core/down';
import { DEFENSE_CODES, DEFENSE_FORMATIONS, OFFENSE_CODES, OFFENSE_FORMATIONS, positionOfCode, type Code } from '../core/personnel';
import { KICK_MAX_TICKS } from '../core/kick';
import { FIELD } from '../core/simulation';
import { mix, validSeed } from '../core/seed';
import { CATCH_KINDS } from '../core/catch';
export const SAVE_KEY = 'wentz.arcade.down.v1';
export const encodeSave = (state: DownState) => JSON.stringify({ version: 7, state });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown) => finite(v) && Number.isSafeInteger(v) && v >= 0;
const point = (v: unknown) => object(v) && finite(v.x) && finite(v.y);
const team = (v: unknown) => v === 'home' || v === 'away';
const reasons = ['tackle', 'out-of-bounds', 'touchdown', 'incomplete', 'interception', 'safety', 'timeout'];
/**
 * Compatibility boundary: the last deployed save format is version 3 (Milestone 3, PR #28); versions 1-3 migrate. Version 4
 * was never released: several unreleased Milestone 4 builds wrote it with different clock units (30-second quarters, then
 * 180-second quarters), so it cannot be read safely and is rejected, never converted. Version 5 (ten players, five a side)
 * still migrates: the game, score, clock and situation carry over and the 22 players are lined up fresh. Version 6 (eleven
 * a side, with formations and assignments) still migrates unchanged. Version 7 adds the game's random seed (`core/seed.ts`); an older save
 * gets one derived from the game it holds, so loading the same old save always gives the same seed and nothing is re-rolled.
 */
export const SUPPORTED_VERSIONS: readonly number[] = [1, 2, 3, 5, 6, 7];
/** True when the text is a well-formed envelope of a version this build refuses to read (an unreleased or future format). */
export function isUnsupportedSave(text: string | null): boolean {
    try {
        const data: unknown = text ? JSON.parse(text) : null;
        return object(data) && typeof data.version === 'number' && !SUPPORTED_VERSIONS.includes(data.version);
    }
    catch {
        return false;
    }
}
/**
 * Older envelopes gain what they lacked: v1 had no completed-play count or hands window; v1/v2 had no score,
 * down or marker; v1-v3 had no game clock, quarter, kick, overtime or result. A finished touchdown or safety in an
 * old save is scored once here so no earlier score is lost. An old drive becomes the start of a new game's first
 * quarter with a full clock.
 */
function upgrade(version: number, old: Record<string, unknown>): Record<string, unknown> {
    let s = old;
    if (version === 1)
        s = { ...s, terminalCount: Number(s.playNumber) - (s.phase === 'dead' ? 0 : 1), contestUntil: 0 };
    if (version <= 2) {
        const result = object(s.result) ? s.result : null;
        const offense = s.offense === 'away' ? 'away' : 'home', other = offense === 'home' ? 'away' : 'home';
        const score = { home: 0, away: 0 };
        if (result?.reason === 'touchdown')
            score[offense] += TOUCHDOWN_POINTS;
        if (result?.reason === 'safety')
            score[other] += SAFETY_POINTS;
        s = { ...s, score, down: 1, firstDownLine: firstDownMarker(offense, Number(s.line)), result: result ? { ...result, firstDown: false, turnoverOnDowns: false } : null };
    }
    if (version <= 3)
        s = { ...s, quarter: 1, clock: QUARTER_TICKS, expired: false, gap: 0, mode: 'regulation', openingTeam: 'home', overtime: { first: 'away', possessions: 0 }, winner: null, kick: null };
    if (version <= 5)
        s = modernize(s);
    if (version <= 6)
        s = { ...s, seed: legacySeed(s) };
    return s;
}
/** The seed an older save gets: a fixed function of the game it holds, so the same save always loads with the same seed. */
function legacySeed(s: Record<string, unknown>): number {
    const n = (v: unknown) => finite(v) ? Math.trunc(Number(v)) : 0, score = object(s.score) ? s.score : {};
    return mix(0x5eed, n(s.playNumber), n(s.terminalCount), n(s.line), n(s.quarter), n(s.clock), n(score.home), n(score.away));
}
/**
 * Rebuilds a ten-player snapshot as an eleven-a-side one: everything about the game carries over, the players are lined up in
 * formation. A play that was live restarts from its snap (the same down, spot and clock); a finished down stays finished.
 */
function modernize(old: Record<string, unknown>): Record<string, unknown> {
    // Anything that is not a coherent old snapshot is left alone, so the validation below rejects it instead of it being repaired.
    if (![old.line, old.down, old.firstDownLine, old.playNumber, old.terminalCount].every(finite) || !Array.isArray(old.players) || !object(old.possession))
        return old;
    const offense = old.offense === 'away' ? 'away' : 'home';
    const play: Play = ['rush', 'slants', 'go', 'fieldgoal'].includes(String(old.play)) ? old.play as Play : 'rush';
    const num = (v: unknown, d: number) => finite(v) ? Number(v) : d;
    const base = lineUp(offense, num(old.line, 38), {
        down: num(old.down, 1), score: old.score as { home: number; away: number }, play, playNumber: Math.max(1, num(old.playNumber, 1)),
        game: { quarter: num(old.quarter, 1), clock: num(old.clock, QUARTER_TICKS), expired: !!old.expired, gap: num(old.gap, 0), mode: old.mode as 'regulation', openingTeam: old.openingTeam as 'home', overtime: old.overtime as { first: 'home'; possessions: number }, winner: (old.winner ?? null) as null, kick: (old.kick ?? null) as null },
    });
    const phase = old.phase === 'live' ? 'pre-snap' : String(old.phase);
    let result: DownState = { ...base, phase: phase as DownState['phase'], terminalCount: num(old.terminalCount, 0), firstDownLine: num(old.firstDownLine, base.firstDownLine), result: (phase === 'pre-snap' ? null : old.result ?? null) as DownState['result'] };
    if (phase === 'dead') {
        // A finished down keeps the spot where it ended: the old ball carrier's position carries over to the new carrier.
        const held = (old.players as Record<string, unknown>[]).find(q => q.id === (old.possession as Record<string, unknown>).carrier);
        const team = (old.possession as Record<string, unknown>).team === 'away' ? 'away' : 'home';
        const carrier = team === offense ? base.possession.carrier : `${team}-CB1` as DownState['possession']['carrier'];
        if (held && finite(held.x) && finite(held.y))
            result = { ...result, possession: { team, carrier }, players: result.players.map(q => q.id === carrier ? { ...q, x: Math.max(FIELD.radius, Math.min(120 - FIELD.radius, Number(held.x))), y: Math.max(FIELD.radius, Math.min(FIELD.width - FIELD.radius, Number(held.y))) } : q) };
    }
    return result as unknown as Record<string, unknown>;
}
/** The clock, quarter, mode, overtime, winner and kick must agree with each other and with the phase. */
function gameFieldsValid(s: Record<string, unknown>): boolean {
    if (!integer(s.quarter) || Number(s.quarter) < 1 || Number(s.quarter) > 5 || !integer(s.clock) || Number(s.clock) > QUARTER_TICKS || typeof s.expired !== 'boolean' || !integer(s.gap) || Number(s.gap) > BETWEEN_PLAY_TICKS)
        return false;
    if (!['regulation', 'overtime', 'final'].includes(String(s.mode)) || !team(s.openingTeam))
        return false;
    const o = s.overtime;
    if (!object(o) || !team(o.first) || !integer(o.possessions))
        return false;
    if ((s.mode === 'overtime') !== (s.quarter === 5) && s.mode !== 'final')
        return false;
    if ((s.mode === 'final') !== (s.phase === 'final') || (s.phase === 'final') !== (s.winner !== null))
        return false;
    if (s.winner !== null && s.winner !== 'home' && s.winner !== 'away')
        return false;
    if (s.mode === 'overtime' && (s.clock !== 0 || s.expired))
        return false;
    const k = s.kick;
    if ((s.phase === 'kick') !== (k !== null))
        return false;
    if (k === null)
        return true;
    if (!object(k) || (k.kind !== 'xp' && k.kind !== 'fg') || !team(k.team) || !finite(k.distance) || k.distance < 0 || k.distance > 200 || !finite(k.spot) || !integer(k.ticks) || Number(k.ticks) > KICK_MAX_TICKS)
        return false;
    if ((k.lockedAt === null) !== (k.good === null) || (k.good !== null && typeof k.good !== 'boolean') || (k.lockedAt !== null && (!integer(k.lockedAt) || Number(k.lockedAt) > KICK_MAX_TICKS)))
        return false;
    return k.team === s.offense;
}
const BEHAVIORS = ['stance', 'route', 'settle', 'passBlock', 'runBlock', 'downfieldBlock', 'carry', 'dropback', 'rush', 'runFit', 'man', 'zone', 'pursue', 'contain', 'stumble'];
const ABILITY_KEYS = ['speed', 'accel', 'strength', 'agility', 'awareness', 'block', 'passRush', 'tackle', 'coverage', 'hands', 'throwing'];
/** Eleven offensive and eleven defensive players, each a known roster slot with sane numbers, assignments and locks. */
function playersValid(list: unknown): Set<string> | null {
    if (!Array.isArray(list) || list.length !== 22)
        return null;
    const ids = new Set<string>();
    for (const p of list) {
        if (!object(p) || !team(p.team) || typeof p.id !== 'string')
            return null;
        const code = p.id.slice(p.id.indexOf('-') + 1) as Code;
        const known = (OFFENSE_CODES as readonly string[]).includes(code) || (DEFENSE_CODES as readonly string[]).includes(code);
        if (!known || p.id !== `${p.team}-${code}` || ids.has(p.id) || p.position !== positionOfCode(code) || !integer(p.number) || Number(p.number) < 1 || Number(p.number) > 99)
            return null;
        if (typeof p.human !== 'boolean' || !finite(p.x) || !finite(p.y) || p.x < FIELD.radius - 1e-9 || p.x > 120 - FIELD.radius + 1e-9 || p.y < FIELD.radius - 1e-9 || p.y > FIELD.width - FIELD.radius + 1e-9 || !finite(p.vx) || !finite(p.vy) || Math.abs(Number(p.vx)) > 20 || Math.abs(Number(p.vy)) > 20)
            return null;
        const ab = p.abilities;
        if (!object(ab) || ABILITY_KEYS.some(k => !finite(ab[k]) || Number(ab[k]) < 0 || Number(ab[k]) > 99))
            return null;
        if (!BEHAVIORS.includes(String(p.behavior)) || !integer(p.stun) || Number(p.stun) > 600 || !integer(p.free) || Number(p.free) > 600)
            return null;
        if (p.assign !== null) {
            const a = p.assign;
            if (!object(a) || (a.points !== undefined && (!Array.isArray(a.points) || a.points.length > 8 || !a.points.every(point))) || (a.index !== undefined && !integer(a.index)) || (a.spot !== undefined && !point(a.spot)) || (a.target !== undefined && typeof a.target !== 'string'))
                return null;
        }
        if (p.lock !== null && (!object(p.lock) || typeof p.lock.with !== 'string' || !integer(p.lock.since)))
            return null;
        if (p.read !== undefined && p.read !== null && !point(p.read))
            return null;
        ids.add(p.id);
    }
    for (const t of ['home', 'away'] as const)
        if ([...ids].filter(i => i.startsWith(t + '-')).length !== 11)
            return null;
    for (const p of list as Record<string, unknown>[])
        if (p.lock && !ids.has(String((p.lock as Record<string, unknown>).with)))
            return null;
    return ids;
}
/** Only the arcade key is read. Invalid/older snapshots start a new practice. */
export function decodeSave(text: string | null): DownState | null {
    try {
        if (!text || text.length > 120000)
            return null;
        const data: unknown = JSON.parse(text);
        if (!object(data) || (typeof data.version !== 'number' || !SUPPORTED_VERSIONS.includes(data.version)) || !object(data.state))
            return null;
        const s = upgrade(data.version, data.state);
        if (!validSeed(s.seed) || !integer(s.terminalCount) || !integer(s.contestUntil) || !integer(s.down) || Number(s.down) < 1 || Number(s.down) > 4 || !finite(s.firstDownLine) || s.firstDownLine < 10 || s.firstDownLine > 110)
            return null;
        if (!object(s.score) || !integer(s.score.home) || !integer(s.score.away) || Number(s.score.home) > 9999 || Number(s.score.away) > 9999)
            return null;
        if (!['pre-snap', 'live', 'dead', 'kick', 'final'].includes(String(s.phase)) || !['rush', 'slants', 'go', 'fieldgoal'].includes(String(s.play)) || !team(s.offense) || !integer(s.tick) || !integer(s.liveTicks) || !integer(s.playNumber) || s.playNumber === 0 || !finite(s.line) || s.line < 10 || s.line > 110)
            return null;
        if (!gameFieldsValid(s))
            return null;
        const ids = playersValid(s.players);
        if (!ids)
            return null;
        if (!object(s.possession) || !team(s.possession.team) || !ids.has(String(s.possession.carrier)) || !String(s.possession.carrier).startsWith(s.possession.team + '-') || !ids.has(String(s.defender)) || String(s.defender).startsWith(s.offense + '-'))
            return null;
        if (s.catchKind !== undefined && !(CATCH_KINDS as readonly unknown[]).includes(s.catchKind))
            return null;
        if (!object(s.formation) || !(String(s.formation.offense) in OFFENSE_FORMATIONS) || !(String(s.formation.defense) in DEFENSE_FORMATIONS))
            return null;
        if (!object(s.ball) || !['held', 'flight'].includes(String(s.ball.kind)))
            return null;
        if (s.ball.kind === 'flight' && (!point(s.ball.from) || !point(s.ball.to) || !finite(s.ball.elapsed) || s.ball.elapsed < 0 || !finite(s.ball.duration) || s.ball.duration <= 0 || s.ball.duration > 2 || !ids.has(String(s.ball.target)) || s.phase !== 'live'))
            return null;
        // A finished down needs its result; a kick or a finished game may still carry the touchdown or play that led to it.
        if (s.phase === 'dead' || ((s.phase === 'kick' || s.phase === 'final') && s.result !== null)) {
            if (!object(s.result) || !reasons.includes(String(s.result.reason)) || !finite(s.result.yards) || s.result.playNumber !== s.playNumber || typeof s.result.turnover !== 'boolean' || typeof s.result.touchdown !== 'boolean' || typeof s.result.firstDown !== 'boolean' || typeof s.result.turnoverOnDowns !== 'boolean')
                return null;
        }
        else if (s.result !== null)
            return null;
        return s as unknown as DownState;
    }
    catch {
        return null;
    }
}
