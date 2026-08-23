# LiquidFun particle-step optimization hypotheses

Falsifiable claims for speeding up `lfParticleSystem_Step` — the sibling
`box2d_3.0_wasm_sab` repo's [`box2d+liquidfun/src/lf_particle_system.c`](../../box2d_3.0_wasm_sab/box2d+liquidfun/src/lf_particle_system.c),
wired into this repo via [`src/box2d/wasm_wrapper.c`](../../box2d_3.0_wasm_sab/box2d/src/wasm_wrapper.c)
→ [`src/box2d/physics-api.js`](../src/box2d/physics-api.js) → [`src/box2d/weedjs_post.js`](../src/box2d/weedjs_post.js).
Same protocol family as [`PARTICLE_HYPOTHESES.md`](./PARTICLE_HYPOTHESES.md) /
[`RAY_HYPOTHESES.md`](./RAY_HYPOTHESES.md) (Wave family in
[`FEATURE_HYP_PROGRAM.md`](./FEATURE_HYP_PROGRAM.md)), adapted: no L1 microbench yet
(the hot loop is C, not JS — L1 would mean a native demo harness in the sibling
repo, not attempted here), so this campaign is **L2 + correctness gate only**.

## Protocol

| Layer | Command | Primary metric |
|-------|---------|-----------------|
| **Correctness** | `node --test tests/node/liquidfun.test.js tests/node/liquidfun.wasm.test.js` (then full `npm test`) | All pass — a faster `STEP_MS` that breaks physics is invalid |
| **L2** | `pnpm bench:feature:liquidfun` (`LiquidFunStressScene` — 5k water + 1k `SPRING\|STATIC_PRESSURE`), **2 runs per point** | `physics.BOX2D_MS` (== `lfParticleSystem_Step` cost; `BODY_COUNT` is 3 static floors, negligible) |
| **L3** | `demos/liquidFunDemoScene` (manual) | Visual: still stable, no explosions/tunneling |

Every C change: edit sibling repo → `build_for_weed.bat` (incremental, ~10-15s once configured) → copies `box2d_wasm.js`/`.wasm` into `src/box2d/` → correctness gate → L2 ×2 → record here → stop for manual sanity check before the next hypothesis.

