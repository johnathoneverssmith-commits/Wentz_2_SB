import { FIELD } from '../../core/simulation';
import { MARGIN, PPY, W } from './world';

/** Half the visible width, in yards. */
export const HALF_VIEW = W / PPY / 2;
/** Keep the camera where the strips still have scenery on both sides of the screen. */
export const clampCamera = (x: number): number => Math.max(-MARGIN + HALF_VIEW + 0.5, Math.min(FIELD.length + MARGIN - HALF_VIEW - 0.5, x));
/**
 * Exponential smoothing toward a target at `rate` per second, frame-rate independent. A jump bigger than `snapYards` (a new
 * possession, a kick) cuts instead of panning across the whole field. Pure: the same inputs always give the same camera.
 */
export function followCamera(current: number, target: number, dt: number, rate = 4.5, snapYards = 38): number {
    const goal = clampCamera(target);
    if (Math.abs(goal - current) > snapYards) return goal;
    const next = current + (goal - current) * (1 - Math.exp(-rate * Math.max(0, Math.min(dt, 0.25))));
    return Math.abs(goal - next) < 0.02 ? goal : next;
}
/** Whole-pixel left edge of the view for a camera centre, so scenery never shimmers between pixels. */
export const viewLeftPx = (camX: number): number => Math.round((camX + MARGIN) * PPY - W / 2);
