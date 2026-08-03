# Spatial hashing & neighbor queries

This document describes the **spatial worker** pipeline: row-partitioned grid rebuild, neighbor discovery, shared buffers, and performance-oriented details (caching, `entityPosData`, static/sleeping rules).

Implementation: `src/workers/spatial_worker.js`, `src/core/Grid.js`. High-level worker map: [Workers architecture](./WORKERS_ARCHITECTURE.md). Physics consumption of neighbors: [Physics pipeline](./PHYSICS.md).

---

## Why row-based partitioning

Multiple spatial workers cooperate on one logical grid **without** double-buffering the grid or neighbor arrays:

- Each worker **owns** a set of **grid rows** (derived from `rowsPerBlock` and `totalSpatialWorkers`).
- A worker may **read** any cell; it **writes** only cells in its owned rows and neighbor rows for entities it is responsible for.
- **No locks** on the grid: ownership guarantees non-overlapping writes.

This trades **strict global consistency** for **one-frame eventual consistency** on cells owned by other workers, which is acceptable for neighbor queries when combined with distance checks and active flags.

---

## Per-frame flow

1. **Rebuild owned rows** (`rebuildOwnedRows`)
   - Clear **local** cell counts (not the shared grid mid-frame).
   - Insert entities that overlap owned rows into the grid.
   - Copy local counts into the shared `gridBuffer` so readers never see a half-cleared grid.
   - Update a shared per-cell version when an owned cell's membership count/hash changes.

2. **Find neighbors** (`findNeighborsForOwnedEntities`)
   - For each entity whose **home row** falls in an owned row, gather neighbor candidates using precomputed **circle patterns** over grid cells.
   - When `neighborReuseSkin > 0`, search at `visualRange + 2·skin`, cache the expanded candidate list, and **always** re-filter into published `neighborData` at exact `visualRange`.
   - Reuse the candidate list (and skip the cell walk) when A is still within skin of the build position, vr/extent match, and list age is below `neighborReuseMaxFrames`.
   - Write filtered `neighborData` for that entity.

---

## `neighborData` layout

Per entity `i`, layout is a fixed stride (see `Grid.neighborStride` / `Grid._stride`):

| Offset | Field |
|--------|--------|
| `i * stride + 0` | `totalCount` — total neighbors stored |
| `i * stride + 1 + k` | Neighbor entity index |

Visual-range neighbors only. Physics contacts come from Box2D, not this buffer.

- **Lights / shadows:** entities with `LightEmitter` use the same `neighborData` lists as point-shadow casters. Soft shadow alpha fades with distance vs `Collider.visualRange` so shadows die at the rim before the neighbor list drops them.

---

## `entityPosData` (interleaved cache)

**Layout:** `Float32Array`, **4 floats per entity**: `[x, y, halfExtent, pad]`.

- **`x`, `y`:** World position used for neighbor distance checks (collider position: `Transform` + collider offset).
- **`halfExtent`:** Radius for circles, or max half-width/half-height for boxes when collider is active; used for range tests.

**When it is written:** During grid rebuild, when the entity touches at least one **owned row**, the worker writes this entity’s slot **once** (`wroteEntityPos` flag). That avoids redundant shared writes for workers that never own any of the entity’s rows.

**When it is read:** During neighbor search on the **same worker** in the same frame, after rebuild — so the data used for pairwise distance is the freshly written cache for entities this worker updated, and linear reads improve cache locality vs scattering across `Transform` + `Collider` arrays.

**Important:** Code that runs on **other** workers or **before** the owning spatial pass must **not** treat `entityPosData` as authoritative for game logic. The file header in `spatial_worker.js` states that **home row** determination for ownership uses **Transform** (and related) as source of truth, not `entityPosData` read from another worker.

---

## Circle patterns and neighbor-cell cache

