/**
 * The two kinds of circuit, and that each is what it says it is.
 *
 * A rally stage and a racing track differ in two measurable ways: how tight
 * the corners get, and how much the ground moves under the road. Both are
 * asserted here against every seed the screen will offer, because both are
 * generated rather than drawn — a limit that a repair loop cannot actually
 * reach is a limit that quietly does nothing.
 */
import { describe, expect, it } from 'vitest';
import { useTrack } from './sim';
import { centreline, circuitFor, curveRadius, difficultyBand, limitsFor, rateTrack, slowestCorner } from '../track';
import { VEHICLES } from '../vehicles';
import { height } from '../terrain';
import { KINDS, allows, defaultVehicle, kindForVehicle } from '../kind';
import { VEHICLE_KEYS } from '../vehicles';

const SEEDS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];

/** The tightest corner and the length of the circuit in force. */
function lap() {
  let curve = Infinity, length = 0;
  let prev = centreline(-Math.PI);
  for (let i = 1; i <= 2048; i++) {
    const t = -Math.PI + (i / 2048) * Math.PI * 2;
    curve = Math.min(curve, curveRadius(t, 400));
    const p = centreline(t);
    length += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return { curve, length };
}

/**
 * How rough the ground under the racing line is: the mean step in height
 * between samples a metre or so apart, and the whole rise and fall of a lap.
 * The step is what a car feels; the range is what a lap looks like.
 */
function ground() {
  let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
  let prev: number | null = null;
  for (let i = 0; i < 1200; i++) {
    const t = -Math.PI + (i / 1200) * Math.PI * 2;
    const [x, y] = centreline(t);
    const z = height(x, y);
    lo = Math.min(lo, z); hi = Math.max(hi, z);
    if (prev !== null) { sum += Math.abs(z - prev); n++; }
    prev = z;
  }
  return { step: sum / n, range: hi - lo };
}

describe('the two kinds of circuit', () => {
  it('holds every circuit to its own limit, and a track to a corner its cars fit', () => {
    const corners: number[] = [];
    for (const seed of SEEDS) {
      useTrack(seed, 'M', 'forest', false, 'rally');
      expect(lap().curve, `rally #${seed}`).toBeGreaterThanOrEqual(KINDS.rally.curve * 0.98);

      useTrack(seed, 'M', 'forest', false, 'track');
      const track = lap();
      corners.push(track.curve);
      // a track's limit is drawn per seed, so each is held to its own
      expect(track.curve, `track #${seed}`).toBeGreaterThanOrEqual(limitsFor('track', seed).curve * 0.98);
      // and never below the range's floor, which is well clear of the
      // turning circle of either car offered on a track
      expect(track.curve, `track #${seed} floor`).toBeGreaterThan(KINDS.track.curveRange![0] * 0.98);
      expect(track.curve, `track #${seed} against the F1's circle`).toBeGreaterThan(VEHICLES.f1.turnCircle);
    }
    // and they differ from one another: a set of tracks that were all the
    // same corner would be one track with ten names
    expect(Math.max(...corners) - Math.min(...corners)).toBeGreaterThan(600);
  });

  it('rolls the ground flat for a racing track and leaves it alone for a stage', () => {
    const rows: string[] = [];
    for (const seed of SEEDS) {
      useTrack(seed, 'M', 'forest', false, 'rally');
      const rally = ground();
      useTrack(seed, 'M', 'forest', false, 'track');
      const track = ground();
      rows.push(`#${seed}: rally step ${rally.step.toFixed(2)} range ${rally.range.toFixed(0)}`
        + ` · track step ${track.step.toFixed(2)} range ${track.range.toFixed(0)}`);
      // the road still rises and falls over a lap — it is not a billiard
      // table — but what the car feels underneath it is a fraction
      expect(track.step, `#${seed} step`).toBeLessThan(rally.step * 0.45);
      expect(track.range, `#${seed} range`).toBeLessThan(rally.range * 0.6);
    }
    console.log(rows.join('\n'));
  });

  it('offers two cars a kind, and every car exactly one kind', () => {
    expect(KINDS.rally.vehicles).toEqual(['technical', 'rally']);
    expect(KINDS.track.vehicles).toEqual(['lmp', 'f1']);
    for (const key of VEHICLE_KEYS) {
      const kind = kindForVehicle(key);
      expect(allows(kind, key), key).toBe(true);
      expect(allows(kind === 'rally' ? 'track' : 'rally', key), key).toBe(false);
    }
    expect(defaultVehicle('rally')).toBe('technical');
    expect(defaultVehicle('track')).toBe('lmp');
  });
});

describe('what the select screen says about a circuit', () => {
  it('quotes a slowest corner that actually varies between tracks', () => {
    // The band is a rally instrument and a track is given a fact instead —
    // but a fact that read the same on every circuit would be no better
    // than the band it replaced. Over sixteen tracks the F1's slowest
    // corner must cover a real range.
    const shares = Array.from({ length: 16 }, (_, seed) =>
      slowestCorner(circuitFor(seed, 1, false, 'track'), VEHICLES.f1.engine.topSpeed, VEHICLES.f1.rating).share);
    const lo = Math.min(...shares), hi = Math.max(...shares);
    console.log(`slowest corner over 16 tracks: ${shares.map((v) => Math.round(v * 100)).join(' ')}`);
    // measured: 83% to flat out over the first sixteen, and the spread is
    // what makes it worth printing
    expect(lo).toBeLessThan(0.9);
    expect(hi - lo).toBeGreaterThan(0.1);
    for (const v of shares) expect(v).toBeGreaterThan(0.5);
  });

  it('leaves the rally band alone', () => {
    // the original circuit is the second band, as it has always been
    const r = rateTrack(circuitFor(0, 1, false, 'rally'), VEHICLES.technical.engine.topSpeed, VEHICLES.technical.rating);
    expect(difficultyBand(r.difficulty).name).toBe('open');
  });
});
