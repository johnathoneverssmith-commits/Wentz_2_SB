import type { DownState } from '../core/down';
import { FIELD } from '../core/simulation';
export const SAVE_KEY = 'wentz.arcade.down.v1';
export const encodeSave = (state: DownState) => JSON.stringify({ version: 2, state });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown) => finite(v) && Number.isSafeInteger(v) && v >= 0;
const point = (v: unknown) => object(v) && finite(v.x) && finite(v.y);
const team = (v: unknown) => v === 'home' || v === 'away';
const reasons = ['tackle', 'out-of-bounds', 'touchdown', 'incomplete', 'interception', 'safety', 'timeout'];
/** Only the arcade key is read. Invalid/older snapshots start a new practice. */
export function decodeSave(text: string | null): DownState | null {
    try {
        if (!text || text.length > 20000)
            return null;
        const data: unknown = JSON.parse(text);
        if (!object(data) || (data.version !== 1 && data.version !== 2) || !object(data.state))
            return null;
        const s = data.version === 1 ? { ...data.state, terminalCount: Number(data.state.playNumber) - (data.state.phase === 'dead' ? 0 : 1), contestUntil: 0 } : data.state;
        if (!integer(s.terminalCount) || !integer(s.contestUntil))
            return null;
        if (!['pre-snap', 'live', 'dead'].includes(String(s.phase)) || !['rush', 'slants', 'go'].includes(String(s.play)) || !team(s.offense) || !integer(s.tick) || !integer(s.liveTicks) || !integer(s.playNumber) || s.playNumber === 0 || !finite(s.line) || s.line < 10 || s.line > 110)
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
        if (s.phase === 'dead') {
            if (!object(s.result) || !reasons.includes(String(s.result.reason)) || !finite(s.result.yards) || s.result.playNumber !== s.playNumber || typeof s.result.turnover !== 'boolean' || typeof s.result.touchdown !== 'boolean')
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
