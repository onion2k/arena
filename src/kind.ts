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
   * without lifting — about what a fast car does at two thirds of its top
   * speed. The length band moves with it, because a lap of long corners is
   * a longer lap.
   */
  curve: number;
  minLength: number;
  maxLength: number;
  /** Whether the wild circuits — straights and hairpins — are offered. */
  wild: boolean;
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
  },
  track: {
    key: 'track',
    label: 'track',
    vehicles: ['lmp', 'f1'],
    // the long swell stays, at a third: a racing circuit is not a billiard
    // table, and a crest the car goes light over is worth keeping. The ramps
    // go to a twentieth, which is a texture rather than a jump.
    terrain: [0.34, 0.3, 0.18, 0.14, 0.05],
    // 1500mm, against a prototype's own turning circle of 561 and an F1's
    // of 691: every corner here is one either can take without a lift, and
    // most are a good deal quicker than that. The point is not that the car
    // fits — it is that the corner is worth carrying speed into.
    curve: 1500,
    minLength: 26000,
    maxLength: 38000,
    wild: false,
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
