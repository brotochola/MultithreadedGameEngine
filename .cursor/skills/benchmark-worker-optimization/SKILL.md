---
name: benchmark-worker-optimization
description: >-
  Measures physics, spatial, and other worker STEP_MS / Load% (and FPS) via the
  integrated worker benchmark (Playwright + BallsScene), compares JSON reports
  before/after code changes, and iterates safely. Use when optimizing physics
  host / weedjs_post, spatial hashing, spatial_worker, QuerySystem, Grid,
  collision broadphase, or when the user asks to benchmark workers, compare
  STEP_MS/Load% after a change, or run test:bench / integrated-worker-benchmark.
  Also use for headed Predator visual gates (canvas screenshots + agent PNG review).
---

# Benchmark-driven worker optimization (weed.js engine)

## Goal

Change **physics** or **spatial** / **renderer** code, then **verify impact** using the same scene and the same harness, without treating a single noisy run as truth. For render hyps, also gate on canvas screenshots (agent visual review).

## Harness (this repo)

- **Runner:** `node tests/bench/run-integrated-worker-benchmark.mjs` — `pnpm test:bench` (see `package.json`).
- **Page:** `tests/bench/integrated-worker-benchmark.html` — dynamic scene import; worker metrics from shared stat buffers (`tests/bench/workerBenchmarkMetrics.js`).
- **Output:** `tests/results/integrated-worker-benchmark.json` (override with `--output` or positional 4th arg).
- **L2 stress scenes:** `tests/bench/stressScenes/` (Ray, QueryChurn, StationarySpatial, RenderQueue) — see `docs/FEATURE_BENCHMARKS.md`.
- **L1 Ray:** `pnpm bench:micro:ray` → `tests/bench/ray-microbench.mjs`.
- **Predator helper:** `tests/results/_bench-helpers.mjs` → `runPredatorBench(name)` (headed + screenshots).

## Headless vs headed

- **Default:** `headless: true` — OK for CI; render/physics numbers will **not** match a normal Chrome demo (software GL, scheduling).
- **Local comparison to `demos/`:** run with **`--headed`** so numbers align with hardware-accelerated Chrome.

Always record `playwrightHeadless` from report `metadata` (or the flag used) when comparing runs.

## Screenshots (visual gate)

- Flag: `--screenshots` (optional dir). Default dir = sibling of output stem, e.g. `tests/results/predator-base-1/` for `--output …/predator-base-1.json`.
- Captures game `<canvas>` at: `01-post-warmup.png`, `02-mid-measure.png`, `03-end-measure.png`.
- Paths written to `metadata.screenshots` / `metadata.screenshotDir`.
- Phased page API: `prepare` → (warmup) → `beginMeasure` → (duration) → `collect`. Legacy `run()` still works without mid-run shots.
- Physics is **not** pixel-deterministic (seed exists; Box2D multithread still drifts). Agent compares structure, not identical pixels.

### Visual workflow (Predator / render hyps)

1. Capture **baseline** headed Predator ×2 (JSON + PNGs) before code change.
2. Change → headed ×2 again.
3. Agent **Read** baseline vs after PNGs (all three timestamps).
4. Compare JSON bands (`SPRITES_MS`, `STEP_MS`, `VISIBLE_*`, `DRAW_CALLS`, shadows).
5. **Fail hyp** if visual checklist fails even if STEP_MS improved.

### Agent visual checklist (non-deterministic OK)

- Canvas not black / not clear-color only
- Entity density roughly similar (not empty field, not one giant quad)
- Feet/ground contact plausible (no mass floating from bad anchor)
- Overlap order roughly Y-sensible in crowded clusters
- Atlas readable (not white squares / wrong UV strips)
- Lighting/shadows still present if baseline had them
- No obvious full-screen corruption

Ignore: exact entity positions, exact tree sway, micro pixel deltas.

## Workflow

