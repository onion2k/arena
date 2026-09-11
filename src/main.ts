/**
 * An arena, on the game path of artshape-render.
 *
 * The demo exists to push the two things that path was built for: a lot of
 * moving point lights, and materials shiny enough to show them. Every frame
 * it throws away the light list and writes a new one — a shot, an enemy, an
 * explosion and a muzzle flash all carry their own — and redraws the whole
 * scene rather than keeping the static half, because a moving light relights
 * the arena and the two are alternatives.
 */
import { createContext } from 'artshape-render/gpu/context';
import { Orbit } from 'artshape-render/gpu/camera';
import { bakeEnvironment } from 'artshape-render/render/env';
import { GameRenderer, EFFECT_STRIDE, type GameGroup } from 'artshape-render/game/renderer';
import { LightPool } from 'artshape-render/game/lights';
import { COUNTDOWN, PAINT, Race, TRUCKS, type Input } from './game';
import { STONES, filigree, gemMesh, plinthRadius, plinthRim, plinthVelvet, presentation, type Filigree } from './concours';
import type { Pose } from './ghost';
import type { VehicleSpec } from './vehicle';
import { CONTROLS, SETTINGS, restoreDefaults, save, type SliderKey } from './settings';
import { PROPS, floraBuffers } from './flora';
import { BIOME, BIOMES, BIOME_KEYS, labelOfBiome, type BiomeKey } from './biomes';
import { BOLLARDS, RAILS, SIGNS, barMesh, boardPanelMesh, chevronMarkMesh, chevronPanelMesh, drumMesh, furnitureBuffers, railMesh, railPostMesh, signPostMesh, tyreMesh } from './furniture';
import { clockLabel, skyAt } from './daylight';
import { WATER_LEVEL, underWater, waterMesh } from './water';
import { wheelEffects } from './particles';
import { Skids, markMesh } from './skids';
import { VEHICLES, VEHICLE_KEYS, type VehicleKey } from './vehicles';
import { bench } from './bench';
import { START_BULBS, TRACK_HALF, centreline, circuitFor, difficultyBand, drawnLift, gantry, generateTrack, measureShape, radialToAcross, rateTrack, scaleShape, shapePreview, tangentAt, where } from './track';
import { height as groundAt } from './terrain';
import { ARENA_X, ARENA_Y, COLUMNS, MESHES, arenaMatrices } from './scene';
import { placeOnSlope, placeVehicleFacing, placeVehiclePart, placeVehicleWheel, project } from './matrix';
import { EFFECT_CAPACITY, LIGHT_CAPACITY, effectsFor, lightsFor, setProjectionScale, shadowedLamps } from './lighting';
import { useTrack as buildCircuit } from './circuit';
import { SIZE, SIZES, labelOf, sizeOf, type SizeKey } from './world';

const FOV = 40;
/** Where the dynamic groups sit, in the order they are handed over. */
const CHASSIS = 0, CAB = 1, WHEELS_GROUP = 2, LAMPS = 3, START_LAMPS = 4, SKIDS = 5;
/** The Concours groups: filigree, stones, and the plinth's rim and velvet. */
const ORNAMENT = 6, GEMS = 7, PLINTH = 8, VELVET = 9;
/** The Concours d'Élégance's gold. */
const CONCOURS_GOLD: [number, number, number] = [1.0, 0.70, 0.22];
/** The most stones a car can wear. */
const GEM_CAPACITY = 32;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const boot = document.getElementById('boot')!;
const pregame = document.getElementById('pregame')!;
const pregameMap = document.getElementById('pregameMap')!;
const pregameBiome = document.getElementById('pregameBiome')!;
const pregameVehicle = document.getElementById('pregameVehicle')!;
const pregameSize = document.getElementById('pregameSize')!;
const pregameModes = document.getElementById('pregameModes')!;
const pregameFacts = document.getElementById('pregameFacts')!;
const pregameWarn = document.getElementById('pregameWarn')!;
const pregameRating = document.getElementById('pregameRating')!;
const pregameSeed = document.getElementById('pregameSeed') as HTMLInputElement;
const pregameAnother = document.getElementById('pregameAnother')!;
const pregameGo = document.getElementById('pregameGo')!;
const bootMsg = document.getElementById('bootMsg')!;
const scorePanel = document.getElementById('score')!;
const statsPanel = document.getElementById('stats')!;
const helpPanel = document.getElementById('help')!;
const mapPanel = document.getElementById('map')!;
const mapSvg = document.getElementById('mapSvg') as unknown as SVGSVGElement;
const configPanel = document.getElementById('config')!;



main().catch((err) => { bootMsg.textContent = String(err?.message ?? err); console.error(err); });

