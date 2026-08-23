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
| **L1 (added for H6)** | `pnpm bench:micro:liquidfun-capturepairs` ([`tests/bench/liquidfun-capturepairs-microbench.mjs`](../tests/bench/liquidfun-capturepairs-microbench.mjs)) | Wall-clock ms for one large SPRING-group `create_particle_group_box` call — the only way to see create-time-only wins the L2 steady-state window can't |
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
| **H5** | `RemoveSpuriousBodyContacts` uses `qsort` (indirect comparator calls) for runs capped at 3 kept contacts per particle | Insertion sort | **Rejected** (see log — the "≤3" cap is post-filter, not the sorted array size) |
| **H6** | `CapturePairs` (SPRING/BARRIER group creation) is an O(n²) double loop over the new particle range | Route through a scratch grid over just the new range | **Done** |
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

### H3 — Cache per-particle grid cell (2026-08-23)

Added `int* cellX; int* cellY;` to `lfParticleSystem` (allocated alongside `next` in
both the pinned and growable paths, freed in `Destroy`). Filled once in `BuildGrid`
where `GetCell` was already being called for insertion. Replaced the redundant
`GetCell(sys, sys->position[i], ...)` recomputation in `FindParticleContacts`'s outer
loop, the hash-collision re-check in `ForEachParticleNearShape`, and the candidate
check in `SolveBarrier`'s inner grid walk with plain array reads. Pure scratch — no
sync needed with `SolveZombie`'s swap-with-last, since `BuildGrid` unconditionally
overwrites `cellX`/`cellY` for every live index before anything reads them each
sub-step. Correctness: 17/17.

| | Run 1 `BOX2D_MS` | Run 2 `BOX2D_MS` | Avg |
|---|------------------|------------------|-----|
| Before (H2 SIMD) | 3.123 | 3.026 | 3.075 |
| After (H3 cell cache) | 3.018 | 2.956 | 2.987 |

**Verdict: improved, ~2.9%.** Smaller than H2 as expected (saves one `floorf`+multiply
recompute per particle per lookup site, a constant-factor trim, not an algorithmic
change) — both samples land below both H2 samples, a consistent direction even if
modest in absolute terms.

### H4 — Share one broad-phase query between FindBodyContacts/SolveCollision (2026-08-23)

Hoisted `CollectOverlappingShapes(sys, ComputeSweptCloudAABB(sys, subDt, sys->diameter))`
out of both `FindBodyContacts` and `SolveCollision` into `lfParticleSystem_Step`'s
sub-step loop, called once between `FindParticleContacts` and `FindBodyContacts`; both
functions now just walk the already-populated `sys->queryShapes`. Removed the now-dead
`ComputeParticleCloudAABB` (only caller was `FindBodyContacts`'s own query). Safe:
nothing between the hoisted call and `SolveCollision` touches `queryShapes`/`queryShapeCount`,
and Box2D's broad-phase tree is static for the whole LiquidFun step (rebuilt only by
`b2World_Step`, which already finished for this frame). Correctness: 17/17, including
the wall-corner and thick-box-tunneling tests (both exercise `SolveCollision`'s raycast
against the shared list).

| | Run 1 `BOX2D_MS` | Run 2 `BOX2D_MS` | Avg |
|---|------------------|------------------|-----|
| Before (H3 cell cache) | 3.018 | 2.956 | 2.987 |
| After (H4 shared query) | 2.989 | 2.894 | 2.942 |

**Verdict: improved, ~1.5% — smaller than expected, likely scene-limited.** This
benchmark scene only has 3 static shapes (floor + 2 walls), so Box2D's dynamic-tree
`b2World_OverlapAABB` traversal was already cheap regardless of the query AABB's size —
removing one such query per sub-step saves real work, just not much of it *here*. The
win should scale with shape count (tree depth/traversal cost), not particle count; a
scene with dozens/hundreds of static platform shapes would show this more clearly. Not
re-testing that here — noting it as a known benchmark-scene limitation rather than
inflating the claim.

### H5 — Insertion sort instead of qsort — REJECTED (2026-08-23)

Flawed premise, caught by measurement rather than assumed away: the doc comment
"keep ≤3 per particle" describes `RemoveSpuriousBodyContacts`'s *output* after
filtering, not the size of the array `qsort`/insertion-sort actually runs on —
that's `sys->bodyContactCount`, every live body contact *before* the per-particle
cap. For a puddle settled on a wide floor, that's not a handful of elements; it's
roughly one entry per particle resting within `diameter` of a shape, easily in the
hundreds-to-low-thousands for this scene. O(n²) insertion sort loses to `qsort`'s
O(n log n) at that size.

Methodology: flipped the scene's `strictContactCheck` to `true` (temporarily — it's
`false` by default since H1, so this path doesn't run otherwise), benchmarked qsort
as "before", swapped in insertion sort, benchmarked "after", same build/scene
otherwise identical (H2/H3/H4 already landed under both):

