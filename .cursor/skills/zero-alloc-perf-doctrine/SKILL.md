---
name: zero-alloc-perf-doctrine
description: >-
  Enforces WeedJS perf doctrine: zero allocations in hot loops, no GC pressure,
  always test and benchmark new features, aim for the fastest 2D engine.
  Use when adding features, optimizing workers/hot paths, writing hyps, or when
  the user mentions GC, allocations, STEP_MS, hyp campaigns, or engine speed.
---

# Zero-alloc / always-benchmark doctrine

## Product bar (verbatim)

Keep features with **zero allocations in hot loops**, **no GC pressure**, **very very optimized**. Aim for the **fastest 2d engine on the planet**. Always **test and benchmark** new features.

## Hard rules

1. **Measure before claiming a win**
   - Local algorithm → L1 micro A/B first (`tests/bench/*-microbench.mjs`).
   - Worker / integration → L2 `pnpm test:bench` / headed median; never ship on FPS alone (60 Hz cap).
   - Prefer median / band over one noisy run.

2. **Hot-path bans** (per-entity / per-contact / per-particle / per-frame inner loops)
   - No `new`, object/array literals, `.map`/`.filter`/`.splice` that allocate.
   - No string keys for hot maps/sets; prefer bitpack ints, typed arrays, SoA.
   - Reuse scratch objects / ring buffers; grow capacity, do not allocate per tick.

3. **Hyp campaign shape**
   - One hyp at a time; smallest diff.
   - **Kill** if L1 opt/baseline ≥ 1, or L2 within noise, or workload not comparable (Awake / body-moved bands diverge).
   - Example kill: PRE-ANIM (cache lost to branch vs cheap div).

4. **Correctness gate**
   - After worker changes: `pnpm test:node`.
   - Render / lights / glow: headed screenshots + visual checklist in skill `benchmark-worker-optimization`.

5. **Patterns already in tree**
   - LOG-PAIR bitpack — `src/workers/logic_worker.js`
   - PAR-CAM frame camera cache — `src/workers/particle_worker.js`
   - PRE-HOT LightEmitter glow pass — `src/workers/pre_render_worker.js`

## Commands

```bash
pnpm bench:micro:hyp-wins
pnpm test:bench
pnpm test:bench:headed
pnpm bench:headed:median
pnpm test:node
```

Pyramid details: [`docs/FEATURE_BENCHMARKS.md`](docs/FEATURE_BENCHMARKS.md).  
Repo map: skill `weedjs-engine-map`.  
Worker STEP_MS A/B: skill `benchmark-worker-optimization`.