async function main() {
  const ctx = await createContext(canvas);
  bootMsg.textContent = 'compiling shaders…';

  // Thirty-two thousand particles: eight trucks with all four wheels in a
  // ford throw about five hundred a frame, and a burst lives a second.
  const renderer = new GameRenderer(ctx, LIGHT_CAPACITY, EFFECT_CAPACITY, 32768);
  renderer.gravity = 9810;
  renderer.look = {
    ...renderer.look,
    // Where the sun is, what colour, the ambient and the sky are all set from
    // the clock below, every time it changes: see `daylight`. These are the
    // night's values, so that nothing is lit wrongly before the first apply.
    sunDir: [0.34, 0.52, 0.78],
    // Nearly off. The sun is a directional light that reaches every surface
    // in the arena and `ambient` does not touch it, so at any real strength
    // it lays a sheet of highlight across the floor and there is no dark for
    // a beam to cut. What is left is enough to keep the posts from being
    // flat black cutouts.
    sunColour: [0.040, 0.052, 0.092],
    exposure: 1.05,
    // Half brightness at 900mm rather than the library's 50. The arena is
    // 4800 across; at fifty a light was a coin of brightness under whatever
    // carried it and the floor a metre away never knew it existed. At nine
    // hundred a passing shot lights a bay of the hall.
    falloffHalf: 900,
    // The lamps' shadows soften with distance. Every lamp post stands as
    // tall as the lamps beside it, so each neighbour threw its shadow across
    // the road as a hard wedge with no end; a pole 2500 away now lands as a
    // smear a hand wide. A truck under its own lamp keeps a crisp shadow.
    spotSoftness: 1 / 500,
    // A dark hall. The environment lights everything everywhere before a
    // single point light exists, so leaving it at one meant the floor was
    // already lit and a shot going past had nothing to add.
    // Very nearly nothing. The hall is meant to be dark enough that a drone
    // outside a beam is invisible, and the environment lights everything
    // everywhere: at 0.3 it was quietly showing the player the whole room.
    ambient: 0.035,
    // the environment lights the metal but is never drawn, so this is the
    // whole sky: near black, to leave the point lights all the contrast
    background: [0.006, 0.011, 0.026],
  };

  /** How long the last rebuild took, and what it produced — read from the
   *  console rather than asserted, since nothing here ever measured it. */
  const timings: Record<string, number> = { track: 0, arena: 0 };

  /** A circuit in force, built on the CPU — see `circuit.ts` — and a warning
   *  if it would ever be more lamps than the light pool holds. */
  function useTrack(seed: number, size: SizeKey, biome: BiomeKey) {
    timings.track = buildCircuit(seed, size, biome);
    // Every post carries a floodlight, and the ghost-corner and start-line
    // glows are on top of that: both pools have room to spare at any size
    // this game reaches, but silently dropping lights past a fixed capacity
    // is exactly the kind of thing that would go unnoticed until someone
    // tried an arena big enough to hit it.
    if (COLUMNS.length + 12 > LIGHT_CAPACITY) {
      console.warn(`arena: ${COLUMNS.length} posts is close to the ${LIGHT_CAPACITY} light capacity`);
    }
  }
  useTrack(SETTINGS.seed, SETTINGS.size, SETTINGS.biome);

  bootMsg.textContent = 'generating the arena…';
  // One frame's grace, so the message is painted before the geometry blocks
  // the thread. Raced against a timer because a tab that is not being
  // composited never calls back, and a loading screen that waits forever for
  // one is worse than no loading screen at all.
  await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 50); });

  // The parts that are the same on every circuit: a lamp post, a gantry, the
  // small disc the starting bulbs are drawn from. Built once. Everything the
  // circuit decides — the ground it is cut into, the tarmac, the kerbs, the
  // water, where the posts stand and where the trees do — is built in
  // `buildArena` and built again whenever the circuit changes. The vehicle's
  // own meshes are not here: they come from its `VehicleKit` (`vehicles.ts`)
  // and are rebuilt whenever the vehicle is, a few lines below.
  const mesh = {
    pole: MESHES.pole(), arm: MESHES.arm(), head: MESHES.head(),
    lamp: MESHES.lamp(), gantry: MESHES.gantry(),
  };

  function buildArena() {
  const tArena0 = performance.now();
  const at = arenaMatrices();
  const flora = floraBuffers(PROPS, BIOME);
  const kit = furnitureBuffers();

  renderer.setStatic([
    // The ground. It was glossier than the tarmac at 0.14, which meant every
    // ridge on it answered the trackside floods with a specular streak and
    // the arena read as corrugated iron — the bumps you could see were mostly
    // highlights rather than shape. Rough and cold now: it takes the light
    // and does not throw it back, so what you see of the ground is its form.
    { mesh: MESHES.floor(), matrices: identity(), albedo: BIOME.ground.albedo, roughness: BIOME.ground.roughness },
    // Tarmac. Roughness is what darkens it, not the colour: albedo here is
    // the Fresnel base, and at the grazing angles a camera following a car
    // looks along a road at, Fresnel goes to one whatever that base is. So
    // dropping the colour from 0.135 to 0.062 changed almost nothing, and
    // taking the roughness from 0.34 to 0.85 — asphalt rather than wet
    // asphalt — is what stopped the road out-shining the cars on it.
    { mesh: MESHES.tile(), matrices: at.tiles, albedo: BIOME.tarmac.albedo, roughness: BIOME.tarmac.roughness },
    // The water: one quad over the whole ground at the level, opaque, near
    // black and nearly a mirror in the forest and the snow; drawn with no
    // count at all in a biome with none. What makes it read as water is what
    // it reflects — the sky by day, and by night every lamp and headlight on
    // the shore as a hard glint — and the shadows the flora lay across it.
    {
      mesh: waterMesh(ARENA_X + 400, ARENA_Y + 400), matrices: identity(),
      count: BIOME.water.depth === null ? 0 : 1,
      albedo: BIOME.water.albedo, roughness: BIOME.water.roughness,
    },
    // The kerbs: matte enough to read as paint at any angle, and the only
    // saturated colour in most biomes — they are on the one thing the driver
    // has to see.
    { mesh: MESHES.kerbA(), matrices: at.tiles, albedo: BIOME.kerb[0], roughness: 0.55 },
    { mesh: MESHES.kerbB(), matrices: at.tiles, albedo: BIOME.kerb[1], roughness: 0.55 },
    // The lamp posts. Pole and arm are a dark painted metal that the beam
    // never falls on — a street light stands outside its own pool — and the
    // head is near white and glossy, so what you see of a post at a distance
    // is the lamp and not the mast.
    { mesh: mesh.pole, matrices: at.poles, albedo: [0.30, 0.30, 0.33], roughness: 0.42 },
    { mesh: mesh.arm, matrices: at.arms, albedo: [0.30, 0.30, 0.33], roughness: 0.42 },
    { mesh: mesh.head, matrices: at.heads, albedo: [0.93, 0.92, 0.86], roughness: 0.14 },
    { mesh: mesh.gantry, matrices: gantryPosts(), count: 2, albedo: [0.62, 0.64, 0.70], roughness: 0.25 },
    // The flora: one group a kind, each drawn as many times as there are of
    // it. Matte, because a glossy tree under a flood is a plastic one, and
    // dark enough that only the moonlight and the spill from the road pick
    // it out — which is what makes the dark beyond the kerbs a place rather
    // than an absence.
    ...flora,
    // The barriers. Galvanised steel that has been out in the weather: light
    // enough to catch a flood from across the circuit, which is what draws
    // the edge of the road at night, and rough enough not to be a mirror.
    { mesh: railMesh(), matrices: kit.rails, count: kit.railCount, albedo: [0.52, 0.54, 0.58], roughness: 0.46 },
    { mesh: railPostMesh(), matrices: kit.posts, count: kit.postCount, albedo: [0.26, 0.27, 0.30], roughness: 0.55 },
    // Oil drums, a yard's worth rather than a matching set: rust, faded red,
    // faded blue, each drum taking its own from the tint buffer.
    { mesh: drumMesh(), matrices: kit.drums, count: kit.drumCount, materials: kit.drumTint, albedo: [0.42, 0.17, 0.10], roughness: 0.62 },
    // Tyre stacks, which are the one thing out here that is meant to be hit.
    { mesh: tyreMesh(), matrices: kit.tyres, count: kit.tyreCount, albedo: [0.045, 0.045, 0.05], roughness: 0.86 },
    // The signs, in five groups because a group is one material.
    //
    // The posts are the barrier post's own dark metal, so a sign reads as
    // the same street furniture the barriers are. The bars and the chevron
    // boards are an off-white a shade under the kerbs, which the arena keeps
    // as its only saturated colour — and matte, because a sign facing a
    // floodlight head on at the kerb's own 0.80 is a sign that blooms.
    { mesh: signPostMesh(), matrices: kit.signPosts, count: kit.signPostCount, albedo: [0.26, 0.27, 0.30], roughness: 0.55 },
    { mesh: boardPanelMesh(), matrices: kit.boardPanels, count: kit.boardPanelCount, albedo: [0.16, 0.165, 0.18], roughness: 0.66 },
    { mesh: barMesh(), matrices: kit.bars, count: kit.barCount, albedo: [0.74, 0.73, 0.70], roughness: 0.62 },
    { mesh: chevronPanelMesh(), matrices: kit.panels, count: kit.panelCount, albedo: [0.16, 0.165, 0.18], roughness: 0.66 },
    { mesh: chevronMarkMesh(), matrices: kit.marks, count: kit.markCount, albedo: [0.78, 0.77, 0.74], roughness: 0.60 },
  ]);
  timings.arena = performance.now() - tArena0;
  }
  buildArena();

  // The pools. Their size is fixed here and never changes again: what moves
  // each frame is the live count, and the matrices written into the prefix.
  // Every vehicle class has exactly four wheels and two lamps — a kit is
  // always this shape, see `VehicleKit` — so these do not move when the
  // class does either; only the meshes drawn from them do.
  const chassisM = new Float32Array(TRUCKS * 16);
  const chassisMat = new Float32Array(TRUCKS * 4);
  const cabM = new Float32Array(TRUCKS * 16);
  const wheelM = new Float32Array(TRUCKS * 4 * 16);
  const lampM = new Float32Array(TRUCKS * 2 * 16);
  const ornamentM = new Float32Array(TRUCKS * 16);
  const gemM = new Float32Array(GEM_CAPACITY * 16);
  const gemMat = new Float32Array(GEM_CAPACITY * 4);
  for (let i = 0; i < GEM_CAPACITY; i++) gemMat.set(STONES[i % STONES.length], i * 4);
  const plinthM = new Float32Array(16);
  /** Each class's filigree and stone settings, built the first time it is shown. */
  const filigrees = new Map<string, Filigree>();
  const filigreeOf = (spec: VehicleSpec) => {
    let f = filigrees.get(spec.key);
    if (!f) { f = filigree(spec); filigrees.set(spec.key, f); }
    return f;
  };
  /** What is on the road this frame: the truck, and the ghost when there is one. */
  const drawn: Pose[] = [];
  const startMat = new Float32Array(2 * START_BULBS * 4);
  const skids = new Skids();
  const startBulbsM = startBulbs();

  /** The two vehicle-shaped dynamic groups, drawn from whichever kit is in
   *  force. Rebuilding them is a mesh swap on the same pools above — nothing
   *  about how many buffers exist or how big they are changes with class. */
  function vehicleGroups(spec: VehicleSpec): GameGroup[] {
    // Concours d'Élégance: gold polished to a mirror (see the paint in
    // `upload`), onyx for everything that was glass, carbon or rubber, and
    // diamonds for headlamps. See `concours.ts`.
    if (SETTINGS.concours) {
      const lampR = Math.max(...Array.from(spec.kit.lamp().positions).map(Math.abs)) * 0.9;
      return [
        { mesh: spec.kit.body(), matrices: chassisM, count: TRUCKS, albedo: [1.0, 0.79, 0.36], roughness: 0.05 },
        { mesh: spec.kit.detail.mesh(), matrices: cabM, count: TRUCKS, albedo: [0.015, 0.015, 0.02], roughness: 0.04 },
        { mesh: spec.kit.wheel(), matrices: wheelM, count: TRUCKS * 4, albedo: [0.02, 0.02, 0.025], roughness: 0.12 },
        { mesh: gemMesh(lampR), matrices: lampM, count: TRUCKS * 2, albedo: [1, 1, 1], roughness: 0 },
      ];
    }
    return [
      // not a mirror: a polished metal under a near-black sky has nothing to
      // reflect and reads as a dark shape. A little roughness gives the
      // point lights a highlight wide enough to see the colour in. The
      // albedo here is overwritten every frame by `PAINT`; see `upload`.
      { mesh: spec.kit.body(), matrices: chassisM, count: TRUCKS, albedo: [1.0, 0.79, 0.36], roughness: 0.24 },
      { mesh: spec.kit.detail.mesh(), matrices: cabM, count: TRUCKS, albedo: spec.kit.detail.albedo, roughness: spec.kit.detail.roughness },
      // tyres: dark and rough, the one thing out here that is not a mirror
      { mesh: spec.kit.wheel(), matrices: wheelM, count: TRUCKS * 4, albedo: [0.07, 0.07, 0.08], roughness: 0.62 },
      // near white and glossy, so the lamps read as lit glass rather than as
      // two more lumps of the same metal the vehicle is made of
      { mesh: spec.kit.lamp(), matrices: lampM, count: TRUCKS * 2, albedo: [1.0, 0.97, 0.9], roughness: 0.06 },
    ];
  }
  // the starting bulbs, which never move and are recoloured every frame
  const startBulbGroup: GameGroup = { mesh: mesh.lamp, matrices: startBulbsM, count: 2 * START_BULBS, albedo: [0.2, 0.04, 0.03], roughness: 0.12 };
  // the skid marks: a ring of dark quads on the road, laid by sliding tyres
  const skidGroup: GameGroup = { mesh: markMesh(), matrices: skids.matrices, count: 0, albedo: [0.028, 0.028, 0.032], roughness: 0.92 };
  /** The Concours groups for a class: its filigree, the stones, and a plinth
   *  made to its size. Drawn with nothing in them when the mode is off. */
  function jewelGroups(spec: VehicleSpec): GameGroup[] {
    const r = plinthRadius(spec);
    const scaled = (m: ReturnType<typeof plinthRim>) => {
      const positions = m.positions.slice();
      for (let i = 0; i < positions.length; i += 3) { positions[i] *= r; positions[i + 1] *= r; }
      return { ...m, positions };
    };
    return [
      { mesh: filigreeOf(spec).mesh, matrices: ornamentM, count: 0, albedo: [0.93, 0.93, 0.95], roughness: 0.05 },
      { mesh: gemMesh(1), matrices: gemM, count: 0, materials: gemMat },
      { mesh: scaled(plinthRim()), matrices: plinthM, count: 0, albedo: [1.0, 0.77, 0.32], roughness: 0.12 },
      { mesh: scaled(plinthVelvet()), matrices: plinthM, count: 0, albedo: [0.30, 0.02, 0.07], roughness: 0.95 },
    ];
  }
  const dynamicGroups = (spec: VehicleSpec) => [...vehicleGroups(spec), startBulbGroup, skidGroup, ...jewelGroups(spec)];
  renderer.setDynamic(dynamicGroups(VEHICLES[SETTINGS.vehicle]));

  /**
   * A different vehicle. `setDynamic` releases the old buffers and uploads
   * the new meshes into the same pools — the class changes what is drawn,
   * not how many buffers exist to draw it into, since every kit is the same
   * shape. The truck itself is `arena`'s to replace: see `Race.useVehicle`.
   */
  function switchVehicle(spec: VehicleSpec) {
    arena.useVehicle(spec);
    renderer.setDynamic(dynamicGroups(spec));
  }

  const arena = new Race();
  // `Race` defaults to the technical; put the vehicle that was actually
  // saved in force before anything is drawn or driven.
  if (SETTINGS.vehicle !== 'technical') arena.useVehicle(VEHICLES[SETTINGS.vehicle]);
  /**
   * The sun's shadow map, fitted round the whole arena at medium size and
   * smaller: 2048 texels across 14 metres is seven millimetres each, which
   * is a shadow with an edge you can see. A bigger arena would spend those
   * same texels thinner — fourteen millimetres at the largest size — so past
   * medium the box instead follows the camera: a window this wide is still
   * only a third of an extra-large arena, and it keeps every texel the same
   * size regardless of how far the far side of the circuit is. The window's
   * edge can show at full zoom-out on the largest arenas; growing the box
   * instead is the one-line alternative if that reads worse than the blur.
   */
  const SUN_WINDOW = 6600;
  function updateSunShadow(targetX: number, targetY: number) {
    if (SIZE <= 1) {
      renderer.setSunShadow({
        min: [-ARENA_X - 400, -ARENA_Y - 400, -140],
        max: [ARENA_X + 400, ARENA_Y + 400, 780],
      });
    } else {
      renderer.setSunShadow({
        min: [targetX - SUN_WINDOW, targetY - SUN_WINDOW, -140],
        max: [targetX + SUN_WINDOW, targetY + SUN_WINDOW, 780],
      });
    }
  }
  updateSunShadow(0, 0);

  bootMsg.textContent = 'baking the environment…';
  // Two of them, night and day, baked once and swapped as the sun comes up.
  // The environment is what lights the ground by day — the renderer's sun is
  // a highlight only — so the daylight one is baked with its sun where noon
  // puts it, and the swap happens while the sky is still dim enough that a
  // cut is not a cut.
  const nightEnv = bakeEnvironment(ctx, 'dusk', { size: 128, mips: 6 });
  const noon = skyAt(12, 0).sunDir;
  const dayEnv = bakeEnvironment(ctx, 'daylight', { size: 128, mips: 6, sun: noon });
  let envIsDay = false;
  renderer.setEnvironment(nightEnv.specular, nightEnv.brdf, nightEnv.mips);
  let sky = skyAt(SETTINGS.time, SETTINGS.ambient);
  const applySky = () => {
    sky = skyAt(arena.hours, SETTINGS.ambient, BIOME.sky.tint, BIOME.sky.ambientScale);
    renderer.look.sunDir = sky.sunDir;
    renderer.look.sunColour = sky.sunColour;
    renderer.look.ambient = sky.ambient;
    renderer.look.background = sky.background;
    // Swapped early, while the sky is still nearly black: the two bakes do
    // not match and a cut between them is visible at any ambient above a
    // tenth. At this height of the sun the ambient is 0.09.
    // The mist. It lies on the water — the lakes and the fords are the
    // lowest ground there is — and it is 300 deep, which is under the trees
    // and about the height of a truck's cab: a driver is in it, the lamp
    // heads are out in the clear, and the forest is tall enough to stand in
    // its light. That last one is the whole reason for the number. At 520
    // the layer stood above a 300mm tree and two thirds of it was in
    // permanent sun; the forest held 9% of the light out of the mist. At 300
    // it holds 22%, which is the difference between a haze and a wood with
    // the sun coming through it. What lights it is the sun — level with it
    // and orange at dawn — through the shadow map the arena already draws.
    // Everything scales with the hour: nothing is marched at all away from
    // dawn.
    const mist = sky.mist * SETTINGS.mist;
    // In a biome with water the mist sits on it, as it always did. A desert
    // has none — `WATER_LEVEL` sits far below the ground there on purpose —
    // so the mist instead lies near the ground itself, which is where a
    // dawn haze actually forms over dry sand too.
    renderer.fog = {
      density: 2.6e-4 * mist,
      base: BIOME.water.depth === null ? 0 : WATER_LEVEL,
      height: 300,
      colour: [0.86, 0.89, 0.95],
      // the sky's own light on the mist, which is what keeps the shadowed
      // half of it a cold blue rather than black
      ambient: 0.16 + 0.5 * sky.ambient,
      anisotropy: 0.62,
      // A bigger arena needs the march to carry further, or the far side of
      // the circuit sits beyond it and the mist simply stops there.
      reach: 9000 * Math.max(1, SIZE),
      // Steps with the thickness, because what they are for is hiding the
      // steps. A thin haze scatters little per step, so the noise a short
      // march leaves is small too, and eighteen of them at night is
      // indistinguishable from twenty-eight; the dawn mist is three times
      // as dense and wants all of them. Fixed at twenty-eight this was 2.85
      // ms of a 5.3 ms night frame.
      steps: Math.round(14 + 16 * Math.min(1, mist)),
      cones: 1,
    };

    const wantDay = sky.day > 0.08;
    if (wantDay !== envIsDay) {
      envIsDay = wantDay;
      const e = wantDay ? dayEnv : nightEnv;
      renderer.setEnvironment(e.specular, e.brdf, e.mips);
    }
  };

  renderer.camera.fov = FOV;
  setProjectionScale(FOV);

  /**
   * A different circuit. Everything the old one decided is thrown away and
   * built again, which takes long enough to see and not long enough to want
   * a progress bar.
   *
   * The ghost goes with it. A best lap belongs to the circuit it was driven
   * on, and replaying one over a different road would put a truck through
   * the trees — which is not a bug you would report, it is a bug you would
   * simply stop trusting the ghost over.
   */
  function newTrack(seed: number, size: SizeKey, biome: BiomeKey) {
    SETTINGS.seed = seed;
    SETTINGS.size = size;
    SETTINGS.biome = biome;
    save();
    useTrack(seed, size, biome);
    buildArena();
    minimap.redraw();
    skids.clear();
    arena.ghost.clear();
    arena.reset();
    applySky();
  }

  /*
   * The track-select screen.
   *
   * Browsing circuits is cheap and committing to one is not: drawing a
   * candidate is a path and two numbers, and building it is 35ms of meshes,
   * posts and forest. So the screen flips through candidates without
   * building any of them — `shapePreview` swaps a shape in, reads what it
   * needs and puts the old one back — and the arena is only rebuilt when the
   * race button is pressed, and only if the circuit actually changed.
   */
  const NS = 'http://www.w3.org/2000/svg';
  let choice = { seed: SETTINGS.seed, size: SETTINGS.size, vehicle: SETTINGS.vehicle, biome: SETTINGS.biome };
  /** What the arena is currently built for, so racing the same one is free. */
  let built = { ...choice };
  let racing = false;

  const road = document.createElementNS(NS, 'path');
  road.setAttribute('fill', 'none');
  road.setAttribute('stroke', BIOME.map.road);
  road.setAttribute('stroke-width', String(TRACK_HALF * 2));
  road.setAttribute('stroke-linejoin', 'round');
  const paint = document.createElementNS(NS, 'path');
  paint.setAttribute('fill', 'none');
  paint.setAttribute('stroke', '#e8b74a');
  paint.setAttribute('stroke-width', '90');
  paint.setAttribute('stroke-linejoin', 'round');
  paint.setAttribute('stroke-dasharray', '360 300');
  const startLine = document.createElementNS(NS, 'line');
  startLine.setAttribute('stroke', '#e6e4f0');
  startLine.setAttribute('stroke-width', '150');
  pregameMap.append(road, paint, startLine);

  // The size picker: one button per entry in `SIZES`, built from the table
  // rather than written out — adding a size is a line there and none here.
  const sizeButtons = new Map<SizeKey, HTMLButtonElement>();
  for (const s of SIZES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = s.label;
    btn.addEventListener('click', () => {
      preview(choice.seed, choice.vehicle, s.key, choice.biome);
      btn.blur();
    });
    pregameSize.appendChild(btn);
    sizeButtons.set(s.key, btn);
  }
  // The two modes: switches, kept across sessions, and nothing to do with
  // which circuit is built — so they apply at once rather than on race.
  const modeButtons: [HTMLButtonElement, 'disco' | 'concours'][] = [];
  for (const [key, label] of [['disco', 'disco night'], ['concours', "concours d'élégance"]] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(SETTINGS[key]));
    btn.addEventListener('click', () => {
      SETTINGS[key] = !SETTINGS[key];
      btn.setAttribute('aria-pressed', String(SETTINGS[key]));
      save();
      if (key === 'concours') renderer.setDynamic(dynamicGroups(arena.truck.spec));
      btn.blur();
    });
    pregameModes.appendChild(btn);
    modeButtons.push([btn, key]);
  }
  // The vehicle picker, the same way.
  const vehicleButtons = new Map<VehicleKey, HTMLButtonElement>();
  for (const key of VEHICLE_KEYS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = VEHICLES[key].label;
    btn.addEventListener('click', () => {
      preview(choice.seed, key, choice.size, choice.biome);
      btn.blur();
    });
    pregameVehicle.appendChild(btn);
    vehicleButtons.set(key, btn);
  }
  // The biome picker, the same way again.
  const biomeButtons = new Map<BiomeKey, HTMLButtonElement>();
  for (const key of BIOME_KEYS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = BIOMES[key].label;
    btn.addEventListener('click', () => {
      preview(choice.seed, choice.vehicle, choice.size, key);
      btn.blur();
    });
    pregameBiome.appendChild(btn);
    biomeButtons.set(key, btn);
  }

  /** Draw a circuit on the select screen without building any of it. */
  function preview(seed: number, vehicle: VehicleKey, size: SizeKey, biome: BiomeKey) {
    choice = { seed, vehicle, size, biome };
    for (const [key, btn] of sizeButtons) btn.setAttribute('aria-pressed', String(key === size));
    for (const [key, btn] of vehicleButtons) btn.setAttribute('aria-pressed', String(key === vehicle));
    for (const [key, btn] of biomeButtons) btn.setAttribute('aria-pressed', String(key === biome));
    const shape = circuitFor(seed, sizeOf(size));
    const p = shapePreview(shape);
    pregameMap.setAttribute('viewBox', p.box.join(' '));
    road.setAttribute('stroke', BIOMES[biome].map.road);
    road.setAttribute('d', p.path);
    paint.setAttribute('d', p.path);
    startLine.setAttribute('x1', String(p.start[0])); startLine.setAttribute('y1', String(p.start[1]));
    startLine.setAttribute('x2', String(p.start[2])); startLine.setAttribute('y2', String(p.start[3]));
    if (document.activeElement !== pregameSeed) pregameSeed.value = String(seed);
    // Rated against the chosen vehicle's own top speed and rating, because
    // that is what decides which corners are corners: a different car
    // really does make a circuit easier or harder, and a rating that
    // ignored it would be describing somebody else's car.
    const spec = VEHICLES[vehicle];
    const r = rateTrack(shape, spec.engine.topSpeed * SETTINGS.pace, spec.rating);
    const band = difficultyBand(r.difficulty);
    pregameFacts.innerHTML =
      `${seed === 0 ? 'the original circuit' : `circuit <span>#${seed}</span>`}`
      + ` · <span>${labelOf(size)}</span>`
      + ` · <span>${labelOfBiome(biome)}</span>`
      + ` · <span>${spec.label}</span>`
      + ` · <span>${(p.length / 1000).toFixed(1)}</span> m`
      + ` · about <span>${r.par.toFixed(1)}</span> s a lap`
      + ` · tightest corner <span>${Math.round(p.curve)}</span> mm`;
    // A circuit with a corner the chosen car cannot turn is not undrivable —
    // there is the width of the road, and reverse — but it is what the long
    // cars pay for: on circuits like it the F1 laps a median 8% over par and
    // badly on one in twelve, against 6% and none where it fits.
    // Said as a fact, not a verdict, because the tightest corner on its own
    // predicts trouble only that loosely. See the README, "Cars and sizes".
    pregameWarn.hidden = p.curve >= spec.turnCircle;
    if (!pregameWarn.hidden) {
      pregameWarn.innerHTML = `tighter than the ${spec.label} can turn: a <span>${Math.round(p.curve)}</span> mm corner, `
        + `and the car's tightest circle is <span>${spec.turnCircle}</span> mm`;
    }
    pregameRating.innerHTML =
      `<b>${'\u25cf'.repeat(band.level)}${'\u25cb'.repeat(5 - band.level)}</b> ${band.name}`;
  }

  function openPregame() {
    racing = false;
    preview(SETTINGS.seed, SETTINGS.vehicle, SETTINGS.size, SETTINGS.biome);
    pregame.removeAttribute('hidden');
  }

  function startRace() {
    // Rebuild only what actually changed. Racing the same road in the same
    // car again is a reset and costs nothing; a different road — a seed, a
    // size or a biome — rebuilds the arena (and brings a different vehicle
    // with it in the same pass, so choosing several at once is not several
    // rebuilds); a different car on the same road is a mesh swap and
    // nothing more.
    const roadChanged = choice.seed !== built.seed || choice.size !== built.size || choice.biome !== built.biome;
    const vehicleChanged = choice.vehicle !== built.vehicle;
    if (roadChanged) {
      newTrack(choice.seed, choice.size, choice.biome);
      if (vehicleChanged) { SETTINGS.vehicle = choice.vehicle; save(); switchVehicle(VEHICLES[choice.vehicle]); }
      built = { ...choice };
    } else if (vehicleChanged) {
      // a different car on the same road: swap the meshes and the physics,
      // and clear the ghost — its lap belongs to the vehicle it was driven
      // in as much as to the circuit
      SETTINGS.vehicle = choice.vehicle;
      save();
      switchVehicle(VEHICLES[choice.vehicle]);
      built = { ...choice };
    } else {
      arena.reset();
    }
    pregame.setAttribute('hidden', '');
    racing = true;
  }

  pregameAnother.addEventListener('click', () => {
    preview(1 + Math.floor(Math.random() * 998), choice.vehicle, choice.size, choice.biome);
    (pregameAnother as HTMLElement).blur();
  });
  pregameSeed.addEventListener('input', () => {
    const v = Math.max(0, Math.min(999999, Math.floor(Number(pregameSeed.value))));
    if (Number.isFinite(v)) preview(v, choice.vehicle, choice.size, choice.biome);
  });
  pregameSeed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { pregameSeed.blur(); startRace(); }
    e.stopPropagation();
  });
  pregameGo.addEventListener('click', () => { startRace(); (pregameGo as HTMLElement).blur(); });
  addEventListener('keydown', (e) => {
    if (!pregame.hidden && e.key === 'Enter') startRace();
  });

  const lights = new LightPool(LIGHT_CAPACITY);
  const quads = new Float32Array(EFFECT_CAPACITY * EFFECT_STRIDE);
  const input = watchInput(arena);
  const minimap = buildMinimap(arena);
  // The settings panel. Three of the nine are read live by whoever uses
  // them and need nothing done here; the clock and the night ambient are
  // turned into the renderer's look by `applySky`, the three post knobs
  // into the renderer's post chain, and the field size rebuilds the grid,
  // so those are applied.
  const applyPost = () => {
    renderer.post = { ...renderer.post, bloom: SETTINGS.bloom, vignette: SETTINGS.vignette, grain: SETTINGS.grain };
  };
  buildConfig((key) => {
    if (key === 'ambient' || key === 'time') applySky();
    if (key === 'bloom' || key === 'vignette' || key === 'grain') applyPost();
    if (key === 'mist') applySky();
  }, () => { configPanel.hidden = true; openPregame(); });
  applySky();
  applyPost();
  // Drag to swing the camera round, wheel to come in and out, shift-drag to
  // slide it. The floor is opaque from below and the arena is meant to be
  // looked into, so the polar range stops short of the horizon and of
  // straight down.
  const orbit = new Orbit(renderer.camera, {
    element: canvas,
    minPolar: 0.18,
    maxPolar: 1.36,
    rotateSpeed: 0.42,
    zoomSpeed: 0.8,
    // the camera follows the ship, so its target is not the player's to move
    panSpeed: 0,
    // less carry than the still-life viewer's: a camera that keeps drifting
    // after the hand comes off is a camera you fight while trying to fly
    inertia: 0.45,
  });
  // for poking at from the console while tuning
  /**
   * Draw the same frame `n` times and fence on the queue, for measuring what
   * a setting costs without the compositor in the way. Frame time off a
   * requestAnimationFrame loop is only as honest as the tab is visible, and
   * a browser pane that is not on screen stops calling back altogether —
   * which reads as a scene that got mysteriously slower.
   */
  const measure = async (w = 1920, h = 1080, n = 120) => {
    // Size it explicitly. A pane that is not on screen lays its canvas out at
    // nothing, and a measurement of a one-pixel frame is a measurement of the
    // driver's overhead — which is how an earlier calibration in this family
    // of projects came back with seven hundred thousand ms a megapixel.
    renderer.resize(w, h);
    const off = ctx.device.createTexture({
      size: [w, h], format: ctx.format, usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    upload();
    const view = () => off.createView();
    for (let i = 0; i < 10; i++) renderer.frame(view());
    await ctx.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) renderer.frame(view());
    await ctx.queue.onSubmittedWorkDone();
    const ms = (performance.now() - t0) / n;
    off.destroy();
    renderer.resize(width, height);
    return {
      ms: +ms.toFixed(3), mpx: +((w * h) / 1e6).toFixed(2),
      msPerMpx: +(ms / ((w * h) / 1e6)).toFixed(2),
      lights: lights.count,
    };
  };
  /**
   * Draw one frame at a chosen size and post it to the dev server, which
   * writes it to docs/. A screenshot of the browser is a screenshot of the
   * browser: this is the frame itself, at whatever size the picture wants.
   */
  const shoot = async (w = 1600, h = 900, name = 'arena') => {
    canvas.width = w; canvas.height = h;
    renderer.resize(w, h);
    if (!touched) reframe(true, w / h);
    // the orbit eases toward where it was sent, and a capture does not have
    // a hundred frames to get there
    followShip(1);
    orbit.update();
    setDepthRange(renderer.camera);
    upload();
    renderer.frame(ctx.context.getCurrentTexture().createView(), 'redraw', 1 / 60);
    await ctx.queue.onSubmittedWorkDone();
    const png = canvas.toDataURL('image/png');
    await fetch(`/__shot?name=${name}`, { method: 'POST', body: png });
    return png.length;
  };
  Object.assign(globalThis as Record<string, unknown>, {
    arena, renderer, orbit, input, lights, measure, shoot, skids, newTrack, timings, switchVehicle,
    // the app's own copy of the circuit. A console `import('/src/track.ts')`
    // is a different module instance with a different shape in it, which
    // makes a test driver steer for a road that is not there.
    track: { centreline, tangentAt, generateTrack, where, radialToAcross, circuitFor, scaleShape, measureShape },
    furniture: { rails: () => RAILS, bollards: () => BOLLARDS, signs: () => SIGNS, buffers: furnitureBuffers },
    world: { SIZES, sizeOf, labelOf, columns: () => COLUMNS, props: () => PROPS },
    biomes: BIOMES,
    vehicles: VEHICLES, bench,
  });

  /**
   * Frame the arena, and set how far in and out the wheel may go from there.
   * `touched` latches the moment the camera is moved by hand, after which a
   * resize adjusts the limits but leaves the view where it was put.
   */
  let touched = false;
  /** The distance at which the whole arena is in frame. Set by every reframe. */
  let fitted = 2000;
  const reframe = (move: boolean, aspect = canvas.width / Math.max(1, canvas.height)) => {
    const before = renderer.camera.position.slice() as [number, number, number];
    const target = renderer.camera.target.slice() as [number, number, number];
    fitted = fitCamera(renderer.camera, aspect);
    // The camera follows the truck at a fixed distance now, and the fit is
    // only how far out the wheel may go. It used to set the distance too,
    // which is what a game whose track fits on one screen wants and this no
    // longer is: the circuit is twenty-nine metres round and the view about
    // three and a half wide, so the track scrolls past.
    orbit.minDistance = FOLLOW_MIN;
    orbit.maxDistance = Math.max(fitted, FOLLOW_DISTANCE * 1.2);
    if (move) {
      // At the follow distance, which is a length and not a fraction of the
      // arena: how much road you can see should not depend on how big the
      // circuit happens to be. Moved before the orbit adopts it, because
      // `setSpherical` eases and a view that drifts into place over the first
      // second of a race looks like something is wrong.
      const t = renderer.camera.target;
      const pos = renderer.camera.position;
      const d = Math.hypot(pos[0] - t[0], pos[1] - t[1], pos[2] - t[2]) || 1;
      const k = FOLLOW_DISTANCE / d;
      renderer.camera.position = [
        t[0] + (pos[0] - t[0]) * k,
        t[1] + (pos[1] - t[1]) * k,
        t[2] + (pos[2] - t[2]) * k,
      ];
      renderer.camera.update();
      orbit.forcePosition();
      return;
    }
    renderer.camera.position = before;
    renderer.camera.target = target;
    renderer.camera.update();
  };

  /**
   * Where the camera looks: the truck, led a little in the direction it is
   * going so there is more road ahead of it than behind.
   *
   * It used to be held on a leash whose length was how much of the arena was
   * off screen, which kept the whole thing in frame — right when the whole
   * thing fitted, and this circuit does not. The leash is gone and the view
   * scrolls. Zooming all the way out is still there for looking at the lap
   * you have just driven.
   */
  const aim: [number, number, number] = [0, 0, CAMERA_HEIGHT];
  /**
   * Chase mode: the camera sits behind the truck instead of at a compass
   * angle the driver chose. An experiment, on V.
   *
   * Kept as a continuous angle rather than one wrapped into a turn, because
   * the orbit eases toward whatever it is given by simple interpolation: a
   * truck whose yaw crosses pi would otherwise hand the camera a target 2pi
   * away and it would swing all the way round the wrong side to reach the
   * same place.
   */
  let chase = false;
  let chaseAzimuth = 0;

  const followShip = (dt: number) => {
    const t = arena.shown;
    const { vx, vy } = arena.truck;
    if (chase) {
      // behind means opposite the nose: the orbit's azimuth is measured from
      // the target out to the camera
      let d = (t.yaw + Math.PI) - chaseAzimuth;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      chaseAzimuth += d;
      // Only the azimuth, and every frame. The polar and the radius are left
      // to the wheel and the drag, so the height and the distance of the
      // chase are still the player's — what the mode takes away is only the
      // choice of which way round the truck to stand.
      orbit.setSpherical({ azimuth: chaseAzimuth });
    }
    // From behind, the lead that makes the overhead view work throws the
    // truck off the side of the frame: 0.32 seconds at racing speed is 590mm
    // of a chase that is only 1500 long, and the camera is already lagging
    // the yaw through a corner. A third of it, and a target that catches up
    // twice as fast.
    const lead = chase ? CHASE_LEAD : LEAD_TIME;
    const wantX = t.x + vx * lead;
    const wantY = t.y + vy * lead;
    const k = Math.min(1, dt * (chase ? 9 : 4.5));
    aim[0] += (wantX - aim[0]) * k;
    aim[1] += (wantY - aim[1]) * k;
    // up and down with the ground, more slowly than across it: a camera that
    // tracked every rise and jump exactly would make the arena the thing that
    // moves rather than the truck
    aim[2] += ((CAMERA_HEIGHT + groundAt(t.x, t.y) * 0.75) - aim[2]) * Math.min(1, dt * 1.8);
    renderer.camera.target = [aim[0], aim[1], aim[2]];
  };

  let width = 0, height = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // A canvas in a document that is not being laid out measures zero, and
    // fitting a camera to a one-pixel frame pulls it back until the arena is
    // a speck. Fall back to a plain 16:9 rather than believing it.
    const laidOut = canvas.clientWidth > 4 && canvas.clientHeight > 4;
    width = laidOut ? Math.round(canvas.clientWidth * dpr) : 1280;
    height = laidOut ? Math.round(canvas.clientHeight * dpr) : 720;
    canvas.width = width; canvas.height = height;
    renderer.resize(width, height);
    // Re-frame only while the camera is where the arena put it. Once it has
    // been moved, a resize must not yank it back — but the distance that
    // fits does change with the shape of the window, so the limits move.
    reframe(!touched);
  };
  addEventListener('resize', resize);
  resize();

  await renderer.ready;
  for (const el of [scorePanel, statsPanel, helpPanel, mapPanel]) el.removeAttribute('hidden');
  boot.classList.add('gone');
  setTimeout(() => boot.setAttribute('hidden', ''), 500);
  openPregame();

  /**
   * Everything the GPU needs for the state the arena is in: where each thing
   * is, what colour it is, what is lighting it, and what is glowing over the
   * top. The frame loop calls it, and so does `shoot` — a capture that only
   * drew would draw whatever the loop last uploaded, which on a paused tab is
   * an empty arena lit by a full set of lights.
   */
  const upload = (): number => {
    // The truck, and the ghost if there is a lap to put one on the road.
    // Both are drawn from a pose and nothing else: the live one's comes from
    // the physics, the ghost's from a recording read between two samples, and
    // this loop cannot tell which is which. Nothing here decides where
    // anything is — the chassis takes the body's three angles, each wheel its
    // own suspension travel and steer and roll, the lamps ride the same
    // frame. A wheel drawn anywhere but where the ray found the ground is a
    // wheel you can see floating.
    drawn.length = 0;
    drawn.push(arena.shown);
    const past = arena.ghostShown;
    if (past) drawn.push(past);
    // The Concours presentation: the car turning on its plinth for the
    // countdown, then set down on the road. Only what is drawn moves.
    const concours = SETTINGS.concours;
    const shows = concours && racing ? presentation(arena.countdown, COUNTDOWN, arena.sinceStart, arena.running) : null;
    let plinthShown = 0;
    if (shows) {
      const live = drawn[0];
      const road = groundAt(live.x, live.y) + drawnLift(live.x, live.y);
      drawn[0] = { ...live, yaw: live.yaw + shows.spin, z: live.z + shows.lift };
      placeVehiclePart(plinthM, 0, live.x, live.y, road - shows.sink, live.yaw + shows.spin, 0, 0);
      plinthShown = 1;
    }
    let gemsShown = 0;
    drawn.forEach((truck: Pose, ci: number) => {
      const yaw = truck.yaw, pitch = truck.pitch, roll = truck.roll;
      const cy = Math.cos(yaw); const sy = Math.sin(yaw);
      const cp = Math.cos(pitch); const sp = Math.sin(pitch);
      const cr = Math.cos(roll); const sr = Math.sin(roll);
      const bf: [number, number, number] = [cy * cp, sy * cp, -sp];
      const bl: [number, number, number] = [cy * sp * sr - sy * cr, sy * sp * sr + cy * cr, cp * sr];
      const bu: [number, number, number] = [cy * sp * cr + sy * sr, sy * sp * cr - cy * sr, cp * cr];
      const on = (lx: number, ly: number, lz: number): [number, number, number] => [
        truck.x + bf[0] * lx + bl[0] * ly + bu[0] * lz,
        truck.y + bf[1] * lx + bl[1] * ly + bu[1] * lz,
        truck.z + bf[2] * lx + bl[2] * ly + bu[2] * lz,
      ];

      // Both poses drawn here belong to the vehicle in force: the ghost is
      // cleared whenever the class changes (`Race.useVehicle`), so it is
      // never a recording of a different kit's geometry.
      const spec = arena.truck.spec;
      const chassis = on(0, 0, 0);
      placeVehiclePart(chassisM, ci, chassis[0], chassis[1], chassis[2], yaw, pitch, roll);
      // a deeper, warmer gold than the paint for the Concours, which by day
      // read as sand; the ghost keeps its own cold colour
      chassisMat.set([...(concours && ci === 0 ? CONCOURS_GOLD : PAINT[ci]), concours ? 0.05 : 0.24], ci * 4);
      if (concours) {
        placeVehiclePart(ornamentM, ci, chassis[0], chassis[1], chassis[2], yaw, pitch, roll);
        // a stone for every lap you have finished, set in the curls in order
        if (ci === 0) {
          const { sites } = filigreeOf(arena.truck.spec);
          gemsShown = Math.min(arena.laps, sites.length, GEM_CAPACITY);
          for (let g = 0; g < gemsShown; g++) {
            const { at, side, size } = sites[g];
            const c = on(at[0], at[1], at[2]);
            // the table faces out of the flank: z out, x along the car
            const zx = bl[0] * side, zy = bl[1] * side, zz = bl[2] * side;
            const yx = zy * bf[2] - zz * bf[1], yy = zz * bf[0] - zx * bf[2], yz = zx * bf[1] - zy * bf[0];
            gemM.set([bf[0] * size, bf[1] * size, bf[2] * size, 0, yx * size, yy * size, yz * size, 0, zx * size, zy * size, zz * size, 0, c[0], c[1], c[2], 1], g * 16);
          }
        }
      }
      const [dx, dy, dz] = spec.kit.detail.at;
      const cab = on(dx, dy, dz);
      placeVehiclePart(cabM, ci, cab[0], cab[1], cab[2], yaw, pitch, roll);

      for (let i = 0; i < spec.wheels.length; i++) {
        const [lx, ly, lz] = spec.wheels[i];
        const w = truck.wheels[i];
        const hub = on(lx, ly, lz - w.drop);
        placeVehicleWheel(wheelM, ci * 4 + i, hub[0], hub[1], hub[2], yaw, pitch, roll, w.steer, w.spin);
        // Smoke, spray and rubber come off the live truck only. The ghost
        // laid all three on the lap it was recorded from and would lay them
        // again every lap since, which is a road wearing marks from a truck
        // that is not on it.
        if (ci > 0) continue;
        const live = arena.truck;
        const lw = live.wheels[i];
        wheelEffects(renderer, live, lw, hub, sky.day);
        const key = `${i}`;
        if (lw.onGround && !lw.wet && lw.slide > 0.35 && live.speed > 300) skids.mark(key, hub[0], hub[1], lw.ground);
        else skids.lift(key);
      }

      let lamp = 0;
      const [hx, hy, hz] = spec.kit.lights.head;
      for (const ly of [-hy, hy]) {
        const at = on(hx, ly, hz);
        // facing, not wheeled: a lamp looks along the nose where a wheel
        // turns about an axle across it
        placeVehicleFacing(lampM, ci * 2 + lamp++, at[0], at[1], at[2], yaw, pitch, roll);
      }
    });
    const shown = drawn.length;
    renderer.move(CHASSIS, chassisM, shown);
    renderer.tint(CHASSIS, chassisMat);
    renderer.move(CAB, cabM, shown);
    renderer.move(WHEELS_GROUP, wheelM, shown * 4);
    renderer.move(LAMPS, lampM, shown * 2);
    renderer.move(ORNAMENT, ornamentM, concours ? shown : 0);
    renderer.move(GEMS, gemM, gemsShown);
    renderer.move(PLINTH, plinthM, plinthShown);
    renderer.move(VELVET, plinthM, plinthShown);
    if (skids.dirty) { renderer.move(SKIDS, skids.matrices, skids.count); skids.dirty = false; }

    // the starting lights: dark until lit, then a hot red, all out on the go
    for (let i = 0; i < 2 * START_BULBS; i++) {
      const on = (i % START_BULBS) < arena.bulbsLit;
      const o = i * 4;
      startMat[o] = on ? 1.0 : 0.20;
      startMat[o + 1] = on ? 0.10 : 0.035;
      startMat[o + 2] = on ? 0.07 : 0.030;
      startMat[o + 3] = on ? 0.10 : 0.35;
    }
    renderer.tint(START_LAMPS, startMat);

    lightsFor(lights, arena);
    renderer.setLights(lights, shadowedLamps(arena));
    renderer.camera.update();
    const effects = effectsFor(quads, arena, renderer.camera.viewProjection);
    renderer.setEffects(quads, effects);
    return effects;
  };

  let last = performance.now();
  let t = 0;
  let smoothed = 16.7;
  let statsIn = 0;

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    // a long pause — a tab in the background, a garbage collection — must not
    // teleport everything through a wall
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now; t += dt;

    if (input.takeRecentre()) { aim[0] = 0; aim[1] = 0; reframe(true); }
    if (input.takeChaseToggle()) {
      chase = !chase;
      if (chase) {
        // Behind the truck, expressed as the angle nearest where the camera
        // already is. The orbit eases toward whatever angle it is handed by
        // plain interpolation and never wraps, so an angle a turn away from
        // an identical one is a camera that swings four fifths of a circle to
        // arrive where it could have reached in a fifth. It did: 4.95 radians
        // the long way round, on a switch that should be barely a movement.
        const cam = renderer.camera;
        const now = Math.atan2(cam.position[1] - cam.target[1], cam.position[0] - cam.target[0]);
        let d = (arena.shown.yaw + Math.PI) - now;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        chaseAzimuth = now + d;
        orbit.setSpherical({ azimuth: chaseAzimuth, polar: CHASE_POLAR, radius: CHASE_DISTANCE });
      }
      touched = true;
    }
    // the sky follows the clock and the clock follows the truck, every frame
    applySky();
    followShip(dt);
    orbit.update();
    setDepthRange(renderer.camera);
    // The circuit chooser holds the race: the arena is drawn behind it, but
    // nothing steps and the lights do not count down. A countdown that ran
    // while you were picking a track would be over before you picked one.
    if (racing) arena.advance(dt, input.read());
    updateSunShadow(renderer.camera.target[0], renderer.camera.target[1]);

    const effects = upload();

    // redraw, not keep: every one of those lights moves, and a kept static
    // half would be lit by where they were when it was baked
    renderer.frame(ctx.context.getCurrentTexture().createView(), 'redraw', dt);

    minimap.update();

    smoothed += (dt * 1000 - smoothed) * 0.08;
    statsIn -= dt;
    if (statsIn <= 0) {
      statsIn = 0.2;
      const delta = arena.delta;
      scorePanel.innerHTML =
        `<b>${arena.running ? clock(arena.lapTime) : Math.ceil(arena.countdown) + '…'}</b>`
        + `lap <span>${arena.laps + 1}</span>`
        + ` · best <span>${arena.bestLap === null ? '—:——.—' : clock(arena.bestLap)}</span>`
        + ` · last <span>${arena.lastLap === null ? '—:——.—' : clock(arena.lastLap)}</span>`
        + ` · ghost <span${delta === null ? '' : ` class="${delta <= 0 ? 'up' : 'down'}"`}>${delta === null ? '—.——' : gap(delta)}</span>`;
      statsPanel.innerHTML =
        `<span>${smoothed.toFixed(1)}</span> ms · <span>${Math.round(1000 / smoothed)}</span> fps<br>`
        + `<span>${lights.count}</span> lights · <span>${effects}</span> glows<br>`
        + `<span>${Math.round(arena.speed)}</span> speed · <span>${clockLabel(arena.hours)}</span>`
        + `${arena.airborne ? ' · <span>airborne</span>' : ''}`
        + `${Math.abs(arena.offset) > TRACK_HALF ? ' · <span>off track</span>' : ''}<br>`
        + `<span>${width}×${height}</span>`;
    }
  };
  requestAnimationFrame(frame);
}

