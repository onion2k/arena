# Arena

A technical in an arena, on the game path of
[artshape-render](https://github.com/onion2k/artshape-render): drive it with
the keys, point the gun on the back with the mouse, and hold off the things
coming at you.

It exists to lean on the two things that path was built for — a great many
moving point lights, and materials shiny enough to show them — and to be the
first real consumer of `artshape-render/game`, which had never drawn a game
before this.

![the arena at wave nine](docs/arena.png)

## Running it

```bash
npm install && npm run dev
```

Needs a browser with WebGPU.

| | |
| --- | --- |
| **A** **D** or ← → | steer |
| **W** or ↑ | throttle, along wherever the truck is pointing |
| **S** or ↓ | brake |
| mouse | point the gun, which swings independently of the truck |
| **space** or **F** | fire (it auto-fires as well) |
| **X** | auto-fire on and off |
| **R** | restart |
| drag | swing the camera round |
| wheel | in, or out until the whole arena is in frame |
| **C** | put the camera back |

The truck drives the way an Asteroids ship flies: it carries momentum, drag
pulls it down over about a second, and its own velocity carries into the
shots it fires, so running away while shooting backwards gives slow bullets.
The walls are solid rather than a wrap — it keeps about half its speed off
one. The wheels roll by however far it went *along its own nose*, so a slide
sideways does not turn them and a skid looks like a skid.

The gun is not the truck. It slews toward wherever the mouse is pointing at
its own rate rather than snapping there, and driving one way while shooting
another is the whole point of the thing. The aim is only taken while no
button is down, so dragging the camera round does not haul the turret with
it.

The arena is 2.8 by 1.9 metres of modelled floor, with eight solid posts in
it. The posts are the only thing you cannot fly through: the ship is pushed
out of one and keeps the part of its speed that was going along it, so
sliding round a post at full tilt works and is the reason they are there.
Shots stop against them. Enemies flow round them.

The camera follows the ship, and how closely depends on how far out you are
zoomed. The renderer solves for the distance at which the whole arena is in
frame; at exactly that distance the camera stays dead centre, so nothing can
arrive unseen, and the leash lengthens in proportion as you zoom in until up
close it simply follows. That is one behaviour rather than a follow mode and
an overview mode — zooming all the way out *is* the overview. Drag swings it
round, **C** puts it back.

Solving for that distance is not a nicety: it was hardcoded at first, which
cropped the near corners on a narrow window, and in a game where enemies come
in from the edges that means dying to something that was never on screen.

The depth range is solved for too, every frame, from the same corners. The
camera class defaults to a far plane of four metres, which is ample for a
piece of jewellery on a table and is not for an arena 2.8 metres across seen
from three metres back — the far corners simply stop being drawn, with no
error and nothing else wrong with the frame.

## What it is doing

Every frame the light list is cleared and written again from scratch. A shot
carries a light, an enemy carries a light, an explosion carries one that opens
out and dies with the square of what is left, and the muzzle carries one for
about fifty milliseconds. A busy frame is around a hundred and thirty of them.

Nothing is kept between frames. The game renderer offers a `'keep'` mode that
draws the static half once and copies it back, and this demo does not use it:
a moving light relights the arena, so keeping the static frame and having
dynamic lights on static geometry are alternatives rather than an optimisation
you get for free. Redrawing everything costs about a millisecond and buys the
floor lighting up under each explosion.

All the geometry is generated. The arena floor, its tiles, its blocks and its
columns come out of the same parametric library the still-life renderer draws
jewellery with; so does the player, which is a brilliant-cut gem, and the
enemies, which are seven-pointed stars. There is no model file anywhere in the
project.

## What it costs

Measured on a Mac mini (M-series) at 1920×1080, fenced on the queue rather
than timed off `requestAnimationFrame` — a browser tab that is not being
composited stops calling back, and reads as a scene that mysteriously got
slower. `measure(width, height, frames)` is on the console for repeating it.

| scene | lights | ms a frame |
| --- | ---: | ---: |
| empty arena | 23 | 1.19 |
| 60 enemies | 83 | 2.62 |
| 140 enemies | 148 | 4.34 |
| 220 enemies (the pool full) | 151 | 4.53 |
| 220 enemies, point lights off | — | 0.42 |

Medians of five runs of 120 frames each; one run in five came back high,
which is why they are medians rather than firsts. The light count stops at
150 because only the first 128 enemies carry one — that cap is what makes the
last two rows the same, and it is the first thing a quality ladder would take
away.

So the point-light loop is 4.1 ms of the 4.5, about **0.026 ms a light** at
1080p, and the additive effect stage — up to a couple of hundred glows — does
not clear the noise. A frame at sixty is 16.7 ms, so a full arena is a bit over
a quarter of one — and that is with the truck's headlights, exhaust and brake
lamps in the count.

The CPU side is not the problem either: one `arena.step` with the pool full
is 0.147 ms, including the every-enemy-against-every-enemy separation, which
at 220 is forty-eight thousand distance tests a frame.

Do not read the frame rate in the corner as the cost of any of this. It is
wall-clock between `requestAnimationFrame` callbacks, and a tab the browser is
not compositing stops calling back — which shows up as a scene that
mysteriously got four times slower while the GPU was doing the same work.

The numbers are one machine's and every one of them is fill-bound, so a
laptop with an integrated GPU will read differently. The renderer's calibrator
and quality ladder exist for exactly that and this demo does not use them yet.

## Layout

| file | |
| --- | --- |
| `src/main.ts` | wiring: device, meshes, pools, the frame loop |
| `src/game.ts` | state, flight and rules. Knows nothing about the GPU |
| `src/scene.ts` | the parametric parts and where the static half stands |
| `src/lighting.ts` | the light list and the glow list, rebuilt every frame |
| `src/matrix.ts` | placements, and projecting a point to the screen |
