import test from 'node:test';
import assert from 'node:assert/strict';

import { contactSyncFraction } from '../../src/core/utils.js';

// 1D model of resolveCollisionsVerlet: equal-mass boxes stacked on a static floor.
// Screen coordinates, so gravity pulls toward +y and contact normals point up.
// The floor surface is y = 0 and every box has half-height HALF, so box k rests at
// y = -HALF * (2k + 1). Numbers match demos/scenes/OrientedBoxScene.js: gravity 0.55
// at dtRatio 0.2 (step displacement = dtRatio^2 * g), responseStrength 0.95, 5 substeps.
const HALF = 75;
const G_STEP = 0.2 * 0.2 * 0.55;
const DAMPING = 0.999;
const RESPONSE = 0.95;
const SLOP = 7.5 * 0.0375;
const SUB_STEPS = 5;

const restY = (k) => -HALF * (2 * k + 1);

function simulate({ y, sync, gravity = G_STEP, ticks, floor = true }) {
  const py = y.slice();
  const n = y.length;

  for (let t = 0; t < ticks; t++) {
    for (let k = 0; k < n; k++) {
      const prev = y[k];
      y[k] += (y[k] - py[k]) * DAMPING + gravity;
      py[k] = prev;
    }

    for (let s = 0; s < SUB_STEPS; s++) {
      if (floor) {
        const depthEff = y[0] + HALF - SLOP;
        if (depthEff > 0) {
          const correction = depthEff * RESPONSE;
          const frac = sync ? contactSyncFraction(-(y[0] - py[0]), correction) : 0;
          y[0] -= correction;
          py[0] -= correction * frac;
        }
      }

      // Equal masses, so each body takes half of the relative correction.
      for (let b = 1; b < n; b++) {
        const a = b - 1;
        const depthEff = y[b] - y[a] + 2 * HALF - SLOP;
        if (depthEff <= 0) continue;

        const correction = depthEff * RESPONSE;
        const half = correction * 0.5;
        const vn = -((y[b] - py[b]) - (y[a] - py[a]));
        const frac = sync ? contactSyncFraction(vn, correction) : 0;

        y[b] -= half;
        y[a] += half;
        py[b] -= half * frac;
        py[a] += half * frac;
      }
    }
  }

  const speed = y.map((v, k) => Math.abs(v - py[k]));
  return { y, speed };
}

test('boxes spawned overlapping separate without being launched', () => {
  // Painting boxes in OrientedBoxScene drops them straight on top of each other.
  // The solver then has a deep overlap to undo while both bodies sit still, which
  // is exactly the case where an unsynced correction turns into muzzle velocity.
  const overlap = 20;
  const start = () => [0, -2 * HALF + overlap];

  const synced = simulate({ y: start(), sync: true, gravity: 0, ticks: 60, floor: false });
  const unsynced = simulate({ y: start(), sync: false, gravity: 0, ticks: 60, floor: false });

  const syncedGap = synced.y[0] - synced.y[1] - 2 * HALF;
  assert.ok(Math.abs(syncedGap) < 1, `boxes should end up touching, gap=${syncedGap}`);
  assert.ok(
    synced.speed[0] < 0.01 && synced.speed[1] < 0.01,
    `boxes should end at rest, speeds=${synced.speed}`
  );

  // Guards the fix itself: with no sync the same overlap becomes kinetic energy.
  const unsyncedGap = unsynced.y[0] - unsynced.y[1] - 2 * HALF;
  assert.ok(unsyncedGap > 100, `unsynced boxes should visibly launch, gap=${unsyncedGap}`);
});

test('a resting stack settles near its rest pose', () => {
  const boxes = 4;
  const y = Array.from({ length: boxes }, (_, k) => restY(k));
  const settled = simulate({ y, sync: true, ticks: 600 });

  for (let k = 0; k < boxes; k++) {
    const sag = Math.abs(settled.y[k] - restY(k));
    // Sag accumulates per contact below the box. Each one may give up the slop the
    // solver deliberately leaves, plus about as much again to load compression.
    const budget = 2 * SLOP * (k + 1);
    assert.ok(sag < budget, `box ${k} sagged ${sag}, budget is ${budget}`);
    assert.ok(
      settled.speed[k] < G_STEP * 2,
      `box ${k} still moving at ${settled.speed[k]} after settling`
    );
  }
});

test('sync never fights a correction that cannot stop the approach', () => {
  // Deep stack: the body is falling faster than one contact can absorb, so the
  // leftover push has to travel up the stack instead of being cancelled.
  assert.equal(contactSyncFraction(-5, 1), 0);

  // Overshoot: cancel exactly the approach, nothing more.
  const frac = contactSyncFraction(-0.25, 1);
  assert.equal(frac, 0.75);
  assert.equal(-0.25 + 1 - frac * 1, 0);

  // Already separating: keep the existing velocity, do not add to it.
  assert.equal(contactSyncFraction(2, 1), 1);

  // Degenerate correction must not produce NaN.
  assert.equal(contactSyncFraction(-1, 0), 0);
  assert.equal(contactSyncFraction(1, 0), 0);
});
