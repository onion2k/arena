/**
 * Skid marks: rubber left on the road by a sliding tyre, and left there.
 *
 * A ring of thin dark quads, one laid along each stretch a sliding wheel
 * covers in a frame, from where it was to where it is. The ring holds two
 * thousand of them and the oldest is overwritten — thirty-odd seconds of
 * sliding at the rate a drift lays them, which is more than a race's worth
 * on the road at any one time. They are an ordinary instanced group with
 * the darkest matte material in the arena: nothing here is drawn specially,
 * so they take the floods and the shadows like everything else.
 *
 * Only on the tarmac. A tyre sliding on the shoulder throws dust, not
 * rubber, and a mark on grass is a mark you can see is wrong.
 */
import type { Mesh } from 'artshape-render/mesh/types';
import { TRACK_LIFT, gripAt } from './track';

export const SKID_CAPACITY = 2048;
/** A tyre's width on the road. */
const WIDTH = 22;
/** Just above the tarmac, which is itself above the ground, so neither fights it. */
const LIFT = TRACK_LIFT + 1.5;
/** A segment longer than this is broken: the wheel jumped, or the frame did. */
const LONGEST = 160;

/** A unit quad in the ground plane, facing up: scaled to a segment by its matrix. */
export function markMesh(): Mesh {
  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, uvs, indices };
}

export class Skids {
  readonly matrices = new Float32Array(SKID_CAPACITY * 16);
  /** How many of the ring are live: all of it, once it has been round. */
  count = 0;
  /** Whether the ring changed this frame and wants uploading. */
  dirty = false;
  private cursor = 0;
  /** Where each wheel last left rubber, by a key the caller chooses. */
  private last = new Map<string, [number, number]>();

  /**
   * A sliding wheel at `x, y` on ground of height `ground`: lay a mark from
   * where it last was, if it was sliding then too and has not jumped.
   */
  mark(key: string, x: number, y: number, ground: number) {
    if (gripAt(x, y) < 1) { this.last.delete(key); return; }
    const prev = this.last.get(key);
    this.last.set(key, [x, y]);
    if (!prev) return;
    const dx = x - prev[0], dy = y - prev[1];
    const len = Math.hypot(dx, dy);
    if (len < 3 || len > LONGEST) return;
    const o = this.cursor * 16;
    const m = this.matrices;
    const c = dx / len, s = dy / len;
    // x along the segment, scaled to its length; y across, a tyre wide
    m[o] = c * len; m[o + 1] = s * len; m[o + 2] = 0; m[o + 3] = 0;
    m[o + 4] = -s * WIDTH; m[o + 5] = c * WIDTH; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1; m[o + 11] = 0;
    m[o + 12] = (x + prev[0]) / 2; m[o + 13] = (y + prev[1]) / 2; m[o + 14] = ground + LIFT; m[o + 15] = 1;
    this.cursor = (this.cursor + 1) % SKID_CAPACITY;
    this.count = Math.max(this.count, this.cursor === 0 ? SKID_CAPACITY : this.cursor);
    this.dirty = true;
  }

  /** The wheel has stopped sliding: the next mark starts a new streak. */
  lift(key: string) {
    this.last.delete(key);
  }
}
