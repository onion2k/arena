/**
 * What kind of circuit this is, and what may be raced on it.
 *
 * A bumpy, twisting circuit is the whole point of a rally car and the ruin
 * of a Le Mans prototype: the one has travel in its springs and a short
 * wheelbase to throw about, the other has neither and is quick only where
 * the road is smooth and the corners are long. The arena used to offer every
 * car on every circuit, which meant three quarters of the pairings were
 * somebody driving the wrong car — an F1 car crawling over a ramp band at
 * walking pace, or a technical sliding round a circuit that never asked it
 * to turn.
 *
 * So there are two kinds of circuit, and each takes the two cars it is for:
 *
 * - **Rally**: the ground the game shipped with. Swells, ramps, tight
 *   corners, and the wild circuits — for the technical and the rally car.
 * - **Track**: a racing circuit. The ground nearly flat, the corners long,
 *   and a lap that rewards carrying speed — for the prototype and the F1.
 *
 * The rest of the arena is unchanged between them: the same biomes, the same
 * sizes, the same furniture, the same night.
 */

import type { VehicleKey } from './vehicles';

export type TrackKind = 'rally' | 'track';

export interface KindSpec {
  key: TrackKind;
  label: string;
  /** The cars this kind of circuit is for, in the order they are offered. */
  vehicles: VehicleKey[];
  /**
   * What the ground does, as a factor on the biome's own wave amplitudes —
   * swell, swell, roll, roll, ramp, in `terrain.ts`'s order. A rally circuit
   * takes the biome as it is; a racing circuit keeps a little of the long
   * swell, so the road still rises and falls over a lap, and almost none of
   * the ramps, which are jumps and have no business on a racing line.
   */
  terrain: number[];
  /**
   * What the circuit itself must clear. `curve` is the tightest corner
   * allowed, in millimetres of radius: the rally figure is the technical's
   * own turning circle, and the racing one is a corner a prototype can take
   * without lifting. The length band moves with it, because a lap of long
   * corners is a longer lap.
   */
  curve: number;
  /**
   * How far the tightest corner allowed may vary from one seed to the next,
   * as a pair of millimetre figures that `curve` is drawn between.
   *
   * Left out, every circuit of the kind is held to the same `curve` — which
   * is right for a rally stage, where the limit is the car's turning circle
   * and a tighter corner is undrivable rather than interesting. It is wrong
   * for a racing track: held to one figure the generator made sixteen
   * circuits whose slowest corner ran from 83% to 93% of top speed, which
   * is sixteen versions of the same lap. Real circuits differ in exactly
   * this — a hairpin at the end of a straight is a different track from a
   * sequence of fast sweeps — so a track draws its own limit, and some of
   * them have a slow corner on them.
   */
  curveRange?: [number, number];
  minLength: number;
  maxLength: number;
  /** Whether the wild circuits — straights and hairpins — are offered. */
  wild: boolean;
  /**
   * Half the width of the tarmac, in millimetres.
   *
   * A rally stage is 380, the width the game shipped with: a lane and a
   * half, where the line you take is mostly the one the road gives you. A
   * racing circuit is wider, because the whole of racing on one is choosing
   * a line — brake on the outside, clip the apex, run out to the far edge —
   * and on a stage's width there is nowhere to do it. It showed the moment
   * the racing line was drawn: the line had the road's own shape because
   * there was no room for another.
   *
   * 560 is 1120 across. Against the cars raced on a track, 110 and 130
   * wide, that is eight and a half to ten car widths; a real circuit runs
   * six to seven and a half, and this one is drawn from above at a distance
   * where generous reads as right.
   */
  half: number;
}

export const KINDS: Record<TrackKind, KindSpec> = {
  rally: {
    key: 'rally',
    label: 'rally',
    vehicles: ['technical', 'rally'],
    terrain: [1, 1, 1, 1, 1],
    curve: 600,
    minLength: 24000,
    maxLength: 34000,
    wild: true,
    half: 380,
  },
  track: {
    key: 'track',
    label: 'track',
    vehicles: ['lmp', 'f1'],
    // the long swell stays, at a third: a racing circuit is not a billiard
    // table, and a crest the car goes light over is worth keeping. The ramps
    // go to a twentieth, which is a texture rather than a jump.
    terrain: [0.34, 0.3, 0.18, 0.14, 0.05],
    // The average of the range below, for anything that asks without a
    // seed. Against a prototype's own turning circle of 561 and an F1's of
    // 691, every corner in the range is one either can take: the slow end
    // is a hairpin they brake hard for, the fast end a corner that is
    // barely one.
    curve: 1500,
    // 1100 to 2500: the floor is twice the half width and a little, since
    // a corner tighter than the road is wide folds its own inside edge over
    curveRange: [1100, 2500],
    minLength: 26000,
    maxLength: 38000,
    wild: false,
    half: 560,
  },
};

export const KIND_KEYS: TrackKind[] = ['rally', 'track'];

export function kindOf(key: TrackKind): KindSpec { return KINDS[key] ?? KINDS.rally; }

/** Whether a car may be raced on this kind of circuit. */
export function allows(kind: TrackKind, vehicle: VehicleKey): boolean {
  return kindOf(kind).vehicles.includes(vehicle);
}

/** The car to fall back to when the one chosen is not for this circuit. */
export function defaultVehicle(kind: TrackKind): VehicleKey {
  return kindOf(kind).vehicles[0];
}

/** Which kind of circuit a car belongs to, for coercing an old setting. */
export function kindForVehicle(vehicle: VehicleKey): TrackKind {
  return KINDS.track.vehicles.includes(vehicle) ? 'track' : 'rally';
}
