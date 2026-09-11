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

/** Several meshes as one, each moved by its own offset. */
function merged(parts: [Mesh, number, number, number][]): Mesh {
  const count = (k: 'positions' | 'uvs' | 'indices') => parts.reduce((n, [m]) => n + m[k].length, 0);
  const positions = new Float32Array(count('positions'));
  const normals = new Float32Array(count('positions'));
  const uvs = new Float32Array(count('uvs'));
  const indices = new Uint32Array(count('indices'));
  let p = 0, u = 0, i = 0;
  for (const [m, dx, dy, dz] of parts) {
    const base = p / 3;
    for (let k = 0; k < m.positions.length; k += 3) {
      positions[p + k] = m.positions[k] + dx;
      positions[p + k + 1] = m.positions[k + 1] + dy;
      positions[p + k + 2] = m.positions[k + 2] + dz;
    }
    normals.set(m.normals, p);
    uvs.set(m.uvs, u);
    for (let k = 0; k < m.indices.length; k++) indices[i + k] = m.indices[k] + base;
    p += m.positions.length; u += m.uvs.length; i += m.indices.length;
  }
  return { positions, normals, uvs, indices };
}

/**
 * A saguaro: a tall trunk and two arms, each an elbow out of the trunk and
 * an upright, one higher and longer than the other. It was the trunk alone,
 * and a desert of them at night read as a car park full of bollards. The
 * arms stand above anything a car reaches, so the collision stays the
 * trunk's.
 */
export function cactusMesh(): Mesh {
  return merged([
    [prism(38, 340, 8), 0, 0, 0],
    [box(58, 26, 26), 58, 0, 150],
    [prism(21, 120, 7), 78, 0, 140],
    [box(50, 24, 24), -52, 0, 205],
    [prism(19, 80, 7), -68, 0, 196],
  ]);
}

/** A clump of reeds standing in shallow water: six stems of different
 *  heights round a hand's width. No collision (see `flora.ts`) — a reed bed
 *  is something a wheel goes through, not off the road for. */
export function reedMesh(): Mesh {
  const stems: [number, number, number, number][] = [
    [0, 0, 270, 8], [26, 10, 210, 7], [-18, 22, 240, 7],
    [-24, -14, 190, 6], [12, -26, 230, 7], [34, -18, 170, 6],
  ];
  return merged(stems.map(([x, y, h, r]) => [prism(r, h, 5), x, y, 0]));
}

/** A dead tree: a bare trunk, no canopy, for the marsh biome's drowned
 *  ground — the pine cone with nothing at all above the trunk reads wrong
 *  once there is water round its foot, and this is what stands in it instead. */
export function deadTreeMesh(): Mesh {
  return box(26, 26, 320);
}
