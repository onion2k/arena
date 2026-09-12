/**
 * The racing line: that it is on the road, that it is straighter than the
 * road, and that it says where the car is braking.
 *
 * The line is a guide drawn over the tarmac and nothing drives it, so what
 * can be wrong with it is geometry rather than lap times: a line that leaves
 * the road would have the player aiming at the scenery, and a line no
 * straighter than the centreline would be a painted centreline.
 */
import { describe, expect, it } from 'vitest';
import { useTrack } from './sim';
import { TRACK_HALF, centreline, curveRadius, where } from '../track';
import { raceLine } from '../raceline';
import { VEHICLES } from '../vehicles';

/** The total turning of a closed path, in radians: how much it bends in a lap. */
function turning(points: [number, number][]): number {
  const n = points.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = points[(i + n - 1) % n], b = points[i], c = points[(i + 1) % n];
    const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = h2 - h1;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    sum += Math.abs(d);
  }
  return sum;
}

const SEEDS = [0, 3, 7, 11];

describe('the racing line', () => {
  it('stays on the tarmac, on every circuit and either kind', () => {
    for (const kind of ['rally', 'track'] as const) {
      for (const seed of SEEDS) {
        useTrack(seed, 'M', 'forest', false, kind);
        const spec = VEHICLES[kind === 'rally' ? 'technical' : 'f1'];
        const line = raceLine(spec.engine.topSpeed, spec.rating);
        for (const [x, y] of line.points) {
          // `where` gives the offset across the road, signed; the line is
          // held inside the usable width with a wheel's margin to spare
          expect(Math.abs(where(x, y).offset), `${kind} #${seed}`).toBeLessThan(TRACK_HALF);
        }
      }
    }
  });

  it('bends less than the road it is drawn on', () => {
    for (const seed of SEEDS) {
      useTrack(seed, 'M', 'forest', false, 'rally');
      const spec = VEHICLES.technical;
      const line = raceLine(spec.engine.topSpeed, spec.rating);
      // the same samples, taken down the middle of the road
      const centre: [number, number][] = line.points.map((_, i) =>
        centreline(-Math.PI + (i / line.points.length) * Math.PI * 2));
      expect(turning(line.points), `#${seed}`).toBeLessThan(turning(centre) * 0.9);
    }
  });

  it('is faster through the corners than the middle of the road', () => {
    // The claim the line exists to make: its slowest point is quicker than
    // the slowest point of the same lap driven down the middle. Measured at
    // 12 to 41% on stages and 8 to 23% on tracks.
    for (const kind of ['rally', 'track'] as const) {
      const spec = VEHICLES[kind === 'track' ? 'f1' : 'technical'];
      for (const seed of SEEDS) {
        useTrack(seed, 'M', 'forest', false, kind);
        let tightest = Infinity;
        for (let i = 0; i < 720; i++) tightest = Math.min(tightest, curveRadius(-Math.PI + (i / 720) * Math.PI * 2, 400));
        const downTheMiddle = Math.min(spec.engine.topSpeed, spec.rating.corner * Math.sqrt(tightest));
        const line = raceLine(spec.engine.topSpeed, spec.rating);
        expect(Math.min(...line.speed), `${kind} #${seed}`).toBeGreaterThan(downTheMiddle * 1.05);
      }
    }
  });

  it('slows most where the corners are tightest: a wild stage', () => {
    // Three roads, three sets of corners: a wild stage's hairpins down to
    // 450mm on a narrow road, a smooth stage's 720 and up, a track's 1100
    // and up. What the line is slowed to should follow that order.
    const slowest = (wild: boolean, kind: 'rally' | 'track', key: 'technical' | 'f1') => {
      const spec = VEHICLES[key];
      let worst = 1;
      for (const seed of SEEDS) {
        useTrack(seed, 'M', 'forest', wild, kind);
        const line = raceLine(spec.engine.topSpeed, spec.rating);
        worst = Math.min(worst, Math.min(...line.speed) / spec.engine.topSpeed);
      }
      return worst;
    };
    const wildStage = slowest(true, 'rally', 'technical');
    const stage = slowest(false, 'rally', 'technical');
    expect(wildStage).toBeLessThan(stage);
    expect(wildStage).toBeLessThan(0.9);
  });
});