/**
 * Back the camera off until the whole arena is inside the frame.
 *
 * The angle it looks from is a choice; the distance is not, and hardcoding
 * one crops the near corners on a window the wrong shape — which in a game
 * where enemies come in from the edges means being killed by something that
 * was never on screen. So the corners are projected and the distance is
 * solved for, on every resize.
 */
/**
 * The eight corners of the box everything in the arena stands inside.
 *
 * A function and not a module-level constant, because `ARENA_X`/`ARENA_Y`
 * move with the size the player chose and are no longer fixed at load time.
 * Eight corners a frame is nothing next to the rest of a frame's cost.
 */
function arenaCorners(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const x of [-ARENA_X, ARENA_X]) {
    for (const y of [-ARENA_Y, ARENA_Y]) {
      for (const z of [0, 380]) out.push([x, y, z]);
    }
  }
  return out;
}

/**
 * Keep the depth range around what the camera can actually see.
 *
 * The camera class defaults to a far plane of four metres, which was ample
 * for a piece of jewellery on a table and is not for an arena 2.8 metres
 * across seen from three metres back: the far corners fall outside it and
 * are simply not drawn. Nothing warns about this — the geometry is there,
 * the frame is fine, the arena just stops. So the range is derived from the
 * corners every frame rather than set once and hoped over.
 */
