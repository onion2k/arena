/**
 * Photo mode: the car as the jewel the Concours says it is.
 *
 * `concours.ts` dresses the car as an objet d'art and then admits what it
 * cannot do — "the renderer here has colour and roughness to work with and no
 * engraving or gem shading, so the filigree is geometry, the stones are
 * faceted meshes in glossy colour, and the gold is the gold the paint always
 * was, polished". That is true of the game path and not of the other one.
 * The same library holds a still-life renderer with measured metals, cut
 * stones that bend and split what they swallow, a table, a soft key and a
 * path tracer, and it will draw this car — one car, standing still, which is
 * exactly what it is for.
 *
 * So: the race stops, the car is set on its plinth at the origin, and the
 * still path draws it. The gold becomes gold, the onyx becomes onyx, the
 * headlamps become diamonds, and the stones a lap apiece become the ruby,
 * sapphire and emerald they were named for. The tracer follows if it is
 * asked for.
 *
 * Nothing about the race is in here. It takes a class, a lap count and a
 * device, and hands back a photograph.
 */

import type { Gpu } from 'artshape-render/gpu/context';
import { Renderer as StillRenderer, type InstanceGroup } from 'artshape-render/render/renderer';
import type { Mesh } from 'artshape-render/mesh/types';
import { placeVehicleFacing, placeVehiclePart, placeVehicleWheel } from './matrix';
import { PLINTH_TOP, gemMesh, plinthRadius, plinthRim, plinthVelvet, type Filigree } from './concours';
import type { VehicleSpec } from './vehicle';

/** How the car stands for its portrait: turned to three quarters, level, wheels straight. */
const POSE = { yaw: -0.62, steer: 0.16 };

/**
 * Which stone each of the Concours' colours was standing in for. The game
 * path had four numbers a stone and no way to say "ruby"; the still path has
 * the species, its index of refraction and its dispersion, so the setting
 * that read as a red dot becomes a stone with fire in it.
 */
const GEMS = ['ruby', 'sapphire', 'emerald', 'topaz', 'amethyst', 'aquamarine', 'garnet', 'peridot'];

export interface CarPhoto {
  spec: VehicleSpec;
  /** How many stones are set: one a lap, as on the road. */
  laps: number;
  /** Whether the car is in its Concours dress. A painted car is photographed as one. */
  concours: boolean;
  /** The paint, for a car that is not in Concours dress. */
  paint: [number, number, number];
}

/** A mesh scaled about its own origin in x and y, for the plinth's two discs. */
function widened(mesh: Mesh, r: number): Mesh {
  const positions = mesh.positions.slice();
  for (let i = 0; i < positions.length; i += 3) { positions[i] *= r; positions[i + 1] *= r; }
  return { ...mesh, positions };
}

/**
 * The car, posed at the origin, as groups the still-life path can draw.
 *
 * Every matrix here is written by the same two helpers the game path uses, so
 * a wheel sits where a wheel sits and the filigree lies on the body exactly
 * as it does at speed. What changes is the materials: names out of the
 * library's catalogue rather than a colour and a roughness.
 */
