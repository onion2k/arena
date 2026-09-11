/**
 * Concours d'Élégance: the car as an objet d'art.
 *
 * The body is polished gold; the glass, the wings and the tyres are black
 * onyx; the headlamps are cut diamonds; and along both flanks runs white-gold
 * filigree — an art-nouveau vine, a whiplash wave with a tendril curling off
 * every crest and trough — laid onto the body's own surface, so it hugs a
 * pickup's flat sides and an F1 car's sidepods alike. Every lap finished sets
 * another gemstone into the heart of a curl. For the countdown the car turns
 * on a velvet plinth with a gold rim, the way a jeweller shows a piece, and
 * settles onto the road when the lights go out.
 *
 * None of it is physics. The renderer here has colour and roughness to work
 * with and no engraving or gem shading, so the filigree is geometry, the
 * stones are faceted meshes in glossy colour, and the gold is the gold the
 * paint always was, polished.
 */
import type { Mesh } from 'artshape-render/mesh/types';
import { Solid } from './models';
import { prism } from './scene';
import type { VehicleSpec } from './vehicle';

type V3 = [number, number, number];

/** Where the vine runs on each class: from and to along the car, the height
 *  it waves about, how far it waves, and how long a wave is. */
interface VineBand { from: number; to: number; z: number; amp: number; wave: number }
const BANDS: Record<string, VineBand> = {
  technical: { from: -182, to: 180, z: -6, amp: 10, wave: 72 },
  rally: { from: -156, to: 160, z: -12, amp: 10, wave: 64 },
  lmp: { from: -200, to: 200, z: -16, amp: 10, wave: 80 },
  f1: { from: -140, to: 80, z: -26, amp: 7, wave: 55 },
};

/** Filigree wire's radius, and how proud of the body it stands. */
const WIRE = 1.5;
const PROUD = 1.2;

/** A gem at the heart of a curl, in the body's frame, and which side faces out. */
export interface GemSite { at: V3; side: 1 | -1; size: number }

export interface Filigree { mesh: Mesh; sites: GemSite[] }

/**
 * How far out the body's side is at a point, on one side: a ray across the car
 * at that height and length, and the outermost triangle it passes through.
 * Null where it passes through nothing — a wheel arch, or past the nose.
 */
function surfaceFinder(body: Mesh): (x: number, z: number, side: 1 | -1) => number | null {
  const p = body.positions;
  const tris: number[][] = [];
  for (let i = 0; i + 8 < p.length; i += 9) tris.push(Array.from(p.subarray(i, i + 9)));
  return (x, z, side) => {
    let best: number | null = null;
    for (const [x0, y0, z0, x1, y1, z1, x2, y2, z2] of tris) {
      const det = (x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0);
      if (Math.abs(det) < 1e-9) continue;
      const u = ((x - x0) * (z2 - z0) - (x2 - x0) * (z - z0)) / det;
      const v = ((x1 - x0) * (z - z0) - (x - x0) * (z1 - z0)) / det;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const y = y0 + u * (y1 - y0) + v * (y2 - y0);
      if (best === null || y * side > best * side) best = y;
    }
    return best;
  };
}

/**
 * Lay a line of wire along points given as [x, z] on one side of the body,
 * each pushed out onto the surface. The wire breaks wherever the surface
 * does — over an arch, or where the side steps in — rather than bridging
 * a gap in mid-air.
 */
function wire(s: Solid, surface: ReturnType<typeof surfaceFinder>, pts: [number, number][], side: 1 | -1) {
  let prev: V3 | null = null;
  for (const [x, z] of pts) {
    const y = surface(x, z, side);
    if (y === null) { prev = null; continue; }
    const at: V3 = [x, y + side * (WIRE + PROUD), z];
    if (prev && Math.abs(prev[1] - at[1]) < 10) s.rod(prev, at, WIRE, 5);
    prev = at;
  }
}

