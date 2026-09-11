import { describe, expect, it } from 'vitest';
import { useTrack } from './sim';
import { TRACK_HALF, circuitFor, curveRadius, generateWild, measureShape, rateTrack, roadDistance, setTrack } from '../track';
import { COLUMNS } from '../scene';
import { PROPS } from '../flora';
import { BOLLARDS, RAILS, SIGNS } from '../furniture';
import { driveTo } from '../calibrate';
import { VEHICLES, VEHICLE_KEYS } from '../vehicles';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('wild circuits', () => {
  // The same arena and road as a smooth circuit, with the wild limits: corners
  // down to 380mm, a lap up to 38m, and the start line on a straight.
  it('clear their limits, and start on a straight', () => {
    for (const seed of SEEDS) {
      const shape = generateWild(seed);
      expect(shape.table, `#${seed} is a wild shape, not a fallback`).toBeDefined();
      const m = measureShape(shape);
      expect(m.curve, `#${seed} tightest corner`).toBeGreaterThanOrEqual(380);
      expect(m.across, `#${seed} radial to across`).toBeGreaterThanOrEqual(0.62);
      expect(m.minRadius).toBeGreaterThanOrEqual(2500);
      expect(m.maxRadius).toBeLessThanOrEqual(5300);
      expect(m.length).toBeGreaterThanOrEqual(24000);
      expect(m.length).toBeLessThanOrEqual(38000);
      setTrack(shape);
      expect(curveRadius(-Math.PI, 400), `#${seed} start line`).toBeGreaterThan(8000);
    }
  });

  it('are the same circuit every time for a seed', () => {
    const a = generateWild(7).table!, b = generateWild(7).table!;
    expect(Array.from(a.r)).toEqual(Array.from(b.r));
  });

  // Placed along the radius, a thing on the inside of a corner tighter than
  // its offset can land on the other leg of the corner. Measured to the
  // nearest road, nothing stands on the tarmac or next to it.
  it('put nothing on the road', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      useTrack(seed, 'M', 'forest', true);
      const clear = (kind: string, x: number, y: number, r: number) =>
        expect(roadDistance(x, y) - r, `#${seed} ${kind} at ${x.toFixed(0)},${y.toFixed(0)}`).toBeGreaterThan(TRACK_HALF + 40);
      for (const p of COLUMNS) clear('post', p.x, p.y, 17);
      for (const b of BOLLARDS) clear(b.kind, b.x, b.y, b.r);
      for (const r of RAILS) clear('rail', (r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2, 11);
      for (const s of SIGNS) clear('sign', s.x, s.y, 10);
      for (const p of PROPS.filter((q) => q.r > 0).slice(0, 400)) clear('tree', p.x, p.y, p.r);
    }
  });

  // Every class gets round one near par. Par is fitted on smooth circuits and
  // is length at top speed, which a wild circuit's tight corners make a
  // little optimistic — 1 to 3% on average over thirteen of them, most for
  // the F1, worst 7% — so a wild lap is held to 8% rather than the smooth
  // circuits' 6%.
  it('can be driven to par in every class', () => {
    for (const key of VEHICLE_KEYS) {
      const spec = VEHICLES[key];
      // its best lap over a few plans, the way par is calibrated
      const lap = Math.min(...[60, 80, 100].map((c) => driveTo(spec, 3, c, 'M', 'forest', true).lap));
      const { par } = rateTrack(circuitFor(3, 1, true), spec.engine.topSpeed, spec.rating);
      expect(Math.abs(par / lap - 1), `${key}: par ${par.toFixed(2)}, driven ${lap.toFixed(2)}`).toBeLessThan(0.08);
    }
  });
});