function setDepthRange(cam: GameRenderer['camera']) {
  let far = 0;
  for (const c of arenaCorners()) {
    const d = Math.hypot(c[0] - cam.position[0], c[1] - cam.position[1], c[2] - cam.position[2]);
    if (d > far) far = d;
  }
  // a fifth over, for the posts standing up and the glows drawn past them
  cam.far = far * 1.2 + 300;
  // near is fixed and small: the ratio to far stays under a thousand, which
  // a 24-bit depth buffer carries without a hint of z-fighting
  cam.near = 15;
}

function fitCamera(cam: GameRenderer['camera'], aspect: number): number {
  const target: [number, number, number] = [0, 0, CAMERA_HEIGHT];
  // back and up from the target, at the angle the arena reads best from
  const back = norm([0, -1.32, 0.915]);
  const corners = arenaCorners();
  cam.aspect = aspect;
  cam.target = target;
  // Wide enough for the largest arena: a fixed 6000 was already close to
  // binding at the shipped size, and a search that cannot reach far enough
  // converges silently on a distance that does not actually frame the
  // corners rather than failing loudly.
  let lo = 500, hi = 2.5 * Math.hypot(ARENA_X, ARENA_Y);
  for (let i = 0; i < 22; i++) {
    const d = (lo + hi) / 2;
    cam.position = [target[0] + back[0] * d, target[1] + back[1] * d, target[2] + back[2] * d];
    setDepthRange(cam);
    cam.update();
    // Across the frame only. Depth is not tested here and must not be: the
    // far plane is derived from these same corners a line above, so it always
    // clears them, and normalised depth is so nonlinear that everything at
    // arena range reads 0.998 whatever the plane is set to — a threshold on
    // it rejects every distance and the search runs to its cap.
    const fits = corners.every((c) => {
      const p = project(cam.viewProjection, c[0], c[1], c[2]);
      return p !== null && p[2] < cam.far
        && Math.abs(p[0]) <= 0.985 && Math.abs(p[1]) <= 0.985;
    });
    if (fits) hi = d; else lo = d;
  }
  cam.position = [target[0] + back[0] * hi, target[1] + back[1] * hi, target[2] + back[2] * hi];
  setDepthRange(cam);
  cam.update();
  return hi;
}