| | Run 1 `BOX2D_MS` | Run 2 `BOX2D_MS` | Avg |
|---|------------------|------------------|-----|
| Before (qsort) | 3.387 | 3.458 | 3.423 |
| After (insertion sort) | 3.353 | 3.536 | 3.445 |

**Verdict: rejected, ~0.6% worse** (not dramatic — this scene's contact count is
apparently large enough to hurt insertion sort but not catastrophically so — but
consistently worse across both paired samples, not just noise in one direction).
Reverted to `qsort` + `BodyContactCompare`, exact original code. Correctness
re-confirmed 17/17 after the revert. Scene's `strictContactCheck` set back to
`false` (its state before this hypothesis needed it on). No `BOX2D_MS` change
versus H4's baseline since this is a clean revert.

This is the point of running a falsifiable campaign instead of assuming every
"obviously smaller-constant-factor" swap is a win — `qsort` (`stdlib.h`) was
already the right tool for a list whose size isn't actually bounded small.

### H6 — CapturePairs via a scratch grid instead of O(n²) (2026-08-23)

**Methodology problem hit first:** `CapturePairs` only runs once at SPRING/BARRIER
group creation, which happens during a scene's `create()`/warmup — before
`bench:feature:liquidfun`'s measured window starts. The L2 harness structurally
cannot see this win (flagged as a known caveat before starting this campaign).
Added a new **L1 microbench**, [`tests/bench/liquidfun-capturepairs-microbench.mjs`](../tests/bench/liquidfun-capturepairs-microbench.mjs)
(`pnpm bench:micro:liquidfun-capturepairs`), filling the "no L1 yet" gap noted in
this doc's intro — times one `create_particle_group_box` call (SPRING flag) in
isolation via the raw WASM export, same instantiation pattern as
`liquidfun.wasm.test.js`.

**Change:** pre-existing particles are never pair candidates (only the new
`[start, start+n)` range pairs with itself), so build a scratch grid over just
that range, reusing the same `cellHead`/`next`/`cellX`/`cellY` buffers the
per-step `BuildGrid` uses (safe to clobber — group creation always happens
before that frame's `b2World_Step`/`lfParticleSystem_Step`, and nothing reads
grid state until the next real `BuildGrid` rebuilds it in full). One correctness
subtlety caught before shipping: `CapturePairs`'s capture radius is `1.5x
diameter`, which *exceeds* one cell (`cellSize == diameter`) — a 3×3
neighborhood (the technique `FindParticleContacts` uses, which relies on
`searchRadius <= cellSize`) is **not** geometrically sufficient here; needed a
5×5 (±2 cells) sweep instead. Also added an explicit `cellX[j]==ix+dx &&
cellY[j]==iy+dy` check (mirroring `ForEachParticleNearShape`'s defensive
pattern) to rule out hash-collision double-counting a pair, now that H3's
`cellX`/`cellY` cache makes that check nearly free.

Correctness: 17/17, including the BARRIER test (which exercises `CapturePairs`
via the `BARRIER` flag, same `LF_PAIR_CAPTURE_FLAGS` gate as `SPRING`).

L1 (SPRING group, 4066 particles, `--half-w 800 --half-h 280`, median of 11 reps):

| | Median | Min | Max |
|---|--------|-----|-----|
| Before (O(n²)) | 10.556 ms | 10.519 ms | 10.636 ms |
| After (grid, O(n)) | 2.639 ms | 2.066 ms | 2.693 ms |

**Verdict: improved, ~75% (4x) for a 4066-particle group** — a clean, textbook
O(n²)→O(n) win, exactly what H5's rejection was a reminder to actually verify
rather than assume. L2 regression check (same scene, unrelated to this group,
just confirming no steady-state cost): `BOX2D_MS` 3.054/3.122 (avg 3.088) — within
the noise band already established for this scene, no regression.

## Related

- Feature pyramid: [`FEATURE_HYP_PROGRAM.md`](./FEATURE_HYP_PROGRAM.md), [`FEATURE_BENCHMARKS.md`](./FEATURE_BENCHMARKS.md)
- Sibling campaigns: [`PARTICLE_HYPOTHESES.md`](./PARTICLE_HYPOTHESES.md), [`RAY_HYPOTHESES.md`](./RAY_HYPOTHESES.md), [`DECAL_HYPOTHESES.md`](./DECAL_HYPOTHESES.md)
- LiquidFun architecture/algorithm docs: [`LIQUIDFUN.md`](./LIQUIDFUN.md)
- Sibling repo roadmap: `box2d_3.0_wasm_sab/box2d+liquidfun/ROADMAP.md`
- L2 scene: [`tests/bench/stressScenes/LiquidFunStressScene.js`](../tests/bench/stressScenes/LiquidFunStressScene.js)
