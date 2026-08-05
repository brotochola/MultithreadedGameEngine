# Ray optimization hypotheses

Falsifiable claims for speeding up [`src/core/Ray.js`](../src/core/Ray.js). Test **headless only** with the three-layer protocol below.

## Protocol (always headless)

| Layer | Command | Primary metric |
|-------|---------|----------------|
| **L1** | `pnpm bench:micro:ray` | `cases.*.opsPerSec`; exit 0 correctness |
| **L2** | `pnpm bench:feature:ray` (RayStressScene) | `logic.RAYCAST_MS` (`RAYCAST_COUNT` ~512) |
| **L3** | `pnpm bench:feature:ray:predator` | `logic.RAYCAST_MS` / `STEP_MS` |

Tournament (singles → pairs → stacks):

```bash
pnpm bench:ray:tournament
node tests/bench/run-ray-hyp-tournament.mjs --round 1 --runs 2 --warmup-ms 8000 --duration-ms 10000
node tests/bench/run-ray-hyp-tournament.mjs --round 2
node tests/bench/run-ray-hyp-tournament.mjs --round 3
```

Summaries: `tests/results/ray-hyps/tournament/round{1,2,3}-summary.json`, `tournament-leaderboard.json`.

**Accept (single)** if L1 correctness OK, target metric improves ≥3% median, non-target L1 not worse than −5%, workload ±5%.

**Accept (combo)** if better than BASE on L2 `RAYCAST_MS` and not >3% worse than best parent.

## Hypotheses

| ID | Claim | Change | Round1 |
|----|-------|--------|--------|
| **H1** | `castAll` full DDA + sort | Top-N + early-out | ACCEPT (override: LOS noise) |
| **H2** | First-hit multi-cell retest | Generation stamp | REJECT (no ≥3% win) |
| **H3** | Branchy cell scanner | Specialized loops | REJECT |
| **H4** | AABB slab slow | Local min/max compares | ACCEPT (L1 cast +3.9%) |
| **H5** | Circle `sqrt` early | Lower-bound reject | ACCEPT (L1 cast +4.0%) |
| **H6** | `castAll` `Set` cost | Stamp instead of Set | ACCEPT (castAll +85%, L2 −27%) |

Out of campaign: H7 DDA unify, H8 collider-only grid, H9 `castDir` call sites, H10 poly AABB, H11 segment prefilter.

### H12 (opened from tournament noise)

**Claim:** Apparent L1 `hasLineOfSight` regressions when applying H1 are measurement noise (H1 only touches `castAll`), not a real code path interaction. Future decision rules should require multi-run CV checks before rejecting on non-target LOS.

## Tournament outcome (2026-08-04)

Screening: `--runs 2`, warmup 8s, duration 10s, headless.

| Round | Result |
|-------|--------|
| 1 | Winners: **H6, H1, H4, H5** (H2/H3 reject) |
| 2 | Best pair by L2: **H6+H1** (−37% `RAYCAST_MS` vs BASE). Auto-reject on LOS noise overridden. H4/H5 pairs did not beat H6 alone. |
| 3 | Full stack H6+H1+H4+H5 rejected (LOS noise + no gain over H6+H1). |
| **Champion** | **H6+H1** (stamp dedup + castAll top-N early-out) |

### Merged into production

`src/core/Ray.js` now contains the H6+H1 champion.  
`tests/bench/ray-hyps/baseline_*.js` remain the **pre-opt** snapshots (for re-applying patches in experiments). Do not `restoreAll()` without re-applying the champion if you need production code.

Post-merge sanity: L1 correctness OK; L2 RayStress `logic` STEP_MS ~2.2 ms (was ~2.8 ms BASE in round1).

## Patch layout

- Baselines (pre-opt): [`tests/bench/ray-hyps/baseline_Ray.js`](../tests/bench/ray-hyps/baseline_Ray.js), `baseline_utils.js`
- Composable transforms: [`tests/bench/ray-hyps/hypPatches.mjs`](../tests/bench/ray-hyps/hypPatches.mjs) (`applyCombo`, `CANONICAL_ORDER = H2→H6→H1→H3→H4→H5`)
- Tournament runner: [`tests/bench/run-ray-hyp-tournament.mjs`](../tests/bench/run-ray-hyp-tournament.mjs)

## Related

- Feature pyramid: [`FEATURE_BENCHMARKS.md`](./FEATURE_BENCHMARKS.md)
- Ray API: [`RAYCASTING.md`](./RAYCASTING.md)
- Integrated methodology: [`../tests/bench/BENCHMARK_METHODOLOGY.md`](../tests/bench/BENCHMARK_METHODOLOGY.md)