export function carGroups(photo: CarPhoto, filigreeOf: (spec: VehicleSpec) => Filigree): InstanceGroup[] {
  const { spec, concours } = photo;
  const one = () => new Float32Array(16);
  const body = one();
  placeVehiclePart(body, 0, 0, 0, 0, POSE.yaw, 0, 0);
  const detail = one();
  const [dx, dy, dz] = spec.kit.detail.at;
  const c = Math.cos(POSE.yaw), s = Math.sin(POSE.yaw);
  placeVehiclePart(detail, 0, c * dx - s * dy, s * dx + c * dy, dz, POSE.yaw, 0, 0);

  const wheels = new Float32Array(spec.wheels.length * 16);
  spec.wheels.forEach(([lx, ly, lz], i) => {
    placeVehicleWheel(wheels, i, c * lx - s * ly, s * lx + c * ly, lz, POSE.yaw, 0, 0, i < 2 ? POSE.steer : 0, 0);
  });

  const lampR = Math.max(...Array.from(spec.kit.lamp().positions).map(Math.abs)) * 0.9;
  const groups: InstanceGroup[] = concours
    ? [
      { mesh: spec.kit.body(), matrices: body, metal: 'gold', finish: 'polished' },
      { mesh: spec.kit.detail.mesh(), matrices: detail, metal: 'onyx', finish: 'polished' },
      { mesh: spec.kit.wheel(), matrices: wheels, metal: 'onyx', finish: 'satin' },
      { mesh: gemMesh(lampR), matrices: doubled(spec, POSE.yaw), metal: 'diamond', finish: 'polished', gemSize: lampR * 2 },
    ]
    : [
      // Not in Concours dress: the car is what it is on the road, and the
      // nearest the catalogue has to a painted panel is a metal. Warm paints
      // take a warm metal and cold ones a white, so a red car does not come
      // back silver — it is a photograph of the car, not of a repaint.
      { mesh: spec.kit.body(), matrices: body, metal: warmest(photo.paint), finish: 'satin' },
      { mesh: spec.kit.detail.mesh(), matrices: detail, metal: 'blackened steel', finish: 'polished' },
      { mesh: spec.kit.wheel(), matrices: wheels, metal: 'blackened steel', finish: 'sandblasted' },
      { mesh: spec.kit.lamp(), matrices: doubled(spec, POSE.yaw), metal: 'moonstone', finish: 'polished' },
    ];

  if (concours) {
    const orn = one();
    placeVehiclePart(orn, 0, 0, 0, 0, POSE.yaw, 0, 0);
    groups.push({ mesh: filigreeOf(spec).mesh, matrices: orn, metal: 'platinum', finish: 'polished' });

    // a stone for every lap finished, each in the curl it was set into
    const sites = filigreeOf(spec).sites.slice(0, Math.max(0, photo.laps));
    sites.forEach((site, i) => {
      const m = new Float32Array(16);
      const [ax, ay, az] = site.at;
      const size = site.size;
      // the table faces out of the flank, as it does on the road
      const fx = c, fy = s;
      const zx = -s * site.side, zy = c * site.side;
      m.set([
        fx * size, fy * size, 0, 0,
        -zx * size, -zy * size, 0, 0,
        0, 0, size, 0,
        c * ax - s * ay, s * ax + c * ay, az, 1,
      ]);
      groups.push({
        mesh: gemMesh(1), matrices: m,
        metal: GEMS[i % GEMS.length], finish: 'polished',
        gemSize: size * 2, pavilionFacets: 8,
      });
    });

    const r = plinthRadius(spec);
    const plinth = one();
    // the velvet's top under the tyres, so the car stands on the plinth
    // rather than in it: the lowest wheel's contact, less the disc's height
    const lowest = Math.min(...spec.wheels.map(([, , lz]) => lz)) - spec.wheelRadius;
    placeVehiclePart(plinth, 0, 0, 0, lowest - PLINTH_TOP, 0, 0, 0);
    groups.push(
      { mesh: widened(plinthRim(), r), matrices: plinth, metal: 'gold', finish: 'satin' },
      { mesh: widened(plinthVelvet(), r), matrices: plinth, metal: 'black plastic', finish: 'flock' },
    );
  }
  return groups;
}

/**
 * The headlamps, a pair, where the kit says its lights go — and facing, not
 * wheeled: a lamp looks along the nose where a wheel turns about an axle
 * across it, which is the same distinction the road makes.
 */
function doubled(spec: VehicleSpec, yaw: number): Float32Array {
  const out = new Float32Array(2 * 16);
  const [hx, hy, hz] = spec.kit.lights.head;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  [-hy, hy].forEach((ly, i) => {
    placeVehicleFacing(out, i, c * hx - s * ly, s * hx + c * ly, hz, yaw, 0, 0);
  });
  return out;
}

/** A metal for a paint: warm paints take a warm metal, cold ones a white. */
function warmest(paint: [number, number, number]): string {
  const [r, g, b] = paint;
  if (r > b * 1.25) return r > g * 1.4 ? 'copper' : 'gold';
  if (b > r * 1.25) return 'platinum';
  return 'silver';
}

export type Stage = 'off' | 'building' | 'raster' | 'tracing';

/**
 * The still-life renderer, over the game's own device and canvas. It is built
 * the first time a photograph is asked for: a race that is never paused for
 * one pays nothing, and the tracer is fetched later still.
 */
