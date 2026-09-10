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
import { FIELD, Race, type Input } from './game';
import { WHEELS } from './vehicle';
import { START_BULBS, TRACK_HALF, centreline, gantry, tangentAt } from './track';
import { height as groundAt } from './terrain';
import { ARENA_X, ARENA_Y, LAMP_ACROSS, LAMP_AHEAD, LAMP_HEIGHT, MESHES, arenaMatrices } from './scene';
import { placeOnSlope, placeVehicleFacing, placeVehiclePart, placeVehicleWheel, project } from './matrix';
import { EFFECT_CAPACITY, LIGHT_CAPACITY, effectsFor, lightsFor, setProjectionScale } from './lighting';

const FOV = 40;
/** Where the dynamic groups sit, in the order they are handed over. */
const CHASSIS = 0, CAB = 1, WHEELS_GROUP = 2, LAMPS = 3, START_LAMPS = 4;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const boot = document.getElementById('boot')!;
const bootMsg = document.getElementById('bootMsg')!;
const scorePanel = document.getElementById('score')!;
const statsPanel = document.getElementById('stats')!;
const helpPanel = document.getElementById('help')!;
const mapPanel = document.getElementById('map')!;
const mapSvg = document.getElementById('mapSvg') as unknown as SVGSVGElement;

main().catch((err) => { bootMsg.textContent = String(err?.message ?? err); console.error(err); });

