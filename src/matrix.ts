/**
 * Just enough matrix for a game that only ever places things flat on a
 * floor: a turn about Z, a uniform scale, and somewhere to put it.
 *
 * Column-major, as WebGPU wants: element (row r, column c) lives at c * 4 + r,
 * which puts the translation in the last four.
 */

/** Write one placement at `i` in a pool of column-major 4×4s. */
export function place(
  out: Float32Array, i: number,
  x: number, y: number, z: number,
  angle = 0, scale = 1,
) {
  const o = i * 16;
  const c = Math.cos(angle) * scale;
  const s = Math.sin(angle) * scale;
  out[o] = c; out[o + 1] = s; out[o + 2] = 0; out[o + 3] = 0;
  out[o + 4] = -s; out[o + 5] = c; out[o + 6] = 0; out[o + 7] = 0;
  out[o + 8] = 0; out[o + 9] = 0; out[o + 10] = scale; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

/**
 * As `place`, but tipped about its own X first, so a thing modelled lying
 * down can stand up and still turn to face where it is going.
 */
export function placeTipped(
  out: Float32Array, i: number,
  x: number, y: number, z: number,
  angle: number, pitch: number, scale = 1,
) {
  const o = i * 16;
  const ca = Math.cos(angle); const sa = Math.sin(angle);
  const cp = Math.cos(pitch); const sp = Math.sin(pitch);
  // Rz(angle) · Rx(pitch), scaled
  out[o] = ca * scale; out[o + 1] = sa * scale; out[o + 2] = 0; out[o + 3] = 0;
  out[o + 4] = -sa * cp * scale; out[o + 5] = ca * cp * scale; out[o + 6] = sp * scale; out[o + 7] = 0;
  out[o + 8] = sa * sp * scale; out[o + 9] = -ca * sp * scale; out[o + 10] = cp * scale; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

/** Park a placement where nothing can see it, for a slot in a pool that is not live. */
export function hide(out: Float32Array, i: number) {
  place(out, i, 0, 0, -1e5, 0, 0);
}

/**
 * A world point in normalised device coordinates, given a column-major
 * view-projection: x and y across the frame in -1 to 1, then the view depth
 * `w` in world units, then depth in 0 to 1 where 1 is the far plane.
 *
 * Returns null behind the camera, where the perspective divide turns the
 * picture inside out. Effects are placed with the first three; the fourth is
 * how the camera's own fit knows a corner has fallen out the back.
 */
export function project(
  vp: Float32Array, x: number, y: number, z: number,
): [number, number, number, number] | null {
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const cz = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (cw <= 1e-4) return null;
  return [cx / cw, cy / cw, cw, cz / cw];
}