/**
 * How far the camera sits from the truck, as a length and not a fraction of
 * the arena: at a 40 degree lens that is about three and a half metres of road
 * across the frame, with the truck a fourteenth of its width.
 */
const FOLLOW_DISTANCE = 3900;
const FOLLOW_MIN = 1100;
/** How far ahead of itself the camera looks, in seconds of travel. */
const LEAD_TIME = 0.32;
/** How high off the floor the camera looks. The fit solves for this exact
 *  point, so at full zoom-out the guarantee that everything is in frame holds. */
const CAMERA_HEIGHT = 55;
/**
 * Where the chase camera stands: closer than the overhead view and much
 * lower, which is the whole difference between the two. From above you read
 * the corner; from behind you read the car.
 */
const CHASE_DISTANCE = 1500;
const CHASE_POLAR = 1.18;
/** How far ahead the chase camera looks, in seconds of travel. */
const CHASE_LEAD = 0.1;


/** Where the gantry posts stand: one either side of the line. */
function gantryPosts(): Float32Array {
  const g = gantry();
  const out = new Float32Array(g.posts.length * 16);
  g.posts.forEach(([x, y], i) => {
    placeOnSlope(out, i, x, y, groundAt(x, y) - 20, g.facing, [0, 0, 1]);
  });
  return out;
}