**Caveat (known going in):** the harness measures steady-state `STEP_MS` after warmup. One-time creation-time costs (`CapturePairs`'s O(n²) group pairing) happen *during* warmup and won't move this number even if the code-level fix is real.

## Baseline

`LiquidFunStressScene` as originally authored (`strictContactCheck: true`), headless, 2 runs:

| Run | `BOX2D_MS` | Load% |
|-----|-----------|-------|
| 1 | 3.290 | 20% |
| 2 | 3.309 | 20% |

## Hypotheses

| ID | Claim | Change | Status |
|----|-------|--------|--------|
| **H1** | `create_particle_system` hardcodes `strictContactCheck=true`; liquidfun-c/Google's own default is `false` | Thread `physics.liquidFun.strictContactCheck` through config → command ring → wasm export; default `false` | **Done** |
| **H2** | `Integrate`/`SolveGravity`/`LimitVelocity` are scalar loops despite `-msimd128 -msse2` already being compile flags (auto-vectorization only, no intrinsics) | Explicit SSE2/wasm128 intrinsics (`<emmintrin.h>`, same technique `contact_solver.c` uses on this target) + `memset` for zero-fill loops | Next |
| **H3** | Every particle's grid cell `(ix,iy)` is recomputed via `floorf`+multiply in `FindParticleContacts`, `ForEachParticleNearShape`, and `SolveBarrier`'s inner loop, on top of the one computed in `BuildGrid` | Cache `cellX`/`cellY` arrays, filled once in `BuildGrid`, read everywhere else | Planned |
| **H4** | `FindBodyContacts` and `SolveCollision` each run their own `b2World_OverlapAABB` broad-phase query per substep | Swept-cloud AABB is a proven superset of the static-cloud AABB (same padding) — one shared query feeds both passes | Planned |
| **H5** | `RemoveSpuriousBodyContacts` uses `qsort` (indirect comparator calls) for runs capped at 3 kept contacts per particle | Insertion sort | Planned |
| **H6** | `CapturePairs` (SPRING/BARRIER group creation) is an O(n²) double loop over the new particle range | Route through the existing grid (3×3 neighborhood scan), same technique as `FindParticleContacts` | Planned |
| **H7** | `SolveStaticPressure`'s 8-iteration Poisson loop re-filters the *entire* `particleContacts` array every iteration by flag | Compact the qualifying-contact index list once, iterate that 8× | Planned |
| **H8** | `syncLiquidFunParticlesToSharedBuffers` (JS) scalar-loops the interleaved→deinterleaved position copy every frame | Deinterleave in C once (tight loop over contiguous `b2Vec2`), JS does two bulk `.set()` calls | Planned |

## Results log

### H1 — `strictContactCheck` configurable, default `false` (2026-08-23)

Landed across `ConfigDefaults.js`, `utils.js`, `physics_host.impl.js` (both merge copies),
`weedjs_post.js`, `box2dCommandRing.impl.js`, `LiquidFunSystem.js`, `physics-api.js`,
`wasm_wrapper.c`. Correctness: 17/17 liquidfun tests, 168/168 full suite (including the
existing floor+wall-corner test, which still holds with `strictContactCheck=false` —
no regression).

`LiquidFunStressScene` kept `strictContactCheck: true` explicitly (matches old hardcoded
behavior), so L2 is expected neutral — confirmed:

| Run | `BOX2D_MS` | Load% |
|-----|-----------|-------|
| 1 | 3.417 | 21% |
| 2 | 3.260 | 20% |

**Verdict: neutral as predicted** (this scene always exercised the strict path either
way — the actual effect is every *other* scene now defaulting to the cheaper path).

### Side experiment — `strictContactCheck` on vs off, same scene (2026-08-23)

Scene manually flipped to `strictContactCheck: false` to isolate the flag's own cost
on this workload (5k water + 1k spring/staticPressure, `BODY_COUNT` 3):

| strictContactCheck | Run 1 `BOX2D_MS` | Run 2 `BOX2D_MS` | Avg |
|---------------------|------------------|------------------|-----|
| `true` (H1 above) | 3.417 | 3.260 | 3.339 |
| `false` | 3.391 | 3.120 | 3.256 |

**Verdict: inconclusive at this scale.** ~2.5% delta, but the full sample set so far
(baseline + H1 + this) spans `BOX2D_MS` 3.120-3.417 — a ~9% band on a scene that hasn't
changed at all between some of those runs. `RemoveSpuriousBodyContacts`'s qsort is real
work (H5 will still land), but on this scene's contact counts it's inside headless-Chromium
run-to-run noise, not yet a measurable win/cost. Revisit with a scene that has denser
body-contact clusters (more particles resting against corners) if a cleaner signal is
needed later.

### H2 — Explicit SIMD for Integrate/SolveGravity/LimitVelocity (2026-08-23)

Added `#if defined(__SSE2__) #include <emmintrin.h> #endif` (same technique
`contact_solver.c` uses for `B2_SIMD_SSE2` on `B2_CPU_WASM`; native non-SSE2 builds
keep the original scalar loops). `Integrate`/`SolveGravity` flatten the contiguous
`b2Vec2` arrays to `float*` and process 4 floats/iteration (2 particles) uniformly;
`LimitVelocity` processes 2 particles/iteration with a shuffle-based per-particle
`speedSqr`, computing both the scaled and unscaled result unconditionally and
selecting with a bitwise blend (masked-out `Inf` from a stationary particle's `/0`
never reaches the result — `AND` with an all-zero mask is exactly zero regardless
of the other operand's bit pattern). Also replaced the `weight`/`accumulation2`
zero-fill loops with `memset` (0.0f is an all-zero bit pattern). Correctness:
17/17 liquidfun tests pass, including the 10k-particle smoke test and the
single-particle-rest test (most sensitive to `LimitVelocity`/`Integrate`).

Benchmarked against the same `strictContactCheck: false` scene state as the side
experiment above (so this is an apples-to-apples before/after):

| | Run 1 `BOX2D_MS` | Run 2 `BOX2D_MS` | Avg |
|---|------------------|------------------|-----|
| Before (strictContactCheck=false, no SIMD) | 3.391 | 3.120 | 3.256 |
| After (H2 SIMD) | 3.123 | 3.026 | 3.075 |

**Verdict: improved, ~5.6%** (3.256ms → 3.075ms). Real but modest, as expected —
`Integrate`/`SolveGravity`/`LimitVelocity` are only 3 of ~15 passes in the step, and
the contact-driven passes (unchanged, still scalar) dominate total cost. Confidence
caveat: only 2 runs per point on a noise band we've seen span ~3.02-3.42ms across
this whole campaign so far; both "after" samples land at the low end of every prior
sample set, which is suggestive but not a tight statistical claim — rerun with
`pnpm bench:headed:median` (or more `--runs`) before treating 5.6% as precise.

**Follow-up simplification (same day):** dropped the `#if defined(LF_HAS_SSE2) ... #else <scalar duplicate> #endif` branching — single compiler/toolchain (Emscripten `-msimd128 -msse2`, always on for this build), so the scalar fallback was dead code nobody would ever compile. Replaced with a single `#if !defined(__SSE2__) #error ... #endif` guard at the top of the file: if the flag is ever missing, the build fails loudly instead of silently going scalar. Pure refactor (same SIMD instructions execute either way) — rebuilt, 17/17 tests still pass, no new benchmark needed.

## Related

- Feature pyramid: [`FEATURE_HYP_PROGRAM.md`](./FEATURE_HYP_PROGRAM.md), [`FEATURE_BENCHMARKS.md`](./FEATURE_BENCHMARKS.md)
- Sibling campaigns: [`PARTICLE_HYPOTHESES.md`](./PARTICLE_HYPOTHESES.md), [`RAY_HYPOTHESES.md`](./RAY_HYPOTHESES.md), [`DECAL_HYPOTHESES.md`](./DECAL_HYPOTHESES.md)
- LiquidFun architecture/algorithm docs: [`LIQUIDFUN.md`](./LIQUIDFUN.md)
- Sibling repo roadmap: `box2d_3.0_wasm_sab/box2d+liquidfun/ROADMAP.md`
- L2 scene: [`tests/bench/stressScenes/LiquidFunStressScene.js`](../tests/bench/stressScenes/LiquidFunStressScene.js)
