/**
 * A uniform grid over the arena, holding circles in buckets, so a collision
 * check against thousands of trees does not scan thousands of trees.
 *
 * The linear scan it replaces ("a few microseconds and not worth a grid")
 * stopped being true once the forest could grow past about three thousand:
 * at the largest arena size the wood alone is a few thousand trees, on top
 * of every lamp post and bollard, checked every physics substep for two
 * bodies. A grid turns that into a lookup near the one point that matters.
 */
export interface Circle {
  x: number;
  y: number;
  r: number;
}

export class CircleGrid {
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly halfX: number;
  private readonly halfY: number;
  private readonly buckets: Circle[][];

  constructor(halfX: number, halfY: number, cell = 320) {
    this.cell = cell;
    this.halfX = halfX;
    this.halfY = halfY;
    this.cols = Math.max(1, Math.ceil((halfX * 2) / cell) + 1);
    this.rows = Math.max(1, Math.ceil((halfY * 2) / cell) + 1);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x + this.halfX) / this.cell)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y + this.halfY) / this.cell)));
  }

  add(x: number, y: number, r: number) {
    this.buckets[this.row(y) * this.cols + this.col(x)].push({ x, y, r });
  }

  /** How many circles are in the grid, for a sanity check after building it. */
  get count(): number {
    let n = 0;
    for (const b of this.buckets) n += b.length;
    return n;
  }

  /**
   * Every circle in the cells within `reach` of a point. `reach` should cover
   * the largest circle radius the grid holds plus whatever the caller is
   * testing against — a cell narrower than that would miss a circle whose
   * centre sits just outside it but whose edge does not.
   */
  forEachNear(x: number, y: number, reach: number, fn: (c: Circle) => void) {
    const cx = this.col(x), cy = this.row(y);
    const span = Math.ceil(reach / this.cell) + 1;
    for (let j = -span; j <= span; j++) {
      const gy = cy + j;
      if (gy < 0 || gy >= this.rows) continue;
      const base = gy * this.cols;
      for (let i = -span; i <= span; i++) {
        const gx = cx + i;
        if (gx < 0 || gx >= this.cols) continue;
        for (const c of this.buckets[base + gx]) fn(c);
      }
    }
  }
}
