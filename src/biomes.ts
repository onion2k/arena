/**
 * The biomes: what the arena is made of, besides the road.
 *
 * Everything a circuit's *look* decides that is not the circuit itself —
 * the ground's colour and shape, whether there is water and how much, what
 * grows beside the road, the sky's tint, what a sliding wheel throws up —
 * lives in one `Biome` record, chosen on the track-select screen the same
 * way the size and the vehicle are. `forest` is exactly what the game
 * shipped with; the other three are new.
 *
 * The sky is a tint over the one dawn-to-noon table in `daylight.ts`, not a
 * table of its own per biome: that table was tuned by eye against real
 * timings, and four more tables would be thirty-six rows of colour with
 * nothing to check them against. There is no per-biome environment bake for
 * the same reason the sky is a tint — the environment mostly lights the
 * metal, and the ground by day is ambient times the biome's own albedo,
 * which the biome already carries.
 */
import type { Mesh } from 'artshape-render/mesh/types';
import { cactusMesh, deadTreeMesh, firMesh, reedMesh, rockMesh, treeMesh } from './props';

export type BiomeKey = 'forest' | 'desert' | 'snow' | 'marsh';
export const BIOME_KEYS: BiomeKey[] = ['forest', 'desert', 'snow', 'marsh'];

/** One kind of thing planted beside the road. */
export interface PropKind {
  name: string;
  mesh: () => Mesh;
  /** Uniform scale, drawn evenly between the two. */
  scaleRange: [number, number];
  /** The collision circle for a prop at a given scale. Zero means a wheel
   *  goes through it rather than off it — a reed bed, not an obstacle. */
  radiusOf: (scale: number) => number;
  /** How far the foot is sunk, so no slope opens a gap under it. */
  sink: number;
  /** Share of plantings this kind takes when a biome has more than one. */
  weight: number;
  /**
   * Either one colour for the whole kind, or a per-instance rule — the
   * forest's is a rule, so every tree gets its own green the way it always
   * did; a biome with one flat-coloured kind can just give it an albedo.
   */
  material: { albedo: [number, number, number]; roughness: number } | { tint: (rand: () => number) => [number, number, number, number] };
}

export interface Biome {
  key: BiomeKey;
  label: string;
  ground: { albedo: [number, number, number]; roughness: number };
  tarmac: { albedo: [number, number, number]; roughness: number };
  kerb: [[number, number, number], [number, number, number]];
  /** `depth` is over the lowest point of the road, the way `FORD_DEPTH`
   *  always was; `null` is no water at all. */
  water: { depth: number | null; albedo: [number, number, number]; roughness: number };
  /** One factor per row of `terrain.ts`'s `WAVES`, in order: swell, swell,
   *  roll, roll, ramp. */
  terrain: { ampScale: number[] };
  /** How much grip running off the tarmac costs, 0 to 1 — the shoulder's own
   *  loss, which was a bare 0.32 in `track.ts` before biomes existed. */
  offTrackLoss: number;
  sky: { tint: [number, number, number]; ambientScale: number };
  /** Nominal spacing of the planting grid, and the kinds that fill it. */
  flora: { spacing: number; kinds: PropKind[] };
  /** What a dry, off-road wheel throws up, or nothing for a biome that never
   *  goes dry-and-loose the way sand and snow do. */
  dust: [number, number, number] | null;
  map: { road: string; water: string };
}

/** The forest's pine, tinted per instance exactly as `forest.ts` always did:
 *  darker and bluer for most, a little warmer or paler for some, so sixteen
 *  hundred of the same cone reads as a wood and not a carpet. */
const pineTint = (rand: () => number): [number, number, number, number] => {
  const k = rand();
  const warm = rand() * 0.06;
  const pale = rand() < 0.12 ? 0.08 : 0;
  return [0.06 + warm + pale + k * 0.05, 0.20 + k * 0.16 + pale, 0.08 + (1 - k) * 0.07, 0.78];
};

const FOREST: Biome = {
  key: 'forest', label: 'forest',
  ground: { albedo: [0.042, 0.048, 0.066], roughness: 0.62 },
  tarmac: { albedo: [0.058, 0.062, 0.072], roughness: 0.85 },
  kerb: [[0.62, 0.075, 0.055], [0.80, 0.80, 0.82]],
  water: { depth: 20, albedo: [0.02, 0.045, 0.07], roughness: 0.06 },
  terrain: { ampScale: [1, 1, 1, 1, 1] },
  offTrackLoss: 0.32,
  sky: { tint: [1, 1, 1], ambientScale: 1 },
  flora: {
    spacing: 230,
    kinds: [{
      name: 'pine', mesh: () => treeMesh(), scaleRange: [0.72, 1.38],
      radiusOf: (s) => 92 * s * 0.42, sink: 22, weight: 1, material: { tint: pineTint },
    }],
  },
  dust: null,
  map: { road: '#4a4c58', water: '#2a4a78' },
};

