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

/**
 * A wheel: axle across a body pointing along `yaw`, spinning by `spin`.
 *
 * `placeTipped` cannot do this — it composes two rotations and a wheel needs
 * three. The order is Rz(yaw) · Rx(90°) · Rz(spin): turn with the truck, lay
 * the disc over so its axis runs across it, then roll it about that axis.
 * The spin only shows because the disc has bolts on its face; a plain
 * cylinder would be turning invisibly.
 */
export function placeAxle(
  out: Float32Array, i: number,
  x: number, y: number, z: number,
  yaw: number, spin: number, scale = 1,
) {
  const o = i * 16;
  const cy = Math.cos(yaw) * scale; const sy = Math.sin(yaw) * scale;
  const cs = Math.cos(spin); const ss = Math.sin(spin);
  out[o] = cy * cs; out[o + 1] = sy * cs; out[o + 2] = ss * scale; out[o + 3] = 0;
  out[o + 4] = -cy * ss; out[o + 5] = -sy * ss; out[o + 6] = cs * scale; out[o + 7] = 0;
  out[o + 8] = sy; out[o + 9] = -cy; out[o + 10] = 0; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

/**
 * A placement standing on sloping ground: turned to `yaw` about the world's
 * up, then tipped so that its own up is the ground's normal.
 *
 * The heading is projected onto the ground plane rather than composed as a
 * second rotation, which keeps a thing pointing the way it was asked to point
 * however steep the slope under it.
 */
export function placeOnSlope(
  out: Float32Array, i: number,
  x: number, y: number, z: number,
  yaw: number, n: [number, number, number], scale = 1,
) {
  let fx = Math.cos(yaw); let fy = Math.sin(yaw); let fz = 0;
  const along = fx * n[0] + fy * n[1] + fz * n[2];
  fx -= n[0] * along; fy -= n[1] * along; fz -= n[2] * along;
  const len = Math.hypot(fx, fy, fz) || 1;
  fx /= len; fy /= len; fz /= len;
  const lx = n[1] * fz - n[2] * fy;
  const ly = n[2] * fx - n[0] * fz;
  const lz = n[0] * fy - n[1] * fx;
  const o = i * 16;
  out[o] = fx * scale; out[o + 1] = fy * scale; out[o + 2] = fz * scale; out[o + 3] = 0;
  out[o + 4] = lx * scale; out[o + 5] = ly * scale; out[o + 6] = lz * scale; out[o + 7] = 0;
  out[o + 8] = n[0] * scale; out[o + 9] = n[1] * scale; out[o + 10] = n[2] * scale; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

/**
 * A body's full placement from its three angles, as the vehicle carries them:
 * Rz(yaw) · Ry(pitch) · Rx(roll), with an optional extra turn about its own
 * up (a steered wheel) and a roll about its own axle (a turning one).
 */
export function placeVehiclePart(
  out: Float32Array, i: number,
  x: number, y: number, z: number,
  yaw: number, pitch: number, roll: number,
  scale = 1,
) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const o = i * 16;
  out[o] = cy * cp * scale; out[o + 1] = sy * cp * scale; out[o + 2] = -sp * scale; out[o + 3] = 0;
  out[o + 4] = (cy * sp * sr - sy * cr) * scale;
  out[o + 5] = (sy * sp * sr + cy * cr) * scale;
  out[o + 6] = cp * sr * scale; out[o + 7] = 0;
  out[o + 8] = (cy * sp * cr + sy * sr) * scale;
  out[o + 9] = (sy * sp * cr - cy * sr) * scale;
  out[o + 10] = cp * cr * scale; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

/**
 * A wheel on a body: the body's own rotation, then a steer about its up, then
 * the roll about the axle. The disc is modelled about its own z, so it is laid
 * over a quarter turn on the way.
 */
export function placeVehicleWheel(
  out: Float32Array, i: number,
  x: number, y: number, z: number,
  yaw: number, pitch: number, roll: number,
  steer: number, spin: number,
) {
  const body = new Float32Array(16);
  placeVehiclePart(body, 0, 0, 0, 0, yaw, pitch, roll);
  const cs = Math.cos(steer), ss = Math.sin(steer);
  // steer about the body's up, then lay the disc over and roll it
  const cq = Math.cos(spin), sq = Math.sin(spin);
  // local = Rz(steer) · Rx(90°) · Rz(spin)
  const l = [
    cs * cq, -cs * sq, ss,
    ss * cq, -ss * sq, -cs,
    sq, cq, 0,
  ];
  const o = i * 16;
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += body[k * 4 + r] * l[k * 3 + c];
      out[o + c * 4 + r] = v;
    }
    out[o + c * 4 + 3] = 0;
  }
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

/**
 * A disc-shaped part on the body with its face looking along the nose — a
 * headlamp rather than a wheel.
 *
 * The two are easy to confuse because both are discs bolted to the truck, and
 * `placeVehicleWheel` will happily place either. It puts the disc's axis
 * across the body, which is right for something that rolls and wrong for
 * something that shines: the lamps were mounted sideways, looking out of the
 * flanks of the truck.
 *
 * The disc is modelled about its own z, so this is the body's rotation with a
 * quarter turn about its left axis composed on: the part's z becomes the
 * body's forward, its y stays the body's left, and its x becomes the body's
 * down, which keeps the frame right-handed.
 */
export function placeVehicleFacing(
  out: Float32Array, i: number,
  x: number, y: number, z: number,
  yaw: number, pitch: number, roll: number,
  scale = 1,
) {
  const body = new Float32Array(16);
  placeVehiclePart(body, 0, 0, 0, 0, yaw, pitch, roll);
  const o = i * 16;
  for (let r = 0; r < 3; r++) {
    out[o + r] = -body[8 + r] * scale;        // the part's x is the body's down
    out[o + 4 + r] = body[4 + r] * scale;     // its y is the body's left
    out[o + 8 + r] = body[r] * scale;         // its z is the body's forward
  }
  out[o + 3] = 0; out[o + 7] = 0; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}