/** The bulbs on them, facing back down the track at the driver. */
function startBulbs(): Float32Array {
  const g = gantry();
  const out = new Float32Array(g.posts.length * START_BULBS * 16);
  let k = 0;
  for (const [px, py] of g.posts) {
    const base = groundAt(px, py);
    for (const h of g.bulbHeights) {
      placeVehicleFacing(out, k++,
        px + Math.cos(g.facing) * 34, py + Math.sin(g.facing) * 34, base + h,
        g.facing, 0, 0);
    }
  }
  return out;
}

/**
 * The minimap: the whole circuit drawn once, with a dot per car moved over it.
 *
 * Two dimensions and no GPU. The track is an analytic curve, so its shape is
 * a path built at startup from the same function the wheels and the lap
 * counter read, and the only thing that changes from frame to frame is four
 * pairs of coordinates. A second render pass would cost a second pass; this
 * costs eight attribute writes.
 *
 * SVG's y runs down and the world's runs up, so it is negated — otherwise the
 * map is a mirror of the track, which is worse than no map.
 */
function buildMinimap(race: Race) {
  const NS = 'http://www.w3.org/2000/svg';
  const STEPS = 320;

  const road = document.createElementNS(NS, 'path');
  road.setAttribute('fill', 'none');
  road.setAttribute('stroke', BIOME.map.road);
  road.setAttribute('stroke-width', String(TRACK_HALF * 2));
  road.setAttribute('stroke-linejoin', 'round');
  mapSvg.appendChild(road);

  // The lakes, and the fords: every cell of a grid whose ground is under
  // the water, as one path of squares, drawn over the road so that where
  // the road goes into the water on the ground it goes into the water here.
  // At 150mm a cell it is two pixels on the map, which is a shoreline. None
  // at all in a biome with no water — `underWater` is always false there.
  const water = document.createElementNS(NS, 'path');
  water.setAttribute('fill', BIOME.map.water);
  mapSvg.appendChild(water);

  // the start line, across the road at the top of the lap
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('stroke', '#e6e4f0');
  line.setAttribute('stroke-width', '120');
  mapSvg.appendChild(line);

  /** Draw the circuit, its water and its line. Called again for a new one. */
  function redraw() {
    road.setAttribute('stroke', BIOME.map.road);
    water.setAttribute('fill', BIOME.map.water);
    let lo = Infinity, hi = -Infinity;
    let path = '';
    for (let i = 0; i <= STEPS; i++) {
      const t = (i / STEPS) * Math.PI * 2 - Math.PI;
      const [x, y] = centreline(t);
      lo = Math.min(lo, x, -y); hi = Math.max(hi, x, -y);
      path += `${i === 0 ? 'M' : 'L'}${x.toFixed(0)} ${(-y).toFixed(0)}`;
    }
    path += 'Z';
    const pad = TRACK_HALF + 260;
    mapSvg.setAttribute('viewBox', `${lo - pad} ${lo - pad} ${hi - lo + pad * 2} ${hi - lo + pad * 2}`);
    road.setAttribute('d', path);

    // Scaled with the arena, or a large one spends four times as many
    // `underWater` samples on a map drawn at the same pixel size — the lake
    // shorelines are drawn at a few pixels either way, so a coarser cell on
    // a bigger circuit costs nothing the map itself would show.
    const CELL = 150 * SIZE;
    let lakes = '';
    const reach = Math.max(ARENA_X, ARENA_Y) + 400;
    for (let y = -reach; y < reach; y += CELL) {
      for (let x = -reach; x < reach; x += CELL) {
        if (underWater(x + CELL / 2, y + CELL / 2)) {
          lakes += `M${x} ${-y - CELL}h${CELL}v${CELL}h${-CELL}z`;
        }
      }
    }
    water.setAttribute('d', lakes);

    const [sx, sy] = centreline(-Math.PI);
    const [tx, ty] = tangentAt(-Math.PI);
    line.setAttribute('x1', String(sx + ty * TRACK_HALF));
    line.setAttribute('y1', String(-(sy - tx * TRACK_HALF)));
    line.setAttribute('x2', String(sx - ty * TRACK_HALF));
    line.setAttribute('y2', String(-(sy + tx * TRACK_HALF)));
  }
  redraw();

  // two dots: yours, and the ghost's when it is on the road
  const dots = Array.from({ length: TRUCKS }, (_, i) => {
    const c = document.createElementNS(NS, 'circle');
    const [r, g, b] = PAINT[i];
    const hex = (v: number) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0');
    // The player's is half again as big and outlined, so which dot is yours
    // is never a question. At 168 pixels across a map ten metres wide, 260
    // world units is four pixels — big enough to see and not big enough to
    // pick out at a glance while driving.
    c.setAttribute('r', i === 0 ? '430' : '230');
    c.setAttribute('fill', `#${hex(r)}${hex(g)}${hex(b)}`);
    if (i === 0) { c.setAttribute('stroke', '#ffffff'); c.setAttribute('stroke-width', '150'); }
    mapSvg.appendChild(c);
    return c;
  });

  return {
    redraw,
    update() {
      const past = race.ghostShown;
      const at = [race.shown, past];
      dots.forEach((dot, i) => {
        const p = at[i];
        dot.setAttribute('visibility', p ? 'visible' : 'hidden');
        if (!p) return;
        dot.setAttribute('cx', p.x.toFixed(0));
        dot.setAttribute('cy', (-p.y).toFixed(0));
      });
    },
  };
}

