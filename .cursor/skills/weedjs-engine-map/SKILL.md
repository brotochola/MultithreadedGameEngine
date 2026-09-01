---
name: weedjs-engine-map
description: >-
  Locates WeedJS multithread engine paths: workers, SoA components, Box2D WASM
  host, demos, and bench pyramid. Use when navigating the repo, asking where a
  worker/component/demo lives, wiring physics/spatial/particle/pre_render, or
  finding L1/L2 benchmark entry points.
---

# WeedJS engine map

## Layout

- **Workers:** [`src/workers/`](src/workers/) — `logic_worker.js`, `spatial_worker.js`, `particle_worker.js`, `pre_render_worker.js`, `pixi_worker.js`, `AbstractWorker.js`
- **Physics host / Box2D 3 WASM:** [`src/box2d/`](src/box2d/) — `weedjs_post.js`, `physics_host.impl.js`, `box2d_wasm.*`, rings/queries; see [`src/box2d/README.md`](src/box2d/README.md)
- **SoA components:** [`src/components/`](src/components/)
- **Core utils:** [`src/core/utils.js`](src/core/utils.js) (`cantorPair`, `calculateCameraScreenBounds`, …)
- **Demos:** [`demos/`](demos/)
  - **Balls** — stable physics load (prefer for physics/spatial STEP_MS A/B)
  - **Predator** — lights, logic, particles, high Awake variance (prefer for render/logic; match Awake when comparing physics)

## Bench pyramid

Doc: [`docs/FEATURE_BENCHMARKS.md`](docs/FEATURE_BENCHMARKS.md)

| Layer | Where |
|-------|--------|
| L1 micro | [`tests/bench/*-microbench.mjs`](tests/bench/), helpers [`microbench-helpers.mjs`](tests/bench/microbench-helpers.mjs) |
| L2 integrated | [`tests/bench/run-integrated-worker-benchmark.mjs`](tests/bench/run-integrated-worker-benchmark.mjs), stress scenes [`tests/bench/stressScenes/`](tests/bench/stressScenes/) |
| Results | [`tests/results/`](tests/results/) |

Hyp-win L1 micros (kernel A/B): `log-pair-microbench.mjs`, `par-cam-microbench.mjs`, `pre-anim-microbench.mjs`, `pre-hot-microbench.mjs`, orchestrator `run-hyp-wins-microbenches.mjs` → `pnpm bench:micro:hyp-wins`.

## Scripts (common)

- `pnpm test:node` — node unit tests
- `pnpm test:bench` / `pnpm test:bench:headed` — integrated worker bench
- `pnpm bench:headed:median` — multi-run median
- `pnpm bench:micro:hyp-wins` — LOG-PAIR / PAR-CAM / PRE-ANIM / PRE-HOT micros

## STEP_MS worker A/B

Use project skill **`benchmark-worker-optimization`** (headed vs headless, screenshots, Load%).

## Shipped hot-path opts (examples)

- **LOG-PAIR** — bitpack contact keys in `logic_worker.js`
- **PAR-CAM** — `_frameCameraBounds()` in `particle_worker.js`
- **PRE-HOT** — LightEmitter glow pass in `pre_render_worker.js`
- **PRE-ANIM** — killed (L1 cache slower than div)