/** The filigree for a class, and where its stones go. */
export function filigree(spec: VehicleSpec): Filigree {
  const band = BANDS[spec.key];
  const s = new Solid();
  const sites: GemSite[] = [];
  const surface = surfaceFinder(spec.kit.body());
  const curl = band.wave * 0.2;
  for (const side of [1, -1] as const) {
    // the whiplash: a wave along the flank
    const main: [number, number][] = [];
    for (let x = band.from; x <= band.to; x += 3) {
      main.push([x, band.z + band.amp * Math.sin(((x - band.from) / band.wave) * Math.PI * 2)]);
    }
    wire(s, surface, main, side);
    // a tendril off every crest and trough, curling away from the vine into
    // a spiral, with a stone set at its heart
    for (let k = 0; ; k++) {
      const x = band.from + band.wave * (0.25 + k * 0.5);
      if (x > band.to) break;
      const up = k % 2 === 0 ? 1 : -1;
      const cx = x, cz = band.z + up * (band.amp + curl);
      const pts: [number, number][] = [];
      const start = -up * Math.PI / 2;
      for (let q = 0; q <= 40; q++) {
        const f = q / 40;
        const a = start + f * Math.PI * 2.6 * up;
        const r = curl * (1 - 0.72 * f);
        pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
      wire(s, surface, pts, side);
      const y = surface(cx, cz, side);
      if (y !== null) sites.push({ at: [cx, y + side * PROUD, cz], side, size: curl * 0.42 });
    }
  }
  return { mesh: s.mesh(), sites };
}

/**
 * A brilliant-cut stone, table up (+z), girdle radius `r`: a table, a crown of
 * facets down to the girdle, and a pavilion to a point below it.
 */
export function gemMesh(r = 1, sides = 8): Mesh {
  const s = new Solid();
  const ring = (radius: number, z: number, turn = 0): V3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = ((i + turn) / sides) * Math.PI * 2;
      return [Math.cos(a) * radius, Math.sin(a) * radius, z];
    });
  const table = ring(r * 0.58, r * 0.36, 0.5);
  const girdle = ring(r, 0);
  const top: V3 = [0, 0, r * 0.36], point: V3 = [0, 0, -r * 0.9];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const out = (p: V3): V3 => [p[0], p[1], p[2] + 0.2 * r];
    s.tri(top, table[i], table[j], [0, 0, 1]);
    s.tri(girdle[i], girdle[j], table[i], out(girdle[i]));
    s.tri(table[i], girdle[j], table[j], out(table[i]));
    s.tri(girdle[i], point, girdle[j], [girdle[i][0], girdle[i][1], -0.6 * r]);
  }
  return s.mesh();
}

/** The palette the stones are set in, in order: colour and roughness. */
export const STONES: [number, number, number, number][] = [
  [0.78, 0.02, 0.08, 0.02],   // ruby
  [0.05, 0.16, 0.86, 0.02],   // sapphire
  [0.02, 0.62, 0.26, 0.02],   // emerald
  [0.52, 0.10, 0.78, 0.02],   // amethyst
  [0.96, 0.56, 0.05, 0.02],   // topaz
];

/** The plinth's radius for a class: the car's own length and a margin. */
export function plinthRadius(spec: VehicleSpec): number {
  const p = spec.kit.body().positions;
  let reach = 0;
  for (let i = 0; i < p.length; i += 3) reach = Math.max(reach, Math.hypot(p[i], p[i + 1]));
  return reach + 24;
}

/** How tall the plinth stands, rim and velvet. */
export const PLINTH_RIM = 16;
export const PLINTH_TOP = 19;

/** The plinth's gold rim, and its velvet top, unit radius; scaled to the car. */
export const plinthRim = (): Mesh => prism(1, PLINTH_RIM, 36);
export const plinthVelvet = (): Mesh => prism(0.94, PLINTH_TOP, 36);

/** Turns the car makes on the plinth over the countdown. */
const TURNS = 1.25;
/** Seconds it takes to settle onto the road after the go. */
const SETTLE = 0.45;

/**
 * Where the car is in its presentation: how far it has turned on the plinth,
 * how high the plinth holds it, and how far the plinth has sunk away. `null`
 * once it is on the road for good.
 */
export function presentation(countdown: number, countdownTotal: number, sinceStart: number, running: boolean):
  { spin: number; lift: number; sink: number } | null {
  if (!running) return { spin: (countdown / countdownTotal) * TURNS * Math.PI * 2, lift: PLINTH_TOP, sink: 0 };
  if (sinceStart >= SETTLE) return null;
  const k = sinceStart / SETTLE;
  const ease = k * k * (3 - 2 * k);
  return { spin: 0, lift: PLINTH_TOP * (1 - ease), sink: (PLINTH_TOP + 6) * ease };
}
