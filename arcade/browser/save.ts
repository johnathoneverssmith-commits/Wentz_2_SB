import { BETWEEN_PLAY_TICKS, QUARTER_TICKS, SAFETY_POINTS, TOUCHDOWN_POINTS, firstDownMarker, type DownState } from '../core/down';
import { KICK_MAX_TICKS } from '../core/kick';
import { FIELD } from '../core/simulation';
export const SAVE_KEY = 'wentz.arcade.down.v1';
export const encodeSave = (state: DownState) => JSON.stringify({ version: 5, state });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown) => finite(v) && Number.isSafeInteger(v) && v >= 0;
const point = (v: unknown) => object(v) && finite(v.x) && finite(v.y);
const team = (v: unknown) => v === 'home' || v === 'away';
const reasons = ['tackle', 'out-of-bounds', 'touchdown', 'incomplete', 'interception', 'safety', 'timeout'];
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
    if (version <= 4)
        s = { ...s, gap: 0 };
    if (version <= 3)
        s = { ...s, quarter: 1, clock: QUARTER_TICKS, expired: false, mode: 'regulation', openingTeam: 'home', overtime: { first: 'away', possessions: 0 }, winner: null, kick: null };
    return s;
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
/** Only the arcade key is read. Invalid/older snapshots start a new practice. */
export function decodeSave(text: string | null): DownState | null {
    try {
        if (!text || text.length > 20000)
            return null;
        const data: unknown = JSON.parse(text);
        if (!object(data) || (data.version !== 1 && data.version !== 2 && data.version !== 3 && data.version !== 4 && data.version !== 5) || !object(data.state))
            return null;
        const s = upgrade(data.version, data.state);
        if (!integer(s.terminalCount) || !integer(s.contestUntil) || !integer(s.down) || Number(s.down) < 1 || Number(s.down) > 4 || !finite(s.firstDownLine) || s.firstDownLine < 10 || s.firstDownLine > 110)
            return null;
        if (!object(s.score) || !integer(s.score.home) || !integer(s.score.away) || Number(s.score.home) > 9999 || Number(s.score.away) > 9999)
            return null;
        if (!['pre-snap', 'live', 'dead', 'kick', 'final'].includes(String(s.phase)) || !['rush', 'slants', 'go', 'fieldgoal'].includes(String(s.play)) || !team(s.offense) || !integer(s.tick) || !integer(s.liveTicks) || !integer(s.playNumber) || s.playNumber === 0 || !finite(s.line) || s.line < 10 || s.line > 110)
            return null;
        if (!gameFieldsValid(s))
            return null;
        if (!Array.isArray(s.players) || s.players.length !== 10)
            return null;
        const ids = new Set<string>();
        for (const p of s.players) {
            if (!object(p) || !team(p.team) || !integer(p.number) || Number(p.number) < 1 || Number(p.number) > 5 || p.id !== `${p.team}-${p.number}` || ids.has(String(p.id)) || typeof p.human !== 'boolean' || !finite(p.x) || !finite(p.y) || p.x < FIELD.radius || p.x > 120 - FIELD.radius || p.y < FIELD.radius || p.y > FIELD.width - FIELD.radius || !object(p.abilities) || !finite(p.abilities.speed) || p.abilities.speed < 0 || p.abilities.speed > 99)
                return null;
            ids.add(String(p.id));
        }
        if (!object(s.possession) || !team(s.possession.team) || !ids.has(String(s.possession.carrier)) || !String(s.possession.carrier).startsWith(s.possession.team + '-') || !ids.has(String(s.defender)) || String(s.defender).startsWith(s.offense + '-'))
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