async function main() {
  const ctx = await createContext(canvas);
  bootMsg.textContent = 'compiling shaders…';

  const renderer = new GameRenderer(ctx, LIGHT_CAPACITY, EFFECT_CAPACITY);
  renderer.look = {
    ...renderer.look,
    // low and warm, so the sun picks out the tops of things and leaves the
    // floor for the point lights to do
    sunDir: [0.34, 0.52, 0.78],
    // Nearly off. The sun is a directional light that reaches every surface
    // in the arena and `ambient` does not touch it, so at any real strength
    // it lays a sheet of highlight across the floor and there is no dark for
    // a beam to cut. What is left is enough to keep the posts from being
    // flat black cutouts.
    // Cold. It is the only thing lighting the ground away from the circuit,
    // and the floods are warm, so making it moonlight rather than grey is
    // what puts the arena at night instead of in an unlit room: the track is
    // a warm ribbon through cold ground, and the two read apart at a glance.
    sunColour: [0.040, 0.052, 0.092],
    exposure: 1.05,
    // Half brightness at 900mm rather than the library's 50. The arena is
    // 4800 across; at fifty a light was a coin of brightness under whatever
    // carried it and the floor a metre away never knew it existed. At nine
    // hundred a passing shot lights a bay of the hall.
    falloffHalf: 900,
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

  bootMsg.textContent = 'generating the arena…';
  // One frame's grace, so the message is painted before the geometry blocks
  // the thread. Raced against a timer because a tab that is not being
  // composited never calls back, and a loading screen that waits forever for
  // one is worse than no loading screen at all.
  await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 50); });

  const mesh = {
    floor: MESHES.floor(), tile: MESHES.tile(), block: MESHES.block(),
    kerbA: MESHES.kerbA(), kerbB: MESHES.kerbB(),
    pole: MESHES.pole(), arm: MESHES.arm(), head: MESHES.head(),
    chassis: MESHES.chassis(), cab: MESHES.cab(), wheel: MESHES.wheel(),
    lamp: MESHES.lamp(), gantry: MESHES.gantry(),
  };
  const at = arenaMatrices();

  renderer.setStatic([
    // The ground. It was glossier than the tarmac at 0.14, which meant every
    // ridge on it answered the trackside floods with a specular streak and
    // the arena read as corrugated iron — the bumps you could see were mostly
    // highlights rather than shape. Rough and cold now: it takes the light
    // and does not throw it back, so what you see of the ground is its form.
    { mesh: mesh.floor, matrices: identity(), albedo: [0.042, 0.048, 0.066], roughness: 0.62 },
    // Tarmac. Roughness is what darkens it, not the colour: albedo here is
    // the Fresnel base, and at the grazing angles a camera following a car
    // looks along a road at, Fresnel goes to one whatever that base is. So
    // dropping the colour from 0.135 to 0.062 changed almost nothing, and
    // taking the roughness from 0.34 to 0.85 — asphalt rather than wet
    // asphalt — is what stopped the road out-shining the cars on it.
    { mesh: mesh.tile, matrices: at.tiles, albedo: [0.058, 0.062, 0.072], roughness: 0.85 },
    // The kerbs: red and off-white blocks, matte enough to read as paint at
    // any angle. They are the only saturated colour in the arena, and they
    // are on the one thing the driver has to see.
    { mesh: mesh.kerbA, matrices: at.tiles, albedo: [0.62, 0.075, 0.055], roughness: 0.55 },
    { mesh: mesh.kerbB, matrices: at.tiles, albedo: [0.80, 0.80, 0.82], roughness: 0.55 },
    { mesh: mesh.block, matrices: at.blocks, albedo: [0.58, 0.61, 0.68], roughness: 0.26 },
    // The lamp posts. Pole and arm are a dark painted metal that the beam
    // never falls on — a street light stands outside its own pool — and the
    // head is near white and glossy, so what you see of a post at a distance
    // is the lamp and not the mast.
    { mesh: mesh.pole, matrices: at.poles, albedo: [0.30, 0.30, 0.33], roughness: 0.42 },
    { mesh: mesh.arm, matrices: at.arms, albedo: [0.30, 0.30, 0.33], roughness: 0.42 },
    { mesh: mesh.head, matrices: at.heads, albedo: [0.93, 0.92, 0.86], roughness: 0.14 },
    { mesh: mesh.gantry, matrices: gantryPosts(), count: 2, albedo: [0.62, 0.64, 0.70], roughness: 0.25 },
  ]);

  // The pools. Their size is fixed here and never changes again: what moves
  // each frame is the live count, and the matrices written into the prefix.
  const chassisM = new Float32Array(FIELD * 16);
  const chassisMat = new Float32Array(FIELD * 4);
  const cabM = new Float32Array(FIELD * 16);
  const wheelM = new Float32Array(FIELD * 4 * 16);
  const lampM = new Float32Array(FIELD * 2 * 16);
  const startMat = new Float32Array(2 * START_BULBS * 4);
  const dynamic: GameGroup[] = [
    // not a mirror: a polished metal under a near-black sky has nothing to
    // reflect and reads as a dark shape. A little roughness gives the point
    // lights a highlight wide enough to see the colour in.
    { mesh: mesh.chassis, matrices: chassisM, count: FIELD, albedo: [1.0, 0.79, 0.36], roughness: 0.24 },
    { mesh: mesh.cab, matrices: cabM, count: FIELD, albedo: [0.86, 0.90, 0.97], roughness: 0.12 },
    // tyres: dark and rough, the one thing out here that is not a mirror
    { mesh: mesh.wheel, matrices: wheelM, count: FIELD * 4, albedo: [0.07, 0.07, 0.08], roughness: 0.62 },
    // near white and glossy, so the lamps read as lit glass rather than as
    // two more lumps of the same metal the truck is made of
    { mesh: mesh.lamp, matrices: lampM, count: FIELD * 2, albedo: [1.0, 0.97, 0.9], roughness: 0.06 },
    // the starting bulbs, which never move and are recoloured every frame
    { mesh: mesh.lamp, matrices: startBulbs(), count: 2 * START_BULBS, albedo: [0.2, 0.04, 0.03], roughness: 0.12 },
  ];
  renderer.setDynamic(dynamic);

  bootMsg.textContent = 'baking the environment…';
  const env = bakeEnvironment(ctx, 'dusk', { size: 128, mips: 6 });
  renderer.setEnvironment(env.specular, env.brdf, env.mips);

  renderer.camera.fov = FOV;
  setProjectionScale(FOV);

  const arena = new Race();
  const lights = new LightPool(LIGHT_CAPACITY);
  const quads = new Float32Array(EFFECT_CAPACITY * EFFECT_STRIDE);
  const input = watchInput(arena);
  const minimap = buildMinimap(arena);
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
  const shoot = async (w = 1600, h = 900) => {
    canvas.width = w; canvas.height = h;
    renderer.resize(w, h);
    if (!touched) reframe(true, w / h);
    // the orbit eases toward where it was sent, and a capture does not have
    // a hundred frames to get there
    followShip(1);
    orbit.update();
    setDepthRange(renderer.camera);
    upload();
    renderer.frame(ctx.context.getCurrentTexture().createView(), 'redraw');
    await ctx.queue.onSubmittedWorkDone();
    const png = canvas.toDataURL('image/png');
    await fetch('/__shot', { method: 'POST', body: png });
    return png.length;
  };
  Object.assign(globalThis as Record<string, unknown>, { arena, renderer, orbit, input, lights, measure, shoot });

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
    const t = arena.truck;
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
    const wantX = t.x + t.vx * lead;
    const wantY = t.y + t.vy * lead;
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

  /**
   * Everything the GPU needs for the state the arena is in: where each thing
   * is, what colour it is, what is lighting it, and what is glowing over the
   * top. The frame loop calls it, and so does `shoot` — a capture that only
   * drew would draw whatever the loop last uploaded, which on a paused tab is
   * an empty arena lit by a full set of lights.
   */
  const upload = (): number => {
    // Every car in the field, from the body its own physics is carrying.
    // Nothing here decides where anything is: the chassis takes the body's
    // three angles, each wheel takes its own suspension travel and steer and
    // roll, and the lamps ride the same frame. A wheel drawn anywhere but
    // where the ray found the ground is a wheel you can see floating.
    arena.cars.forEach((car, ci) => {
      const truck = car.vehicle;
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

      const chassis = on(0, 0, 0);
      placeVehiclePart(chassisM, ci, chassis[0], chassis[1], chassis[2], yaw, pitch, roll);
      chassisMat.set([...car.colour, 0.24], ci * 4);
      const cab = on(62, 0, 40);
      placeVehiclePart(cabM, ci, cab[0], cab[1], cab[2], yaw, pitch, roll);

      for (let i = 0; i < WHEELS.length; i++) {
        const [lx, ly, lz] = WHEELS[i];
        const w = truck.wheels[i];
        const hub = on(lx, ly, lz - w.drop);
        placeVehicleWheel(wheelM, ci * 4 + i, hub[0], hub[1], hub[2], yaw, pitch, roll, w.steer, w.spin);
      }

      let lamp = 0;
      for (const ly of [-LAMP_ACROSS, LAMP_ACROSS]) {
        const at = on(LAMP_AHEAD, ly, LAMP_HEIGHT - 52);
        // facing, not wheeled: a lamp looks along the nose where a wheel
        // turns about an axle across it
        placeVehicleFacing(lampM, ci * 2 + lamp++, at[0], at[1], at[2], yaw, pitch, roll);
      }
    });
    renderer.move(CHASSIS, chassisM, FIELD);
    renderer.tint(CHASSIS, chassisMat);
    renderer.move(CAB, cabM, FIELD);
    renderer.move(WHEELS_GROUP, wheelM, FIELD * 4);
    renderer.move(LAMPS, lampM, FIELD * 2);

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
    renderer.setLights(lights);
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
        let d = (arena.truck.yaw + Math.PI) - now;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        chaseAzimuth = now + d;
        orbit.setSpherical({ azimuth: chaseAzimuth, polar: CHASE_POLAR, radius: CHASE_DISTANCE });
      }
      touched = true;
    }
    followShip(dt);
    orbit.update();
    setDepthRange(renderer.camera);
    arena.step(dt, input.read());

    const effects = upload();

    // redraw, not keep: every one of those lights moves, and a kept static
    // half would be lit by where they were when it was baked
    renderer.frame(ctx.context.getCurrentTexture().createView(), 'redraw');

    minimap.update();

    smoothed += (dt * 1000 - smoothed) * 0.08;
    statsIn -= dt;
    if (statsIn <= 0) {
      statsIn = 0.2;
      scorePanel.innerHTML =
        `<b>${arena.running ? clock(arena.lapTime) : Math.ceil(arena.countdown) + '…'}</b>`
        + `P<span>${arena.position}</span> of ${FIELD}`
        + ` · lap <span>${arena.laps + 1}</span>`
        + ` · best <span>${arena.bestLap === null ? '—:——.—' : clock(arena.bestLap)}</span>`
        + ` · last <span>${arena.lastLap === null ? '—:——.—' : clock(arena.lastLap)}</span>`;
      statsPanel.innerHTML =
        `<span>${smoothed.toFixed(1)}</span> ms · <span>${Math.round(1000 / smoothed)}</span> fps<br>`
        + `<span>${lights.count}</span> lights · <span>${effects}</span> glows<br>`
        + `<span>${Math.round(arena.speed)}</span> speed`
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
/** The eight corners of the box everything in the arena stands inside. */
const ARENA_CORNERS: [number, number, number][] = [];
for (const x of [-ARENA_X, ARENA_X]) {
  for (const y of [-ARENA_Y, ARENA_Y]) {
    for (const z of [0, 380]) ARENA_CORNERS.push([x, y, z]);
  }
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
  for (const c of ARENA_CORNERS) {
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
  const corners = ARENA_CORNERS;
  cam.aspect = aspect;
  cam.target = target;
  let lo = 500, hi = 6000;
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

  const road = document.createElementNS(NS, 'path');
  road.setAttribute('d', path);
  road.setAttribute('fill', 'none');
  road.setAttribute('stroke', '#4a4c58');
  road.setAttribute('stroke-width', String(TRACK_HALF * 2));
  road.setAttribute('stroke-linejoin', 'round');
  mapSvg.appendChild(road);

  // the start line, across the road at the top of the lap
  const [sx, sy] = centreline(-Math.PI);
  const [tx, ty] = tangentAt(-Math.PI);
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('x1', String(sx + ty * TRACK_HALF));
  line.setAttribute('y1', String(-(sy - tx * TRACK_HALF)));
  line.setAttribute('x2', String(sx - ty * TRACK_HALF));
  line.setAttribute('y2', String(-(sy + tx * TRACK_HALF)));
  line.setAttribute('stroke', '#e6e4f0');
  line.setAttribute('stroke-width', '120');
  mapSvg.appendChild(line);

  const dots = race.cars.map((car, i) => {
    const c = document.createElementNS(NS, 'circle');
    const [r, g, b] = car.colour;
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
    update() {
      race.cars.forEach((car, i) => {
        dots[i].setAttribute('cx', car.vehicle.x.toFixed(0));
        dots[i].setAttribute('cy', (-car.vehicle.y).toFixed(0));
      });
    },
  };
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
 * The keys, and nothing else: the mouse belongs entirely to the camera now
 * that there is no gun to aim.
 */
function watchInput(race: Race) {
  const held = new Set<string>();
  let recentre = false;
  let chaseToggle = false;

  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
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
