---
name: benchmark-worker-optimization
description: >-
  Measures physics, spatial, and other worker STEP_MS / Load% (and FPS) via the
  integrated worker benchmark (Playwright + BallsScene), compares JSON reports
  before/after code changes, and iterates safely. Use when optimizing physics
  host / weedjs_post, spatial hashing, spatial_worker, QuerySystem, Grid,
  collision broadphase, or when the user asks to benchmark workers, compare
  STEP_MS/Load% after a change, or run test:bench / integrated-worker-benchmark.
---

# Benchmark-driven worker optimization (weed.js engine)

## Goal

Change **physics** or **spatial** code (or related query/grid paths), then **verify impact** using the same scene and the same harness, without treating a single noisy run as truth.

## Harness (this repo)

- **Runner:** `node tests/bench/run-integrated-worker-benchmark.mjs` — `pnpm test:bench` (see `package.json`).
- **Page:** `tests/bench/integrated-worker-benchmark.html` — loads **BallsScene** only; worker metrics from shared stat buffers (`tests/bench/workerBenchmarkMetrics.js`).
- **Output:** `tests/results/integrated-worker-benchmark.json` (override with `--output` or positional 4th arg).

## Headless vs headed

- **Default:** `headless: true` — OK for CI; render/physics numbers will **not** match a normal Chrome demo (software GL, scheduling).
- **Local comparison to `demos/`:** run with **`--headed`** so numbers align with hardware-accelerated Chrome.

Always record `playwrightHeadless` from report `metadata` (or the flag used) when comparing runs.

## Workflow

1. **Baseline** — Run the benchmark **twice** with identical args; note `STEP_MS`, Load%, `physics`, `spatial0` / `spatial1`, `renderer`, and collision fields in JSON if useful.
2. **Change** — Smallest diff for the hypothesis (broadphase, grid, queries, physics hot loop, allocations).
3. **Verify** — Same benchmark command **twice** again.
4. **Compare** — Prefer a **band or median**, not one sample; watch **all** workers for regressions.
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

Example (headed, comparable to demos):

```bash
pnpm test:bench:headed
# or: pnpm test:bench -- --headed
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
- Baseline vs after: physics / spatial0 / spatial1 / renderer STEP_MS + Load% (avg or range); FPS secondary
- Verdict: improved / regressed / noise

## Key code touchpoints

- `src/box2d/physics_host.impl.js`, `src/box2d/weedjs_post.js`, `src/workers/spatial_worker.js`, `src/workers/AbstractWorker.js`
- `src/core/QuerySystem.js`, `src/core/Grid.js`, `demos/scenes/BallsScene.js`

Keep changes scoped to the task.
