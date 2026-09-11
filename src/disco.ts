/**
 * Disco night: the circuit as a dance floor.
 *
 * Every trackside flood chases through the colours of the rainbow round the
 * lap and swings its beam about, on a beat; the lamp heads flash with them;
 * the headlights sweep and change colour; and a mirror ball hangs over the
 * start line throwing narrow coloured beams round the arena, which the night
 * haze turns into a laser show. The lamps stay on whatever the clock says.
 *
 * All of it is lighting and glows, driven by the wall clock rather than the
 * race: nothing about the driving changes, and a paused race still dances.
 */
import { centreline } from './track';
import { height } from './terrain';
import { SETTINGS } from './settings';

/** Beats a minute. */
export const BPM = 124;
/** How many beams the mirror ball throws. */
export const BALL_BEAMS = 6;
/** How high over the line the mirror ball hangs. */
const BALL_HEIGHT = 720;

/** Seconds on the dance floor's own clock. */
export function discoTime(): number {
  return performance.now() / 1000;
}

/** Whether the dance floor is open. */
export function discoOn(): boolean {
  return SETTINGS.disco;
}

/**
 * How hard the beat is hitting, 0 to 1: a flash on every beat that decays
 * before the next, and a harder one on the first of every four.
 */
export function pulse(t: number): number {
  const beats = (t * BPM) / 60;
  const phase = beats - Math.floor(beats);
  const bar = Math.floor(beats) % 4 === 0 ? 1 : 0.7;
  return bar * Math.exp(-5 * phase);
}

/** A fully saturated colour for a hue, 0 to 1 round the wheel. */
export function hue(h: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + (((h % 1) + 1) % 1) * 6) % 6;
    return Math.max(0, Math.min(1, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

/**
 * A lamp post's colour: a rainbow spread round the lap that chases forward
 * a post every beat, so the colour runs round the circuit like a light
 * chaser on a sign.
 */
export function postHue(index: number, count: number, t: number): number {
  const beats = (t * BPM) / 60;
  return index / Math.max(1, count) - Math.floor(beats) / Math.max(1, count) * 3 + t * 0.05;
}

/** How far a post's beam has swung off its aim, in radians about the vertical. */
export function postSwing(index: number, t: number): number {
  return Math.sin(t * 1.9 + index * 0.9) * 0.45;
}

/** Where the mirror ball hangs: over the middle of the start line. */
export function ballAt(): [number, number, number] {
  const [x, y] = centreline(-Math.PI);
  return [x, y, height(x, y) + BALL_HEIGHT];
}

/** One of the mirror ball's beams: which way it points and its colour. The
 *  beams turn slowly round the ball and dip and rise as they go. */
export function ballBeam(k: number, t: number): { direction: [number, number, number]; colour: [number, number, number] } {
  const a = t * 0.8 + (k / BALL_BEAMS) * Math.PI * 2;
  const dip = -0.35 - 0.2 * Math.sin(t * 1.3 + k);
  const len = Math.hypot(1, dip);
  return {
    direction: [Math.cos(a) / len, Math.sin(a) / len, dip / len],
    colour: hue(k / BALL_BEAMS + t * 0.07),
  };
}
