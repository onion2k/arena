/**
 * The vehicles, modelled: what each class actually looks like.
 *
 * A class draws as two groups (see `VehicleKit`): a body the paint goes on,
 * and one unpainted detail group — glass, wings, a gun, a halo — in a single
 * dark material. So each is built here as many simple solids merged into one
 * mesh a group, in the body's own frame: x forward, y to the left, z up,
 * millimetres from the body's centre. Where the ground and the wheels are in
 * that frame is the physics' business and not the model's; the numbers each
 * model is built round are the ones the vehicle settles to at rest:
 *
 * | | ground | hubs | wheels |
 * | --- | ---: | ---: | --- |
 * | technical | −55 | −24 | x ±110, y ±64, r 31 |
 * | rally car | −57 | −29 | x ±95, y ±60, r 28 |
 * | prototype | −50 | −20 | x ±128, y ±62, r 30 |
 * | F1 car | −53 | −19 | x ±138, y ±68, r 34 |
 *
 * They were a card-shaped plate each, with one block on it.
 *
 * The solids: a hull is a side profile swept across the car with a half
 * width at every point, which is enough for a body that narrows toward its
 * roof or its nose; a slab is a plan outline swept up; a rod joins two
 * points. Every triangle has its own vertices and its own normal, flat
 * shaded like everything else out here.
 */
import type { Mesh } from 'artshape-render/mesh/types';

type V3 = [number, number, number];
type P2 = [number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Twice the signed area of a 2D loop: positive when anticlockwise. */
function area2(pts: P2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  }
  return s;
}

/** Triangles filling a simple 2D loop, by clipping ears. Any orientation in;
 *  indices into the loop out. */
function earClip(pts: P2[]): [number, number, number][] {
  const idx = pts.map((_, i) => i);
  if (area2(pts) < 0) idx.reverse();
  const turn = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  // strictly inside: a point on an edge — a vertex partway along a straight
  // sill — does not stop that ear being clipped
  const inside = (p: P2, a: P2, b: P2, c: P2) => turn(a, b, p) > 1e-9 && turn(b, c, p) > 1e-9 && turn(c, a, p) > 1e-9;
  const out: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 4096) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (turn(pts[a], pts[b], pts[c]) <= 1e-9) continue;
      if (idx.some((j) => j !== a && j !== b && j !== c && inside(pts[j], pts[a], pts[b], pts[c]))) continue;
      out.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // nothing but straight runs left: drop a vertex that lies on one
      const flat = idx.findIndex((b, i) => Math.abs(turn(pts[idx[(i + idx.length - 1) % idx.length]], pts[b], pts[idx[(i + 1) % idx.length]])) <= 1e-9);
      if (flat < 0) break;
      idx.splice(flat, 1);
    }
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/** Triangles going into one mesh. */
export class Solid {
  private p: number[] = [];
  private n: number[] = [];

  /** One triangle, its normal turned to agree with `outward` if given. */
  tri(a: V3, b: V3, c: V3, outward?: V3) {
    let nrm = cross(sub(b, a), sub(c, a));
    const len = Math.hypot(nrm[0], nrm[1], nrm[2]);
    if (len < 1e-9) return;
    nrm = [nrm[0] / len, nrm[1] / len, nrm[2] / len];
    if (outward && dot(nrm, outward) < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
    for (const v of [a, b, c]) { this.p.push(v[0], v[1], v[2]); this.n.push(nrm[0], nrm[1], nrm[2]); }
  }

  quad(a: V3, b: V3, c: V3, d: V3, outward?: V3) {
    this.tri(a, b, c, outward);
    this.tri(a, c, d, outward);
  }

  /**
   * A side profile swept across the car: `loop` is [x, z, half width] round
   * the outline, centred on `y`. Where the half width changes from point to
   * point the sides lean, which is how a roof is narrower than a sill.
   */
  hull(loop: [number, number, number][], y = 0): this {
    const pts = area2(loop.map(([x, z]) => [x, z])) < 0 ? [...loop].reverse() : loop;
    const L = pts.map(([x, z, w]): V3 => [x, y + w, z]);
    const R = pts.map(([x, z, w]): V3 => [x, y - w, z]);
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const dx = pts[j][0] - pts[i][0], dz = pts[j][1] - pts[i][1];
      this.quad(L[i], L[j], R[j], R[i], [dz, 0, -dx]);
    }
    for (const [a, b, c] of earClip(pts.map(([x, z]) => [x, z]))) {
      this.tri(L[a], L[b], L[c], [0, 1, 0]);
      this.tri(R[a], R[b], R[c], [0, -1, 0]);
    }
    return this;
  }