/** A gap to the ghost, signed: behind is a plus, which is how a gap is read. */
function gap(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  return `${sign}${Math.abs(seconds).toFixed(2)}`;
}

/** Minutes, seconds and tenths, which is how a lap time is read. */
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const rest = seconds - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(2)}`;
}

function identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/**
 * The settings panel: a slider per control, a readout beside each, and a
 * button to put them all back. Built from the table in `settings.ts` so that
 * adding a knob is one line there and none here.
 *
 * Every change is written straight into the live settings and saved, and
 * the caller is told which key moved for the two that need applying by hand.
 */
function buildConfig(applied: (key: SliderKey) => void, chooseCircuit: () => void) {
  const rows = document.createElement('div');
  rows.className = 'rows';
  const readouts = new Map<string, HTMLElement>();
  const sliders = new Map<string, HTMLInputElement>();
  for (const c of CONTROLS) {
    const row = document.createElement('label');
    const name = document.createElement('span'); name.textContent = c.label;
    const value = document.createElement('output'); value.textContent = c.show(SETTINGS[c.key]);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = String(c.min); slider.max = String(c.max); slider.step = String(c.step);
    slider.value = String(SETTINGS[c.key]);
    slider.addEventListener('input', () => {
      SETTINGS[c.key] = Number(slider.value);
      value.textContent = c.show(SETTINGS[c.key]);
      save();
      applied(c.key);
    });
    row.append(name, slider, value);
    rows.appendChild(row);
    readouts.set(c.key, value); sliders.set(c.key, slider);
  }
  // The circuit. A row of its own above the buttons, because it is the one
  // control that throws away what you were doing: a new road means a new
  // best lap, so it says which circuit you are on and asks before it moves
  // you off it.
  const trackRow = document.createElement('label');
  const trackName = document.createElement('span'); trackName.textContent = 'circuit';
  const shuffle = document.createElement('button');
  shuffle.type = 'button'; shuffle.className = 'wide';
  const trackValue = document.createElement('output');
  const showSeed = () => {
    const seed = SETTINGS.seed === 0 ? 'the original' : `#${SETTINGS.seed}`;
    trackValue.textContent = `${labelOf(SETTINGS.size)} · ${seed} · ${labelOfBiome(SETTINGS.biome)} · ${VEHICLES[SETTINGS.vehicle].label}`;
    shuffle.textContent = 'choose circuit';
  };
  showSeed();
  shuffle.addEventListener('click', () => {
    chooseCircuit();
    shuffle.blur();
  });
  trackRow.append(trackName, shuffle, trackValue);
  rows.appendChild(trackRow);

  const foot = document.createElement('div');
  foot.className = 'foot';
  const reset = document.createElement('button');
  reset.type = 'button'; reset.textContent = 'defaults';
  reset.addEventListener('click', () => {
    restoreDefaults();
    for (const c of CONTROLS) {
      sliders.get(c.key)!.value = String(SETTINGS[c.key]);
      readouts.get(c.key)!.textContent = c.show(SETTINGS[c.key]);
      applied(c.key);
    }
    reset.blur();
  });
  const hint = document.createElement('span'); hint.textContent = 'Esc to close';
  foot.append(reset, hint);
  configPanel.replaceChildren(rows, foot);
}