1. **Baseline** — Run the benchmark **twice** with identical args; note `STEP_MS`, Load%, `physics`, `spatial0` / `spatial1`, `renderer`, and collision fields in JSON if useful. For render work, include `--screenshots`.
2. **Change** — Smallest diff for the hypothesis (broadphase, grid, queries, physics hot loop, allocations, sprite path).
3. **Verify** — Same benchmark command **twice** again.
4. **Compare** — Prefer a **band or median**, not one sample; watch **all** workers for regressions; Read PNGs when present.
5. **Correctness** — Run `pnpm test` (or project test script). Faster STEP_MS that breaks behavior is invalid.

## How to read the numbers

- **Primary:** `STEP_MS` (wall time of worker `update()` in `AbstractWorker`) and derived **Load%** = `(STEP_MS / frameBudgetMs) * 100` where `frameBudgetMs = 1000/60` (≈16.67 ms) unless `fixedFps > 0` then `1000/fixedFps`. Helper: `workerLoadPct` in `src/workers/workers-utils.js`.
- With BallsScene `noLimitFPS: false`, FPS ≈ 60 is expected — use STEP_MS / Load% to compare builds. Load >100% means over the 60 Hz budget.
- Do **not** use measured FPS as the Load% denominator (circular).
- Report **`averageFPS`** averages **sampled instantaneous** FPS over the window (secondary).
- Physics console also prints `BOX2D_MS` / Moved / Awake when present.

## CLI reference

| Flag | Purpose |
|------|---------|
| `--headed` | Launch Chromium with a visible window (closer to demo FPS). |
| `--allow-throttle` | Omit Chromium flags that reduce background/minimized/occluded-window throttling (default benchmark run applies mitigation). |
| `--canvas-width` / `--canvas-height` | Viewport/canvas size (defaults 1920×1080). |
| `--warmup-ms`, `--duration-ms`, `--sample-interval-ms` | Timing (also positional 1–3). |
| `--output` | JSON path (also positional 4). |
| `--screenshots` `[dir]` | Mid-run canvas PNGs (warmup / mid / end). Dir defaults beside output stem. |
| `--scene` / `--scene-export` | Scene module URL + export (default BallsScene). |

Example (headed, comparable to demos):

```bash
pnpm test:bench:headed
# or: pnpm test:bench -- --headed
```

Feature L2 (Ray stress scene):

```bash
pnpm bench:feature:ray
# L1 isolated: pnpm bench:micro:ray
```

Predator with screenshots:

```bash
node tests/bench/run-integrated-worker-benchmark.mjs --headed \
  --scene /demos/scenes/PredatorScene.js --scene-export PredatorScene \
  --output tests/results/predator-base-1.json --screenshots
```

Repeated runs + median (physics STEP_MS / Load% / FPS and `statsSamplesAverage` collision fields; prints mean, stdev, **CV**):

```bash
pnpm bench:headed:median
pnpm exec node tests/bench/run-headed-median.mjs --runs 7
```

Default warmup/duration are in `tests/bench/benchmarkDefaults.mjs` (long warmup after spawn pile-up). Methodology: [tests/bench/BENCHMARK_METHODOLOGY.md](tests/bench/BENCHMARK_METHODOLOGY.md).

Each worker in the benchmark JSON may include `statsEnd` and `statsSamplesAverage` for comparing work done, not only FPS. **Only compare STEP_MS / Load% across builds when `BODY_COUNT` is similar** (same workload). JSON shape unchanged — derive Load% when printing.

## Output summary template

- Mode: `metadata.playwrightHeadless` (false = headed)
- Command and key flags
- Screenshots: `metadata.screenshotDir` (if any)
- Baseline vs after: physics / spatial0 / spatial1 / renderer STEP_MS + Load% (avg or range); FPS secondary; visual checklist pass/fail
- Verdict: improved / regressed / noise / visual fail

## Key code touchpoints

- `src/box2d/physics_host.impl.js`, `src/box2d/weedjs_post.js`, `src/workers/spatial_worker.js`, `src/workers/AbstractWorker.js`
- `src/core/QuerySystem.js`, `src/core/Grid.js`, `demos/scenes/BallsScene.js`
- Render: `src/workers/pixi_worker.js`, `src/workers/pre_render_worker.js`

Keep changes scoped to the task.
