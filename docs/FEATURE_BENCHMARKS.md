# Feature benchmarks (3-layer pyramid)

When changing a hot algorithm in WeedJS, measure at three layers. Do not jump straight to a real demo.

| Layer | What it measures | How | When |
|-------|------------------|-----|------|
| **L1 isolated** | Algorithm throughput (ops/s, ms/N) + correctness | `node tests/bench/<feature>-microbench.mjs` — no workers, fake SoA/SAB | Changed DDA / Dijkstra / query math / grid loop |
| **L2 intermediate** | Feature inside the engine (workers, real grid, SAB stats) on a synthetic scene | Playwright `run-integrated-worker-benchmark.mjs --scene /tests/bench/stressScenes/...` | Validate the win survives integration |
| **L3 demo** | Real gameplay load | `demos/scenes/` (Balls, Predator, …) | End-to-end regression only |

Always compare with the **same flags**, prefer `pnpm bench:headed:median` (≥5 runs), and check workload equivalence (entity count, casts/frame, `BODY_COUNT`).

L2 scenes live only under [`tests/bench/stressScenes/`](../tests/bench/stressScenes/). Demos stay in `demos/scenes/`.

Methodology for the integrated harness: [`tests/bench/BENCHMARK_METHODOLOGY.md`](../tests/bench/BENCHMARK_METHODOLOGY.md).

## Workflow

```text
baseline L1 → patch → L1
baseline L2 → patch → L2 (feature metric + STEP_MS, same workload)
pnpm test
L3 only if the change can affect real demo load / other workers
```

## Commands (Ray pilot — headless)

```bash
# L1 — isolated Ray DDA
pnpm bench:micro:ray
# knobs: --entities --rays --cell-size --seed --output

# L2 — RayStressScene (headless)
pnpm bench:feature:ray

# L3 — PredatorScene (headless), ray-relevant gate
pnpm bench:feature:ray:predator

# Hypothesis campaign (BASE + patches, headless L1/L2/L3)
node tests/bench/run-ray-hyp-campaign.mjs --only BASE,H1

# Tournament (singles → pairs → stacks)
pnpm bench:ray:tournament
```

See [`RAY_HYPOTHESES.md`](./RAY_HYPOTHESES.md) for H1–H6, tournament results, and champion **H6+H1** (merged).

## Catalog

| Feature | Hot module | L1 | L2 stress scene | L3 demo | Primary metric |
|---------|------------|----|-----------------|---------|----------------|
| Grid Ray (DDA) | `src/core/Ray.js` | `ray-microbench.mjs` | `stressScenes/RayStressScene` | Predator / bullets | L1 ops/s; L2 `logic` `RAYCAST_MS` |
| Spatial rebuild + neighbors | `spatial_worker.js`, `Grid.js` | (todo) | `stressScenes/StationarySpatialScene` | Balls | `NEIGHBOR_MS`, `REBUILD_MS` |
| Box2D step / sync | `weedjs_post.js` | semi (WASM) | Balls / BallsAndRectangles | Balls | `STEP_MS`, `BOX2D_MS`, `BODY_COUNT` |
| Box2D QueryAABB | `box2dQueryAabb.js` | semi | `demos/.../Box2dQueryAabbScene` | — | query / physics STEP |
| NavGrid Dijkstra / A* | `NavGrid.js`, particle_worker | (todo) | (todo) `NavStressScene` | car / bichos / Predator | ms/path |
| AngularSweep visibility | `AngularSweep.js` | (todo) | (todo) | Predator | ms/polygon |
| TileMap SAB queries | `TileMap.js` | (todo) | low value | tile demos | ns/`getTileId` |
| QuerySystem publish | `QuerySystem.js` | (todo) | `stressScenes/QueryChurnScene` | — | publish / churn |
| Pre-render cull + queue | `pre_render_worker` | partial | `stressScenes/RenderQueueStressScene` | Predator | `VISIBILITY_MS`, `VISIBLE_*` |
| DecorationsSpatial | `DecorationSpatial.js` | (todo) | (todo) | zenithal | `queryCircle` ms |
| Bullet tick + Ray | `BulletPool`, particle_worker | (todo) | can share RayStress | Predator | particle `STEP_MS` |
| Treiber free list / rings | `atomicFreeList`, rings | (todo) | (todo) spawn-storm | Balls spawn | pop/push/s |
| Particle integrate | particle_worker | (todo) | (todo) | zenithalParticleTest | `PARTICLE_PHYSICS_MS` |

Fill order after Ray: Spatial L1 → NavGrid L1+L2 → AngularSweep L1 → TileMap L1 → QuerySystem L1.

## L1 scaffold

Shared helpers: [`tests/bench/microbench-helpers.mjs`](../tests/bench/microbench-helpers.mjs) (`mulberry32`, `timeIt`, `writeReport`, `parseArgs`).

Microbenches import production `src/...` code (no algorithm copies). Run a correctness gate before timing.

## L2 stress scenes

| Scene | Path | Stresses |
|-------|------|----------|
| RayStressScene | `/tests/bench/stressScenes/RayStressScene.js` | Many deterministic raycasts/tick → `RAYCAST_MS` |
| StationarySpatialScene | `/tests/bench/stressScenes/StationarySpatialScene.js` | Stationary neighbor reuse |
| QueryChurnScene | `/tests/bench/stressScenes/QueryChurnScene.js` | Spawn/despawn + query publication |
| RenderQueueStressScene | `/tests/bench/stressScenes/RenderQueueStressScene.js` | Cull / Y-sort / render queue |

```bash
node tests/bench/run-integrated-worker-benchmark.mjs --headed \
  --scene /tests/bench/stressScenes/StationarySpatialScene.js \
  --scene-export StationarySpatialScene \
  --output tests/results/stationary-spatial-headed.json
```