/**
 * The keys, and nothing else: the mouse belongs entirely to the camera now
 * that there is no gun to aim.
 */
function watchInput(race: Race) {
  const held = new Set<string>();
  let recentre = false;
  let chaseToggle = false;

  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    // The chooser owns the keyboard while it is up: every key here drives a
    // truck that is not going anywhere yet. Enter is handled where the
    // chooser lives, next to the button it stands in for.
    if (!pregame.hidden) return;
    if (k === 'escape') { configPanel.hidden = !configPanel.hidden; (e.target as HTMLElement | null)?.blur?.(); return; }
    // A slider with the focus is being driven by the arrow keys, and the
    // truck must not be: the same keystroke steering the car and nudging the
    // ambient light is a panel nobody can use.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
    if (k === 'r') race.reset();
    if (k === 'c') recentre = true;
    if (k === 'v') chaseToggle = true;
    // the arrows scroll the page otherwise, which in a game that uses them is
    // the page jumping about under the driver
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    held.add(k);
  });
  addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  // a window that loses focus mid-corner would otherwise keep turning forever
  addEventListener('blur', () => held.clear());

  const down = (...keys: string[]) => keys.some((k) => held.has(k));
  return {
    /** True once, for the frame the camera should be framed again. */
    takeRecentre() { const r = recentre; recentre = false; return r; },
    /** True once, for the frame the camera should change where it stands. */
    takeChaseToggle() { const c = chaseToggle; chaseToggle = false; return c; },
    read(): Input {
      return {
        turn: (down('a', 'arrowleft') ? 1 : 0) - (down('d', 'arrowright') ? 1 : 0),
        throttle: down('w', 'arrowup') ? 1 : 0,
        brake: down('s', 'arrowdown') ? 1 : 0,
        handbrake: down(' '),
      };
    },
  };
}

const norm = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
