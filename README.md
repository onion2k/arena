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

The arena is 4.8 metres square, with twenty-four solid posts standing on a
five-by-five grid — only the very middle is left open. The posts are the only
thing you cannot drive through: the truck is pushed out of one and keeps the
part of its speed that was running along it, so sliding round one at full
tilt works and is the reason they are there. Shots stop against them. Enemies
flow round them.

The grid is what makes the place feel big. A larger empty floor just looks
like the same floor with the camera further back; what reads as size is a
thing whose size you know, repeating away into the distance, so the posts
stand in rows and the outer ring is half again as tall as the inner — that
difference is the cue that tells the eye it is looking at distance rather
than at a smaller object. The truck is 250mm long on a 4800mm floor: nineteen
of it end to end.

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
out and dies with the square of what is left, the muzzle carries one for about
fifty milliseconds, and the truck carries headlights, an exhaust glow and
brake lamps. A busy frame is around a hundred and fifty of them.

The hall itself is dark on purpose. The environment contributes 0.3 of what it
would, and the slow coloured wash that keeps an empty arena from being black
is barely a tint — everything you can see by is carried by something in the
fight. Lights are wide rather than bright: a point light is half its strength
900mm out rather than the renderer's default of 50, so a shot going past
lights a bay of the hall instead of putting a coin of glare under itself.

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
| empty arena | 20 | 2.00 |
| 80 enemies | 102 | 5.79 |
| 180 enemies | 149 | 7.97 |
| 300 enemies (the pool full) | 148 | 8.19 |
| 300 enemies, point lights off | — | 0.88 |
| 300 enemies, radius cull off | 148 | 23.12 |

Medians of five runs of 120 frames each; one run in five came back high,
which is why they are medians rather than firsts. The light count stops at
150 because only the first 128 enemies carry one — that cap is what makes the
last two rows the same, and it is the first thing a quality ladder would take
away.

So the point-light loop is 7.3 ms of the 8.2, about **0.049 ms a light** at
1080p. The additive effect stage still does not clear the noise. A frame at
sixty is 16.7 ms, so a full arena at its worst is under half of one.

The last row is the one that matters for wide lights. Every light now reaches
most of a metre, so far more of the screen is inside far more of them — and
the exact radius cull, one distance test that skips a light faded to nothing
anyway, is the difference between 8 ms and 23. It is not an approximation and
there is no reason ever to turn it off outside a measurement.

The CPU side is not the problem either: one `arena.step` with the pool of 300
full is **0.16 ms**. It is 0.56 ms if the shots and the crowd scan every enemy
instead of reading a grid of the floor — neither is near a frame's budget, but
the scan grows with the square of the crowd and the grid does not, so the grid
is there for the next size rather than for this one.

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
