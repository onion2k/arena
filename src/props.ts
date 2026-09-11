/**
 * The shapes trackside props are built from: cones, spikes, rocks, reeds.
 *
 * Pure geometry, and nothing else — no biome, no planting, no placement. A
 * mesh here knows only its own size, the same way `treeMesh` always did;
 * where one stands and how many of it there are is `flora.ts`'s job, and
 * which biome asks for which kind is `biomes.ts`'s.
 */
import type { Mesh } from 'artshape-render/mesh/types';
import { box, prism } from './scene';

/**
 * The unit pine: foot on z = 0 of radius `r`, apex at `h`, flat shaded. Each
 * face gets its own three vertices so the normal is the face's and the
 * silhouette reads as facets rather than as a smooth shape trying to be
 * round with seven sides. No base — the ground is there.
 */
export function treeMesh(r = 92, h = 300, sides = 7): Mesh {
  const positions = new Float32Array(sides * 9);
  const normals = new Float32Array(sides * 9);
  const uvs = new Float32Array(sides * 6);
  const indices = new Uint32Array(sides * 3);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p = [
      [r * Math.cos(a0), r * Math.sin(a0), 0],
      [r * Math.cos(a1), r * Math.sin(a1), 0],
      [0, 0, h],
    ];
    const am = (a0 + a1) / 2;
    const nl = Math.hypot(h, r);
    const n = [(Math.cos(am) * h) / nl, (Math.sin(am) * h) / nl, r / nl];
    for (let k = 0; k < 3; k++) {
      const o = (i * 3 + k) * 3;
      positions[o] = p[k][0]; positions[o + 1] = p[k][1]; positions[o + 2] = p[k][2];
      normals[o] = n[0]; normals[o + 1] = n[1]; normals[o + 2] = n[2];
      uvs[(i * 3 + k) * 2] = k === 2 ? 0.5 : k; uvs[(i * 3 + k) * 2 + 1] = k === 2 ? 1 : 0;
      indices[i * 3 + k] = i * 3 + k;
    }
  }
  return { positions, normals, uvs, indices };
}

/** A tighter, two-tier version of the pine, for a snowy biome: a narrower
 *  cone standing on a wider one, closer to a fir's silhouette than one cone
 *  stretched to the same height would be. */
export function firMesh(): Mesh {
  const lower = treeMesh(78, 190, 7);
  const upper = treeMesh(52, 170, 7);
  const positions = new Float32Array(lower.positions.length + upper.positions.length);
  const normals = new Float32Array(lower.normals.length + upper.normals.length);
  const uvs = new Float32Array(lower.uvs.length + upper.uvs.length);
  const indices = new Uint32Array(lower.indices.length + upper.indices.length);
  positions.set(lower.positions, 0); positions.set(upper.positions, lower.positions.length);
  normals.set(lower.normals, 0); normals.set(upper.normals, lower.normals.length);
  uvs.set(lower.uvs, 0); uvs.set(upper.uvs, lower.uvs.length);
  // the upper cone sits raised on top of the lower one, so its z is offset
  const upperZ = upper.positions.slice();
  for (let i = 2; i < upperZ.length; i += 3) upperZ[i] += 140;
  positions.set(upperZ, lower.positions.length);
  indices.set(lower.indices, 0);
  const base = lower.positions.length / 3;
  for (let i = 0; i < upper.indices.length; i++) indices[lower.indices.length + i] = upper.indices[i] + base;
  return { positions, normals, uvs, indices };
}

/** A squat, jittered low prism — a desert rock. Eight sides is enough to
 *  read as a boulder rather than a drum once it is scattered and turned. */
export function rockMesh(): Mesh {
  return prism(78, 62, 8);
}

/** A saguaro-shaped cactus: one tall trunk. A silhouette this simple, spread
 *  a hundred to a lap, reads as desert scrub the same way the pine reads as
 *  forest — the point is the crowd, not any one plant. */
export function cactusMesh(): Mesh {
  return prism(38, 340, 8);
}

/** A thin cluster standing in shallow water — no collision (see `flora.ts`),
 *  since a reed bed is something a wheel goes through, not off the road for. */
export function reedMesh(): Mesh {
  return prism(14, 260, 5);
}

/** A dead tree: a bare trunk, no canopy, for the marsh biome's drowned
 *  ground — the pine cone with nothing at all above the trunk reads wrong
 *  once there is water round its foot, and this is what stands in it instead. */
export function deadTreeMesh(): Mesh {
  return box(26, 26, 320);
}