  /** A flat side profile of constant thickness between y0 and y1. */
  sideways(loop: P2[], y0: number, y1: number): this {
    return this.hull(loop.map(([x, z]) => [x, z, (y1 - y0) / 2]), (y0 + y1) / 2);
  }

  /** A plan outline in x and y, swept up from z0 to z1. */
  slab(outline: P2[], z0: number, z1: number): this {
    const pts = area2(outline) < 0 ? [...outline].reverse() : outline;
    const B = pts.map(([x, y]): V3 => [x, y, z0]);
    const T = pts.map(([x, y]): V3 => [x, y, z1]);
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
      this.quad(B[i], B[j], T[j], T[i], [dy, -dx, 0]);
    }
    for (const [a, b, c] of earClip(pts)) {
      this.tri(T[a], T[b], T[c], [0, 0, 1]);
      this.tri(B[a], B[b], B[c], [0, 0, -1]);
    }
    return this;
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): this {
    return this.slab([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1);
  }

  /** A rod of `sides` flats from one point to another. */
  rod(a: V3, b: V3, r: number, sides = 6): this {
    const w = sub(b, a);
    const len = Math.hypot(w[0], w[1], w[2]);
    if (len < 1e-9) return this;
    const k: V3 = [w[0] / len, w[1] / len, w[2] / len];
    const helper: V3 = Math.abs(k[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = cross(k, helper);
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v = cross(k, u);
    const ring = (c: V3, i: number): V3 => {
      const t = (i / sides) * Math.PI * 2;
      const cu = Math.cos(t) * r, sv = Math.sin(t) * r;
      return [c[0] + u[0] * cu + v[0] * sv, c[1] + u[1] * cu + v[1] * sv, c[2] + u[2] * cu + v[2] * sv];
    };
    for (let i = 0; i < sides; i++) {
      const a0 = ring(a, i), a1 = ring(a, i + 1), b0 = ring(b, i), b1 = ring(b, i + 1);
      const t = ((i + 0.5) / sides) * Math.PI * 2;
      const out: V3 = [u[0] * Math.cos(t) + v[0] * Math.sin(t), u[1] * Math.cos(t) + v[1] * Math.sin(t), u[2] * Math.cos(t) + v[2] * Math.sin(t)];
      this.quad(a0, a1, b1, b0, out);
      this.tri(a, a1, a0, [-k[0], -k[1], -k[2]]);
      this.tri(b, b0, b1, k);
    }
    return this;
  }

  /** Rods along a polyline. */
  path(points: V3[], r: number, sides = 6): this {
    for (let i = 0; i + 1 < points.length; i++) this.rod(points[i], points[i + 1], r, sides);
    return this;
  }

  mesh(): Mesh {
    const count = this.p.length / 3;
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    return {
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      uvs: new Float32Array(count * 2),
      indices,
    };
  }
}

/** Both sides of the car: `f(1)` for the left, `f(-1)` for the right. */
const both = (f: (side: 1 | -1) => void) => { f(1); f(-1); };

/**
 * The bottom edge of a side profile, rear to front, with a wheel arch cut
 * over each axle: `z` is the sill, `hub` the height the arch is centred on,
 * `r` its radius.
 */
function sillWithArches(xRear: number, xFront: number, z: number, axles: number[], hub: number, r: number, steps = 7): P2[] {
  const out: P2[] = [[xRear, z]];
  for (const ax of [...axles].sort((a, b) => a - b)) {
    out.push([ax - r, z], [ax - r, hub]);
    for (let s = 1; s < steps; s++) {
      const t = Math.PI - (s / steps) * Math.PI;
      out.push([ax + Math.cos(t) * r, hub + Math.sin(t) * r]);
    }
    out.push([ax + r, hub], [ax + r, z]);
  }
  out.push([xFront, z]);
  return out;
}

const withWidth = (pts: P2[], w: number): [number, number, number][] => pts.map(([x, z]) => [x, z, w]);

/* ------------------------------------------------------------------------ */

/**
 * The technical: a crew-cab pickup with a heavy machine gun on a pedestal in
 * its bed and a roll bar behind the cab. Square, upright, a long bonnet — a
 * working truck that someone has bolted a gun to.
 */
export function technicalBody(): Mesh {
  const s = new Solid();
  // the lower body, bumper to tailgate, arches over both wheels, a bonnet
  // that rises a little to the windscreen
  s.hull(withWidth([
    ...sillWithArches(-190, 190, -36, [-110, 110], -24, 37),
    [196, -30], [196, -6], [190, 12], [52, 20], [-190, 22], [-196, 18], [-196, -30],
  ], 72));
  // the cab: raked windscreen, flat roof, upright back
  s.hull([[-46, 22, 66], [50, 20, 66], [14, 88, 60], [-44, 90, 60]]);
  // the bed's sides and tailgate
  both((side) => s.box(-192, -50, side > 0 ? 62 : -72, side > 0 ? 72 : -62, 20, 46));
  s.box(-196, -186, -72, 72, 18, 46);
  // wheel-arch flares
  both((side) => {
    for (const ax of [-110, 110]) {
      s.sideways([[ax - 44, -10], [ax - 30, 14], [ax + 30, 14], [ax + 44, -10], [ax + 38, -10], [ax + 26, 8], [ax - 26, 8], [ax - 38, -10]],
        side > 0 ? 70 : -76, side > 0 ? 76 : -70);
    }
  });
  return s.mesh();
}

export function technicalDetail(): Mesh {
  const s = new Solid();
  // glass: windscreen, side windows, the back window
  s.hull([[48, 25, 58], [51, 26, 58], [18, 84, 55], [15, 83, 55]]);
  both((side) => s.sideways([[-38, 50], [30, 50], [17, 82], [-38, 83]], side > 0 ? 66 : -67.5, side > 0 ? 67.5 : -66));
  s.box(-47.5, -45, -52, 52, 50, 84);
  // grille, bumpers, the black plastic along the sills
  s.box(194, 198, -70, 70, -34, -14);
  s.box(196, 199, -40, 40, -8, 10);
  s.box(-200, -194, -70, 70, -34, -16);
  both((side) => s.box(-72, 72, side > 0 ? 70 : -74, side > 0 ? 74 : -70, -38, -28));
  // roll bar behind the cab
  both((side) => s.rod([-58, side * 60, 22], [-58, side * 60, 98], 4));
  s.rod([-58, -60, 98], [-58, 60, 98], 4);
  both((side) => s.rod([-58, side * 60, 94], [-90, side * 60, 46], 3));
  // the gun: a pedestal, the receiver, a long barrel over the cab, a shield
  s.rod([-120, 0, 20], [-120, 0, 104], 6, 8);
  s.box(-150, -104, -9, 9, 104, 120);
  s.rod([-104, 0, 113], [52, 0, 122], 3.5, 6);
  s.rod([40, 0, 121], [58, 0, 122], 5, 6);
  s.box(-138, -118, 9, 30, 96, 114);
  s.sideways([[-100, 98], [-96, 98], [-96, 136], [-100, 136]], -26, 26);
  s.rod([-150, 0, 112], [-170, 0, 104], 4);
  // mirrors
  both((side) => s.box(28, 38, side * 66, side * 80, 50, 62));
  return s.mesh();
}

/* ------------------------------------------------------------------------ */

/**
 * The rally car: a short, wide hatchback — a World Rally Car — with blistered
 * arches, a roof scoop, a big rear wing on stalks, a deep front splitter and
 * mud flaps behind every wheel.
 */
export function rallyBody(): Mesh {
  const s = new Solid();
  s.hull(withWidth([
    ...sillWithArches(-160, 164, -45, [-95, 95], -29, 34),
    [176, -36], [176, -6], [156, 8], [44, 20], [-146, 26], [-166, 14], [-168, -36],
  ], 70));
  // the greenhouse, narrowing to the roof, with the hatch sloping away
  s.hull([[-148, 24, 64], [44, 20, 66], [-6, 66, 52], [-112, 68, 52], [-160, 32, 60]]);
  // blistered arches, wider than the body
  both((side) => {
    for (const ax of [-95, 95]) {
      s.sideways([[ax - 42, -28], [ax - 26, 12], [ax + 26, 12], [ax + 42, -28], [ax + 34, -28], [ax + 22, 2], [ax - 22, 2], [ax - 34, -28]],
        side > 0 ? 68 : -78, side > 0 ? 78 : -68);
    }
  });
  return s.mesh();
}

export function rallyDetail(): Mesh {
  const s = new Solid();
  // glass
  s.hull([[42, 24, 58], [46, 25, 58], [-3, 64, 48], [-7, 63, 48]]);
  both((side) => s.sideways([[-104, 34], [26, 32], [-4, 62], [-104, 64]], side > 0 ? 58.5 : -60, side > 0 ? 60 : -58.5));
  s.hull([[-118, 64, 46], [-114, 66, 46], [-152, 36, 54], [-156, 35, 54]]);
  // roof scoop
  s.hull([[-40, 66, 12], [-6, 66, 14], [-12, 80, 12], [-40, 78, 12]]);
  // rear wing: two stalks, the plane, endplates
  both((side) => s.rod([-150, side * 36, 26], [-164, side * 36, 76], 3));
  s.hull([[-190, 72, 74], [-150, 76, 74], [-150, 82, 74], [-192, 80, 74]]);
  both((side) => s.sideways([[-196, 62], [-146, 70], [-146, 90], [-198, 86]], side > 0 ? 74 : -77, side > 0 ? 77 : -74));
  // splitter, grille, bumper, diffuser, mud flaps
  s.box(150, 186, -76, 76, -50, -44);
  s.box(176, 180, -44, 44, -30, -6);
  s.box(-172, -164, -66, 66, -46, -30);
  both((side) => {
    for (const ax of [-95, 95]) s.box(ax - 42, ax - 38, side > 0 ? 50 : -76, side > 0 ? 76 : -50, -56, -26);
  });
  // a light pod on the bonnet
  s.box(150, 158, -40, 40, 8, 20);
  return s.mesh();
}

/* ------------------------------------------------------------------------ */

/**
 * The Le Mans prototype: a closed endurance car, long and flat. A low nose
 * between high front fenders, a teardrop canopy, a shark fin down the engine
 * cover to a rear wing that overhangs the tail, a splitter and a diffuser.
 */
export function lmpBody(): Mesh {
  const s = new Solid();
  // the tub and the fenders: low nose rising over the front wheels, a flat
  // waist, rising again over the rear wheels to a squared tail
  s.hull([
    ...sillWithArches(-212, 214, -44, [-128, 128], -20, 36).map(([x, z]): [number, number, number] => [x, z, 76]),
    [226, -38, 60], [222, -26, 60], [170, 12, 76], [120, 18, 76], [80, 4, 72], [-80, 4, 72], [-130, 18, 76], [-176, 16, 76], [-218, 8, 72], [-220, -34, 72],
  ]);
  // the canopy, a teardrop set in the middle
  s.hull([[-86, 4, 44], [96, 2, 40], [18, 50, 30], [-36, 50, 32], [-110, 14, 26]]);
  // engine cover, tapering behind the canopy to the tail
  s.hull([[-190, 4, 30], [-40, 4, 40], [-40, 46, 26], [-190, 16, 12]]);
  return s.mesh();
}

export function lmpDetail(): Mesh {
  const s = new Solid();
  // windscreen and side glass
  s.hull([[92, 6, 32], [96, 7, 32], [21, 48, 24], [17, 47, 24]]);
  s.hull([[-40, 16, 38], [54, 12, 36], [14, 44, 30], [-30, 46, 32]]);
  // shark fin
  s.sideways([[-34, 46], [-44, 50], [-196, 38], [-196, 16]], -1.5, 1.5);
  // rear wing: plane, endplates, swan-neck supports
  s.hull([[-236, 38, 74], [-196, 42, 74], [-196, 48, 74], [-238, 46, 74]]);
  both((side) => s.sideways([[-244, 8], [-190, 12], [-190, 54], [-248, 50]], side > 0 ? 74 : -77, side > 0 ? 77 : -74));
  both((side) => s.path([[-196, side * 22, 12], [-206, side * 22, 56], [-218, side * 22, 50]], 3));
  // splitter, diffuser and its strakes
  s.box(186, 236, -78, 78, -50, -44);
  s.box(-226, -186, -62, 62, -48, -40);
  for (const y of [-40, -14, 14, 40]) s.box(-226, -190, y - 1.5, y + 1.5, -40, -26);
  // headlamp fairings and mirrors
  both((side) => s.hull([[196, -24, 10], [214, -30, 10], [212, -18, 10], [192, -12, 10]], side * 52));
  both((side) => { s.rod([78, side * 64, 6], [78, side * 74, 14], 1.5); s.box(72, 84, side * 72, side * 84, 12, 21); });
  return s.mesh();
}

/* ------------------------------------------------------------------------ */

/**
 * The F1 car: open wheels. A needle nose from a front wing that spans the
 * track, a survival cell with a halo over the cockpit, sidepods that pinch in
 * toward the gearbox, an airbox over the driver's head, and a rear wing high
 * above the diffuser — with the suspension arms out to every wheel, which
 * is most of what makes one read as open-wheel.
 */
export function f1Body(): Mesh {
  const s = new Solid();
  // nose and survival cell, narrowing to the tip
  s.hull([
    [-70, -42, 26], [120, -40, 22], [250, -40, 7], [262, -36, 5], [258, -30, 6], [150, -10, 18], [70, 2, 24],
    [18, 2, 26], [-24, 6, 26], [-60, 24, 16], [-96, 24, 14], [-210, -12, 10], [-236, -26, 8], [-236, -42, 12],
  ]);
  // sidepods, pinching in toward the back
  s.hull([[-150, -44, 22], [84, -44, 54], [84, -14, 56], [52, -2, 58], [-40, -8, 50], [-150, -24, 24]]);
  return s.mesh();
}

export function f1Detail(): Mesh {
  const s = new Solid();
  // floor
  s.slab([[-160, -58], [110, -76], [120, 76], [-160, 58]].map(([x, y]) => [x, y] as P2), -48, -44);
  // front wing: main plane, flap, endplates, pillars to the nose
  s.slab([[206, -96], [270, -96], [276, 0], [270, 96], [206, 96]], -48, -42);
  s.slab([[206, -94], [232, -94], [232, 94], [206, 94]], -40, -32);
  both((side) => s.sideways([[200, -52], [276, -52], [268, -24], [200, -26]], side > 0 ? 96 : -99, side > 0 ? 99 : -96));
  both((side) => s.rod([236, side * 5, -36], [236, side * 5, -44], 2));
  // rear wing: plane, upper flap, endplates, a pillar; the beam wing below
  s.box(-262, -224, -54, 54, 6, 14);
  s.box(-256, -238, -54, 54, 18, 26);
  both((side) => s.sideways([[-268, -26], [-214, -26], [-214, 34], [-268, 34]], side > 0 ? 54 : -57, side > 0 ? 57 : -54));
  s.rod([-212, 0, -20], [-244, 0, 8], 4);
  s.box(-250, -216, -40, 40, -38, -32);
  // the halo: a hoop over the cockpit on a central pylon
  s.rod([60, 0, 4], [54, 0, 28], 3);
  s.path([[54, 0, 28], [36, 20, 32], [2, 24, 30], [-16, 24, 8]], 3);
  s.path([[54, 0, 28], [36, -20, 32], [2, -24, 30], [-16, -24, 8]], 3);
  // the driver's helmet, and the airbox intake
  s.rod([10, 0, 0], [10, 0, 20], 12, 10);
  s.box(-24, -20, -8, 8, 12, 22);
  // suspension: wishbones out to all four wheels, and the pushrods
  both((side) => {
    for (const [ax, inner] of [[138, 20], [-138, 22]] as const) {
      s.rod([ax + 22, side * inner, -28], [ax, side * 56, -22], 2);
      s.rod([ax - 22, side * inner, -28], [ax, side * 56, -22], 2);
      s.rod([ax + 18, side * inner, -12], [ax, side * 56, -12], 2);
      s.rod([ax - 18, side * inner, -12], [ax, side * 56, -12], 2);
    }
  });
  // mirrors on stalks
  both((side) => { s.rod([46, side * 26, 0], [40, side * 40, 12], 1.5); s.box(34, 44, side * 36, side * 48, 10, 18); });
  return s.mesh();
}
