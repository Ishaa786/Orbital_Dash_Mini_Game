# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Orbital Dash" — a small single-page browser arcade game (Flappy-Bird-style dodging, reskinned as an alien scout ship crossing an asteroid belt). Plain HTML/CSS/JS only: no build tools, no package manager, no dependencies, no backend, no external assets (audio is synthesized live via the Web Audio API, graphics are drawn with Canvas primitives).

## Running / testing

There is no build step and no test suite. To try changes:

```
python3 -m http.server 8000
```

then open `http://localhost:8000/index.html`. Opening `index.html` directly via `file://` also works for normal play, but blocks some browser devtools/automation from rendering the canvas correctly — prefer a local static server when verifying changes with a browser tool.

There is no linter configured; match the existing code style (no semicolonless style, 2-space indent, no framework idioms).

## Files

Only three files, and they should stay that way — do not introduce a bundler, framework, or extra assets unless explicitly asked:

- `index.html` — DOM shell: the `<canvas>`, the mute/fire buttons, and the start/game-over overlay screens.
- `style.css` — layout, overlay/button styling, start-screen theming.
- `game.js` — everything else, as a single IIFE with no exports/modules.

## Architecture (game.js)

**State machine** — a single `state` string drives both `update()` and `render()`: `START -> PLAYING -> DYING -> GAMEOVER`, with `DYING` a fixed-length (`DEATH_DURATION`) ship-destruction animation between a fatal asteroid collision and the game-over screen. `loop()` calls `update()` only in `PLAYING`/`DYING`, then always calls `render()`, via `requestAnimationFrame`.

**Physics** — no gravity. The ship coasts at constant velocity; `thrustUp()`/`thrustDown()` add a fixed increment to `shipVY` (capped at `MAX_VY`), so repeated presses in one direction compound and the ship keeps drifting that way until thrust is applied the other way. The ship's x position is fixed (`SHIP_X`); asteroids/collectibles scroll left at `speed`, which ramps up with score.

**Asteroids** — three visual shapes (`circle`/`cluster`/`shard`), each with its own crater/sub-shape generation, drawn with a shared radial-gradient `shadedFill()`. Size buckets are small/medium/large (`rollSmallRadius`/`rollMediumRadius`/`rollLargeRadius`, tier resolved by `asteroidTier()`). The laser does not one-shot medium/large rocks: `shrinkAsteroid()` mutates an asteroid in place to the next tier down (regenerating its shape/craters/collisionRadius) rather than destroying it, so large asteroids take 3 hits, medium take 2, small take 1.

**Collectibles** — star pickups (`makeCollectible`/`spawnCollectible`) with an inverse size/value relationship (bigger = easier to hit = fewer points); occasionally spawned adjacent to an existing asteroid to force a risk/reward choice.

**Ship death** — `startShipDeath()` switches to `DYING`, spawns a large explosion plus procedural debris fragments (`shipDebris`), and freezes all other game objects until `endGame()` fires after `DEATH_DURATION` frames.

**Speech bubbles** — `showSpeech()` drives a single timed bubble drawn near the ship, triggered by star pickups, dodging a large asteroid, or a periodic ambient-line timer (`AMBIENT_LINES`); event-triggered lines can interrupt ambient ones but not vice versa.

**Audio** — fully synthesized, no audio files: oscillators/noise buffers built from scratch in `initAudio()` and the `play*Sound()` functions (background arpeggio, thruster burst, coin chime, asteroid/ship explosions, coasting ambience). `initAudio()` is only called from `resetState()` (i.e. on Start/Restart click) so it runs inside a user gesture per browser autoplay rules.

**Persistence** — `localStorage` only, two keys: `orbitalDashHighScore` and `orbitalDashMuted`.

**Tuning** — nearly every gameplay constant (speeds, thresholds, cooldowns, score values, spawn spacing) is declared at the top of `game.js`; that's the place to adjust game feel rather than editing logic inline.

**Input** — keyboard (`Arrow/WASD` thrust, `Space` fire) plus canvas tap/click split top-half/bottom-half for thrust and a dedicated `#fire-btn` for the laser (mobile has no spacebar). `canvasPointerY()` rescales pointer coordinates from CSS size to the canvas's fixed internal 400x600 resolution — reuse it for any new pointer-position logic rather than reading `clientY` directly.