export class Photo {
  private renderer: StillRenderer | null = null;
  private built: Promise<StillRenderer> | null = null;
  stage: Stage = 'off';
  timings = { build: 0, settle: 0 };
  private openedAt = 0;
  private waited = false;

  constructor(private ctx: Gpu, private canvas: HTMLCanvasElement) {}

  private build(): Promise<StillRenderer> {
    if (this.built) return this.built;
    this.stage = 'building';
    const started = performance.now();
    this.built = (async () => {
      const renderer = new StillRenderer(this.ctx, {});
      await renderer.ready;
      renderer.setSize(this.canvas.width, this.canvas.height);
      // a jeweller's window rather than a night race: a dark room, a soft key
      // over the near shoulder, and a slate slab for the plinth to stand on
      renderer.setEnvironment('studio');
      // A car is slab-sided where a brooch is curved, and a flat panel shows
      // whatever it is pointed at and nothing else. Under a dim sky polished
      // gold came out the colour of sand: it was not wrong, it was a mirror
      // with nothing to reflect. The sky carries this picture, the key puts
      // an edge on it, and the rim draws the gold line along the flank that
      // says the panel is metal.
      renderer.setEnvStrength(0.9);
      renderer.setTable('slate');
      renderer.setKeyLight({ elevation: 0.5, azimuth: -0.8, strength: 1.5, warmth: 0.18, size: 0.09 });
      renderer.setRig([
        { elevation: 0.22, azimuth: 2.1, strength: 0.45, warmth: -0.25, size: 0.4 },
        { elevation: 0.5, azimuth: 2.75, strength: 1.1, warmth: 0.12, size: 0.05 },
      ]);
      renderer.setExposure(1.1);
      renderer.setFilm({ tonemap: 1, vignette: 0.32, grain: 0.16, fringe: 0.28 });
      renderer.setLens(85);
      this.renderer = renderer;
      this.timings.build = performance.now() - started;
      return renderer;
    })();
    return this.built;
  }

  /** Take over: build if this is the first time, and stand the car on its plinth. */
  async open(groups: InstanceGroup[], bounds: { min: [number, number, number]; max: [number, number, number] }) {
    const renderer = await this.build();
    renderer.setInstanced(groups);
    renderer.frameBounds(bounds);
    renderer.setQuality('final');
    renderer.requestRender();
    this.stage = 'raster';
    this.openedAt = performance.now();
    this.timings.settle = 0;
    this.waited = false;
  }

  close() {
    this.stage = 'off';
    this.renderer?.setQuality('draft');
  }

  /** Turn the car under the lights: the photograph's own orbit, in radians. */
  turn(azimuth: number, elevation: number) {
    const r = this.renderer;
    if (!r) return;
    const d = Math.hypot(r.camera.position[0] - r.camera.target[0], r.camera.position[1] - r.camera.target[1], r.camera.position[2] - r.camera.target[2]);
    const ce = Math.cos(elevation);
    r.camera.position = [
      r.camera.target[0] + Math.cos(azimuth) * ce * d,
      r.camera.target[1] + Math.sin(azimuth) * ce * d,
      r.camera.target[2] + Math.sin(elevation) * d,
    ];
    r.requestRender();
  }

  trace() {
    if (!this.renderer || this.stage === 'off') return;
    this.renderer.setQuality('traced');
    this.renderer.requestRender();
    this.stage = 'tracing';
  }

  resize(width: number, height: number) { this.renderer?.setSize(width, height); }

  render(view: () => GPUTextureView, moving: boolean): boolean {
    const r = this.renderer;
    if (!r || this.stage === 'off' || this.stage === 'building') return false;
    r.setMoving(moving);
    const drew = r.render(view);
    if (r.pending) this.waited = true;
    else if (this.waited && !this.timings.settle && this.openedAt) this.timings.settle = performance.now() - this.openedAt;
    return drew;
  }

  get status(): string {
    const r = this.renderer;
    if (this.stage === 'building') return 'photo: setting the car down…';
    if (!r) return '';
    if (this.stage === 'tracing') {
      return r.traceSamples ? `traced, ${r.traceSamples}/${r.traceLimit} samples` : 'fetching the tracer…';
    }
    return r.pending ? 'settling…' : 'still · T to trace';
  }
}
