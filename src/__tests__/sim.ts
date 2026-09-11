/**
 * The game without the page: build a circuit the way the arena does, put a
 * vehicle on it, drive it with a script, and fingerprint what happened.
 *
 * `../circuit` is imported first on purpose. The modules have a cycle in
 * them — track → biomes → props → scene → track — which the page happens to
 * enter from the side that works; entered from `track` instead, `scene`
 * stands its lamp posts along a circuit that does not exist yet.
 */
import { useTrack } from '../circuit';
import { Race, type Input } from '../game';
import { VEHICLES, type VehicleKey } from '../vehicles';
import { centreline, tangentAt, TRACK_LIFT } from '../track';
import { height } from '../terrain';
import type { BiomeKey } from '../biomes';
import type { SizeKey } from '../world';

export { useTrack };

/** A circuit in force and a race on it, in the class asked for. */
export function raceOn(seed: number, size: SizeKey, biome: BiomeKey, vehicle: VehicleKey): Race {
  useTrack(seed, size, biome);
  const race = new Race();
  race.useVehicle(VEHICLES[vehicle]);
  return race;
}

/**
 * A driver with no eyes: full throttle, the wheel swept side to side, and a
 * dab of brake every five seconds. Not a good lap — a repeatable one, that
 * leaves the tarmac, finds the shoulder and the walls, and brakes and slides
 * often enough that most of the vehicle model is on the path.
 */
export function script(t: number): Input {
  return { turn: Math.sin(t * 1.3) * 0.8, throttle: 1, brake: t % 5 < 0.4 ? 1 : 0 };
}

/** FNV-1a over the bytes of a list of doubles, folded into a running hash. */
const bytes = new Uint8Array(8);
const view = new DataView(bytes.buffer);
export function fold(hash: number, values: number[]): number {
  let h = hash >>> 0;
  for (const v of values) {
    view.setFloat64(0, v);
    for (let i = 0; i < 8; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; }
  }
  return h;
}
export const FNV_OFFSET = 2166136261;

/**
 * Drive a race the way the page's frame loop does for `seconds`, at a
 * display's frame rate, hashing where the truck is after every frame.
 */
export function drive(race: Race, seconds: number, hz: number, input: (t: number) => Input = script): string {
  let h = FNV_OFFSET;
  const dt = 1 / hz;
  const frames = Math.round(seconds * hz);
  for (let f = 0; f < frames; f++) {
    race.step(dt, input(f * dt));
    const t = race.truck;
    h = fold(h, [t.x, t.y, t.z, t.yaw, t.vx, t.vy]);
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Whether any of the road on the grid is under a water level: a box from
 * well behind the line, where the truck stands, to just past it, and as wide
 * as the widest vehicle with a margin. Not the whole width of the tarmac:
 * the ribbon lies on the ground, and where the line is the lowest point of
 * the lap its edges are below the centreline even with no water at all.
 */
const GRID_HALF = 150;
export function gridUnder(level: number): boolean {
  const [cx, cy] = centreline(-Math.PI);
  const [tx, ty] = tangentAt(-Math.PI);
  for (let along = -600; along <= 200; along += 50) {
    for (let across = -GRID_HALF; across <= GRID_HALF; across += GRID_HALF / 4) {
      const x = cx + tx * along + ty * across;
      const y = cy + ty * along - tx * across;
      if (height(x, y) + TRACK_LIFT < level) return true;
    }
  }
  return false;
}
