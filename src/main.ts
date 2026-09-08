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
import { Arena, MAX_BOLTS, MAX_ENEMIES, type Input } from './game';
import { ARENA_X, ARENA_Y, MESHES, arenaMatrices } from './scene';
import { hide, place, placeAxle, placeTipped, project } from './matrix';
import { EFFECT_CAPACITY, LIGHT_CAPACITY, effectsFor, lightsFor, setProjectionScale } from './lighting';

const FOV = 40;
/** Where the dynamic groups sit, in the order they are handed over. */
const CHASSIS = 0, CAB = 1, WHEELS = 2, TURRET = 3, BARREL = 4, DRONES = 5, BOLTS = 6;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const boot = document.getElementById('boot')!;
const bootMsg = document.getElementById('bootMsg')!;
const scorePanel = document.getElementById('score')!;
const statsPanel = document.getElementById('stats')!;
const helpPanel = document.getElementById('help')!;

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
    sunColour: [0.9, 0.86, 1.0],
    exposure: 1.05,
    // the environment lights the metal but is never drawn, so this is the
    // whole sky: near black, to leave the point lights all the contrast
    background: [0.004, 0.004, 0.007],
  };

  bootMsg.textContent = 'generating the arena…';
  // One frame's grace, so the message is painted before the geometry blocks
  // the thread. Raced against a timer because a tab that is not being
  // composited never calls back, and a loading screen that waits forever for
  // one is worse than no loading screen at all.
  await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 50); });

  const mesh = {
    floor: MESHES.floor(), tile: MESHES.tile(), block: MESHES.block(), column: MESHES.column(),
    chassis: MESHES.chassis(), cab: MESHES.cab(), wheel: MESHES.wheel(),
    turret: MESHES.turret(), barrel: MESHES.barrel(),
    drone: MESHES.drone(), bolt: MESHES.bolt(),
  };
  const at = arenaMatrices();

  renderer.setStatic([
    { mesh: mesh.floor, matrices: identity(), albedo: [0.052, 0.056, 0.072], roughness: 0.14 },
    { mesh: mesh.tile, matrices: at.tiles, albedo: [0.10, 0.11, 0.14], roughness: 0.24 },
    { mesh: mesh.block, matrices: at.blocks, albedo: [0.60, 0.63, 0.70], roughness: 0.26 },
    { mesh: mesh.column, matrices: at.columns, albedo: [0.78, 0.62, 0.35], roughness: 0.18 },
  ]);

  // The pools. Their size is fixed here and never changes again: what moves
  // each frame is the live count, and the matrices written into the prefix.
  const chassisM = new Float32Array(16);
  const cabM = new Float32Array(16);
  const wheelM = new Float32Array(4 * 16);
  const turretM = new Float32Array(16);
  const barrelM = new Float32Array(16);
  const droneM = new Float32Array(MAX_ENEMIES * 16);
  const boltM = new Float32Array(MAX_BOLTS * 16);
  const droneMat = new Float32Array(MAX_ENEMIES * 4);
  const dynamic: GameGroup[] = [
    // not a mirror: a polished metal under a near-black sky has nothing to
    // reflect and reads as a dark shape. A little roughness gives the point
    // lights a highlight wide enough to see the colour in.
    { mesh: mesh.chassis, matrices: chassisM, albedo: [1.0, 0.79, 0.36], roughness: 0.24 },
    { mesh: mesh.cab, matrices: cabM, albedo: [0.86, 0.90, 0.97], roughness: 0.12 },
    // tyres: dark and rough, the one thing in the arena that is not a mirror
    { mesh: mesh.wheel, matrices: wheelM, count: 4, albedo: [0.07, 0.07, 0.08], roughness: 0.62 },
    { mesh: mesh.turret, matrices: turretM, albedo: [0.74, 0.76, 0.82], roughness: 0.2 },
    { mesh: mesh.barrel, matrices: barrelM, albedo: [0.90, 0.92, 0.97], roughness: 0.1 },
    { mesh: mesh.drone, matrices: droneM, count: 0, albedo: [0.86, 0.17, 0.12], roughness: 0.27 },
    { mesh: mesh.bolt, matrices: boltM, count: 0, albedo: [0.38, 0.95, 1.0], roughness: 0.05 },
  ];
  renderer.setDynamic(dynamic);

  bootMsg.textContent = 'baking the environment…';
  const env = bakeEnvironment(ctx, 'dusk', { size: 128, mips: 6 });
  renderer.setEnvironment(env.specular, env.brdf, env.mips);

  renderer.camera.fov = FOV;
  setProjectionScale(FOV);

  const arena = new Arena();
  const lights = new LightPool(LIGHT_CAPACITY);
  const quads = new Float32Array(EFFECT_CAPACITY * EFFECT_STRIDE);
  const input = watchInput(arena, canvas);
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
      lights: lights.count, drones: arena.enemies, shots: arena.bolts,
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
  Object.assign(globalThis as Record<string, unknown>, { arena, renderer, orbit, input, measure, shoot });

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
    orbit.minDistance = fitted * 0.22;
    orbit.maxDistance = fitted;
    if (move) {
      // In closer than the fitted distance, so the ship reads: the whole
      // arena is what the wheel is for. Moved before the orbit adopts it,
      // because `setSpherical` eases and a view that drifts into place over
      // the first second of play looks like something is wrong.
      const t = renderer.camera.target;
      const pos = renderer.camera.position;
      renderer.camera.position = [
        t[0] + (pos[0] - t[0]) * START_ZOOM,
        t[1] + (pos[1] - t[1]) * START_ZOOM,
        t[2] + (pos[2] - t[2]) * START_ZOOM,
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
   * Where the camera looks: the ship, held inside the arena by however much
   * of the arena is off screen.
   *
   * `fitted` is by construction the distance at which the whole arena is in
   * frame, so at that distance the camera must stay dead centre and nothing
   * can come in unseen; from there the leash lengthens as you zoom in, in
   * proportion, until up close it simply follows. That is one behaviour
   * rather than a follow mode and a whole-arena mode, and zooming all the way
   * out is the whole-arena mode.
   */
  const aim: [number, number, number] = [0, 0, CAMERA_HEIGHT];
  const followShip = (dt: number) => {
    const slack = Math.max(0, 1 - orbit.distance / fitted);
    const wantX = clamp(arena.px, -ARENA_X * slack, ARENA_X * slack);
    const wantY = clamp(arena.py, -ARENA_Y * slack, ARENA_Y * slack);
    // eased, so a bounce off a wall does not snap the whole scene sideways
    const k = Math.min(1, dt * 3.4);
    aim[0] += (wantX - aim[0]) * k;
    aim[1] += (wantY - aim[1]) * k;
    renderer.camera.target = [aim[0], aim[1], aim[2]];
  };
  canvas.addEventListener('pointerdown', () => { touched = true; });
  canvas.addEventListener('wheel', () => { touched = true; }, { passive: true });

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
  for (const el of [scorePanel, statsPanel, helpPanel]) el.removeAttribute('hidden');
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
    // The truck, laid out in its own frame and turned into the world: the
    // body leans into a turn, the wheels roll with the distance covered along
    // the nose, and the turret and barrel answer to the gun rather than to
    // the truck. Five parts, but only two angles between them.
    const yaw = arena.pAngle;
    const cy = Math.cos(yaw); const sy = Math.sin(yaw);
    const wx = (lx: number, ly: number) => arena.px + lx * cy - ly * sy;
    const wy = (lx: number, ly: number) => arena.py + lx * sy + ly * cy;
    const lean = -arena.lastTurn * 0.17;

    placeTipped(chassisM, 0, wx(0, 0), wy(0, 0), 52, yaw, lean, 1);
    renderer.move(CHASSIS, chassisM, 1);
    placeTipped(cabM, 0, wx(62, 0), wy(62, 0), 92, yaw, lean, 1);
    renderer.move(CAB, cabM, 1);

    let w = 0;
    for (const lx of [88, -78]) {
      for (const ly of [-64, 64]) {
        placeAxle(wheelM, w++, wx(lx, ly), wy(lx, ly), 32, yaw, arena.wheelSpin);
      }
    }
    renderer.move(WHEELS, wheelM, 4);

    const gx = arena.gunX; const gy = arena.gunY;
    place(turretM, 0, gx, gy, 88, arena.aim, 1);
    renderer.move(TURRET, turretM, 1);
    // the barrel is modelled along its own z, so it is laid over a quarter
    // turn past the direction it is meant to point, as the bolts are
    placeTipped(barrelM, 0,
      gx + Math.cos(arena.aim) * 82, gy + Math.sin(arena.aim) * 82, 104,
      arena.aim + Math.PI / 2, Math.PI / 2, 1);
    renderer.move(BARREL, barrelM, 1);

    for (let i = 0; i < arena.enemies; i++) {
      placeTipped(droneM, i, arena.ex[i], arena.ey[i], 44 + Math.sin(arena.ephase[i] * 0.8) * 10,
        arena.ephase[i] * 0.9, Math.sin(arena.ephase[i] * 0.35) * 0.45);
      const flash = arena.eflash[i] > 0 ? arena.eflash[i] / 0.12 : 0;
      const o = i * 4;
      droneMat[o] = 0.86 + flash * 0.14;
      droneMat[o + 1] = 0.17 + flash * 0.8;
      droneMat[o + 2] = 0.12 + flash * 0.85;
      droneMat[o + 3] = 0.27 - flash * 0.2;
    }
    renderer.move(DRONES, droneM, arena.enemies);
    if (arena.enemies) renderer.tint(DRONES, droneMat);

    for (let i = 0; i < arena.bolts; i++) {
      // the bolt is modelled standing up, so it lies over and then turns a
      // quarter past its heading to point along it
      placeTipped(boltM, i, arena.bx[i], arena.by[i], 44,
        Math.atan2(arena.bvy[i], arena.bvx[i]) + Math.PI / 2, Math.PI / 2);
    }
    if (arena.bolts < MAX_BOLTS) hide(boltM, arena.bolts);
    renderer.move(BOLTS, boltM, arena.bolts);

    lightsFor(lights, arena, t);
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
    followShip(dt);
    orbit.update();
    setDepthRange(renderer.camera);
    arena.step(dt, input.read(renderer.camera));

    const effects = upload();

    // redraw, not keep: every one of those lights moves, and a kept static
    // half would be lit by where they were when it was baked
    renderer.frame(ctx.context.getCurrentTexture().createView(), 'redraw');

    smoothed += (dt * 1000 - smoothed) * 0.08;
    statsIn -= dt;
    if (statsIn <= 0) {
      statsIn = 0.2;
      scorePanel.innerHTML =
        `<b>${arena.score.toLocaleString()}</b><span class="lives">`
        + [0, 1, 2].map((i) => `<i class="${i < arena.lives ? '' : 'spent'}">◆</i>`).join('')
        + `</span> · wave <span>${arena.wave}</span>`;
      statsPanel.innerHTML =
        `<span>${smoothed.toFixed(1)}</span> ms · <span>${Math.round(1000 / smoothed)}</span> fps<br>`
        + `<span>${lights.count}</span> lights · <span>${effects}</span> glows<br>`
        + `<span>${arena.enemies}</span> drones · <span>${arena.bolts}</span> shots · <span>${arena.blasts.length}</span> blasts<br>`
        + `<span>${Math.round(arena.speed)}</span> speed · fire <span>${input.autofire ? 'auto' : 'held'}</span><br>`
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
 * Where the cursor lands on the floor the game is played on, in world
 * millimetres: a ray built from the camera's own axes, met with z = 0.
 * Built from the axes rather than by inverting the projection because the
 * camera turns and this stays four lines either way.
 */
function floorUnderCursor(cam: GameRenderer['camera'], mx: number, my: number): [number, number] {
  const u = mx * 2 - 1;
  const v = 1 - my * 2;
  const tan = Math.tan((cam.fov * Math.PI) / 360);
  const [px, py, pz] = cam.position;
  const f = norm([cam.target[0] - px, cam.target[1] - py, cam.target[2] - pz]);
  const r = cam.right;
  const up = cam.up;
  const dir = [
    f[0] + r[0] * u * tan * cam.aspect + up[0] * v * tan,
    f[1] + r[1] * u * tan * cam.aspect + up[1] * v * tan,
    f[2] + r[2] * u * tan * cam.aspect + up[2] * v * tan,
  ];
  // above the horizon there is no floor to hit; aim at the far edge instead
  if (dir[2] >= -1e-4) return [px + dir[0] * 4000, py + dir[1] * 4000];
  const t = -pz / dir[2];
  return [px + dir[0] * t, py + dir[1] * t];
}

/** Where the camera starts, as a fraction of the distance that fits the arena. */
const START_ZOOM = 0.46;
/** How high off the floor the camera looks. The fit solves for this exact
 *  point, so at full zoom-out the guarantee that everything is in frame holds. */
const CAMERA_HEIGHT = 55;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/**
 * The truck drives Asteroids-style off the keys; the gun is pointed with the
 * mouse. The mouse also swings the camera, so the aim is only taken while no
 * button is down — otherwise dragging the view round would haul the turret
 * with it.
 */
function watchInput(arena: Arena, canvas: HTMLCanvasElement) {
  const held = new Set<string>();
  let autofire = true;
  let recentre = false;
  let mx = 0.5; let my = 0.4;
  let seen = false;
  let dragging = false;

  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'r') arena.restart();
    if (k === 'x') autofire = !autofire;
    if (k === 'c') recentre = true;
    // the arrows and space scroll the page otherwise, which in a game that
    // uses both is the page jumping about under the player
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    held.add(k);
  });
  addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  // a window that loses focus mid-turn would otherwise keep turning forever
  addEventListener('blur', () => held.clear());

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mx = (e.clientX - r.left) / Math.max(1, r.width);
    my = (e.clientY - r.top) / Math.max(1, r.height);
    seen = true;
  });
  canvas.addEventListener('pointerdown', () => { dragging = true; });
  addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointercancel', () => { dragging = false; });

  const down = (...keys: string[]) => keys.some((k) => held.has(k));
  return {
    get autofire() { return autofire; },
    /** True once, for the frame the camera should be framed again. */
    takeRecentre() { const r = recentre; recentre = false; return r; },
    read(cam: GameRenderer['camera']): Input {
      return {
        turn: (down('a', 'arrowleft') ? 1 : 0) - (down('d', 'arrowright') ? 1 : 0),
        thrust: down('w', 'arrowup') ? 1 : 0,
        brake: down('s', 'arrowdown') ? 1 : 0,
        aimAt: seen && !dragging ? floorUnderCursor(cam, mx, my) : null,
        firing: autofire || down('f', ' '),
      };
    },
  };
}

const norm = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