const DESERT: Biome = {
  key: 'desert', label: 'desert',
  ground: { albedo: [0.32, 0.24, 0.15], roughness: 0.78 },
  tarmac: { albedo: [0.10, 0.09, 0.08], roughness: 0.82 },
  kerb: [[0.58, 0.10, 0.06], [0.78, 0.74, 0.62]],
  water: { depth: null, albedo: [0, 0, 0], roughness: 1 },
  // long dunes, soft ramps: the long-swell slope at 1.6x is 6.7 degrees,
  // well under the shoulder's 24-degree climb limit — a bigger dune and
  // still ground a truck can leave at a jog if it runs wide
  terrain: { ampScale: [1.6, 1.4, 0.6, 0.4, 0.5] },
  // sand: a truck that runs wide sinks and slews rather than merely losing
  // a third of its grip
  offTrackLoss: 0.45,
  sky: { tint: [1.05, 0.98, 0.85], ambientScale: 1.05 },
  flora: {
    spacing: 260,
    kinds: [
      {
        name: 'cactus', mesh: cactusMesh, scaleRange: [0.7, 1.3],
        radiusOf: (s) => 38 * s, sink: 15, weight: 0.6,
        material: { albedo: [0.16, 0.28, 0.14], roughness: 0.7 },
      },
      {
        name: 'rock', mesh: rockMesh, scaleRange: [0.6, 1.6],
        radiusOf: (s) => 78 * s * 0.5, sink: 20, weight: 0.4,
        material: { albedo: [0.30, 0.24, 0.18], roughness: 0.85 },
      },
    ],
  },
  dust: [0.72, 0.62, 0.45],
  map: { road: '#4a463a', water: '#2a4a78' },
};

const SNOW: Biome = {
  key: 'snow', label: 'snow',
  ground: { albedo: [0.82, 0.85, 0.90], roughness: 0.5 },
  tarmac: { albedo: [0.05, 0.055, 0.065], roughness: 0.8 },
  kerb: [[0.55, 0.08, 0.06], [0.85, 0.86, 0.90]],
  // frozen: real water, drawn pale and semi-gloss rather than a black
  // mirror, and the ice's own grip loss is on the vehicle side (see
  // `track.ts`'s surface read) rather than here
  water: { depth: 20, albedo: [0.75, 0.82, 0.90], roughness: 0.28 },
  terrain: { ampScale: [1, 1, 1, 1, 1] },
  offTrackLoss: 0.4,
  sky: { tint: [0.95, 1.0, 1.08], ambientScale: 1.25 },
  flora: {
    spacing: 240,
    kinds: [{
      name: 'fir', mesh: firMesh, scaleRange: [0.75, 1.3],
      radiusOf: (s) => 78 * s * 0.4, sink: 20, weight: 1,
      material: { albedo: [0.05, 0.16, 0.09], roughness: 0.7 },
    }],
  },
  dust: [0.92, 0.94, 1.0],
  map: { road: '#4a4c58', water: '#8fa6bc' },
};

const MARSH: Biome = {
  key: 'marsh', label: 'marsh',
  ground: { albedo: [0.09, 0.11, 0.07], roughness: 0.7 },
  tarmac: { albedo: [0.05, 0.055, 0.05], roughness: 0.85 },
  kerb: [[0.55, 0.09, 0.06], [0.72, 0.72, 0.68]],
  // A ford's depth, the same as the forest's, over flatter ground — so the
  // same 20mm spreads into wide shallows. It was 110, meant to make a marsh
  // mostly water, and never came out as anything but 20: the start-line
  // check that lowered it ran out of tries on every circuit. Once that was
  // fixed, 110 was allowed through on flat circuits and drowned them — half
  // the arena under water at the median, the road and its kerbs vanishing
  // under the opaque water a car's length from the grid, and nothing
  // planted, because nothing grows in water. A marsh that is mostly water
  // needs a road that stays visible in it and reeds that stand in it first.
  water: { depth: 20, albedo: [0.05, 0.08, 0.06], roughness: 0.15 },
  // flatter, so the deeper water spreads into wide shallows rather than a
  // few deep lakes
  terrain: { ampScale: [0.5, 0.5, 0.4, 0.3, 0.6] },
  offTrackLoss: 0.4,
  sky: { tint: [0.92, 0.97, 0.90], ambientScale: 0.85 },
  flora: {
    spacing: 220,
    kinds: [
      {
        name: 'reed', mesh: reedMesh, scaleRange: [0.7, 1.4],
        radiusOf: () => 0, sink: 40, weight: 0.65,
        material: { albedo: [0.24, 0.30, 0.14], roughness: 0.7 },
      },
      {
        name: 'deadwood', mesh: deadTreeMesh, scaleRange: [0.8, 1.4],
        radiusOf: (s) => 26 * s * 0.5, sink: 30, weight: 0.35,
        material: { albedo: [0.14, 0.11, 0.09], roughness: 0.85 },
      },
    ],
  },
  dust: [0.35, 0.32, 0.28],
  map: { road: '#3c4038', water: '#2f4a3a' },
};

export const BIOMES: Record<BiomeKey, Biome> = { forest: FOREST, desert: DESERT, snow: SNOW, marsh: MARSH };
export function labelOfBiome(key: BiomeKey): string { return BIOMES[key].label; }

/** The biome in force. A live global for the same reason `SIZE` is one: the
 *  things that read it — the terrain, the flora, the sky, the surface grip —
 *  are themselves module-level singletons rebuilt by `useTrack`. */
export let BIOME: Biome = FOREST;
export function setBiome(key: BiomeKey) { BIOME = BIOMES[key]; }