- For each cell radius `0 .. _maxCellRadius` (default supports large visual ranges relative to `cellSize`), an **`Int32Array`** pattern `[dr, dc, dr, dc, ...]` lists cell offsets to visit.
- Patterns are stored in a **fixed array** indexed by radius (not a `Map`) for fast access.
- Pattern lengths are cached in a **`Uint16Array`**.

**Neighbor cell list cache (`_cellNeighborCache`):**

- Key: `cellIndex * (maxCellRadius + 1) + clampedRadius`
- Value: `Uint16Array` of neighbor **cell indices**
- **Bounded size:** when the map reaches **8192** entries, it is **cleared** to cap memory in long-running scenes. After a clear, cache misses regenerate arrays (performance hint only, not correctness).

## Neighbor reuse

Verlet-style reuse (controlled by `spatial.neighborReuseSkin` / `neighborReuseMaxFrames`):

- **`skin = visualRange · neighborReuseSkin`**. With skin > 0, a miss rebuilds an expanded **candidate** list at `searchRange = visualRange + 2·skin` (capped by `maxNeighbors`). Truncated lists never reuse until a non-truncated rebuild.
- Every frame (hit or miss) the worker **re-filters** candidates into published `neighborData` with the exact `visualRange` distance test, so the published set tracks current positions of A and B within the candidate envelope.
- **Hit** (reuse): A is within skin of its build position, half-extent and visual range unchanged, and frames since build `< neighborReuseMaxFrames`. The cell walk is skipped; only the cheap filter runs. Increments `NEIGHBORS_REUSED`.
- **`neighborReuseSkin: 0`**: no candidate reuse — full rebuild every frame at exact `visualRange` (baseline).

`neighborReuseMaxFrames` bounds how long neighbors B can drift while A stays inside the skin before a forced rebuild. If skin > 0 and maxFrames is unset/`0`, the worker falls back to **15**.

---

## Sleeping bodies (visual neighbors)

Spatial neighbor lists are **visual-range only**. Static/sleeping pairs are not filtered out of `neighborData` for collision anymore — Box2D owns contacts and sleep. Cell sleeping still skips rebuild work when every entity in a cell is sleeping or static (see particle / Box2D sleep ownership).

---

## Worker stats

Spatial workers write into `spatialStats` (multi-worker layout). Relevant keys from `SPATIAL_STATS` in `workers-utils.js`:

| Key | Meaning |
|-----|--------|
| `STEP_MS` | Full spatial step time (ms) |
| `NEIGHBOR_CHECKS` | Neighbor-related work counter (as defined in worker) |
| `GRID_CELLS_CHECKED` | Cells examined |
| `ENTITIES_PROCESSED` | Entities processed in spatial pass |
| `REBUILD_MS` | Time in grid rebuild (ms) |
| `NEIGHBOR_MS` | Time in neighbor search (ms) |
| `MSG_MS` | Message handling time this frame (ms) |
| `NEIGHBORS_REUSED` | Entities that skipped the cell walk this frame (candidate filter only) |

---

## Configuration touchpoints

- **`cellSize`, grid dimensions** — from scene `gridMetadata` (see `Scene` / config defaults).
- **`maxNeighbors`** — bounds stride and buffer sizes (`totalEntityCount * (1 + maxNeighbors) * 2` bytes). Default is **128**; dense flocks may need 512–1024 via scene `spatial.maxNeighbors`. Must stay consistent across `Grid` initialization.
- **`neighborReuseSkin`** — fraction of `visualRange` (default **0.04**). `0` disables Verlet reuse.
- **`neighborReuseMaxFrames`** — max frames to keep a candidate list (default **15**). Dense/fast scenes may override; e.g. Predator uses **0.01 / 30**.

---

## Local scratch buffers

The spatial worker keeps **pre-allocated** scratch space (e.g. local cell counts, deduplication markers) to avoid per-frame allocations in hot paths. Sizes tie to `globalEntityCount` and `maxNeighbors`.
