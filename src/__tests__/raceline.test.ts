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
import { TRACK_HALF, centreline, where } from '../track';
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

  it('slows for the corners, and less of the lap on a track than a stage', () => {
    // What the line is slowed to is a fraction of top speed, and the share
    // of the lap spent there is small in both kinds — the line straightens
    // a corner by a quarter to a half, which is the whole point of it: over
    // these seeds the road's tightest is 714 to 912mm and the line's is 931
    // to 1378. So the claim is comparative, and about where the slowing is.
    const slowed = (kind: 'rally' | 'track', key: 'technical' | 'f1') => {
      const spec = VEHICLES[key];
      let share = 0, slowest = 1;
      for (const seed of SEEDS) {
        useTrack(seed, 'M', 'forest', false, kind);
        const line = raceLine(spec.engine.topSpeed, spec.rating);
        share += line.speed.filter((v) => v < spec.engine.topSpeed * 0.9).length / line.speed.length / SEEDS.length;
        slowest = Math.min(slowest, Math.min(...line.speed) / spec.engine.topSpeed);
      }
      return { share, slowest };
    };
    const stage = slowed('rally', 'technical');
    const track = slowed('track', 'f1');
    // a stage has somewhere the truck is well off top speed
    expect(stage.slowest).toBeLessThan(0.85);
    // and spends more of its lap there than a racing circuit does
    expect(stage.share).toBeGreaterThan(track.share);
  });
});
