import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import {
  createCommandRingSab,
  bindCommandRing,
  enqueueSetVelocity,
  drainCommandRing,
} from '../../src/box2d/box2dCommandRing.js';

const __filename = fileURLToPath(import.meta.url);

if (!isMainThread) {
  const { sab, count, entityBase } = workerData;
  bindCommandRing(sab);
  let ok = 0;
  for (let i = 0; i < count; i++) {
    if (enqueueSetVelocity(entityBase + i, i, -i)) ok++;
  }
  parentPort.postMessage({ ok });
} else {
  test('command ring MPSC: multi-writer no lost slots under capacity', async () => {
    const writers = 4;
    const perWriter = 200;
    const capacity = writers * perWriter;
    const sab = createCommandRingSab(capacity);
    const i32 = new Int32Array(sab);
    const f32 = new Float32Array(sab);

    const workers = [];
    for (let w = 0; w < writers; w++) {
      workers.push(
        new Worker(__filename, {
          workerData: { sab, count: perWriter, entityBase: w * 10000 },
        }),
      );
    }
    const results = await Promise.all(
      workers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            worker.on('message', resolve);
            worker.on('error', reject);
            worker.on('exit', (code) => {
              if (code !== 0) reject(new Error(`worker exit ${code}`));
            });
          }),
      ),
    );
    const enqueued = results.reduce((sum, r) => sum + r.ok, 0);
    assert.equal(enqueued, capacity);
    assert.equal(Atomics.load(i32, 3), 0);

    const seen = new Set();
    let drained = 0;
    drained += drainCommandRing(i32, f32, {
      setVelocity(entity, vx, vy) {
        assert.equal(vy, -vx);
        assert.ok(!seen.has(entity), `dup entity ${entity}`);
        seen.add(entity);
      },
    });
    // Drain may need a second pass if publish races with first drain start — single consumer after join is enough.
    assert.equal(drained, capacity);
    assert.equal(seen.size, capacity);
  });

  test('command ring MPSC: overflow increments and drain stays consistent', () => {
    const capacity = 64; // createCommandRingSab floors at 64
    const sab = createCommandRingSab(capacity);
    bindCommandRing(sab);
    const i32 = new Int32Array(sab);
    let ok = 0;
    for (let i = 0; i < capacity + 20; i++) {
      if (enqueueSetVelocity(i, 1, 2)) ok++;
    }
    assert.equal(ok, capacity);
    assert.ok(Atomics.load(i32, 3) >= 20);

    let n = 0;
    drainCommandRing(i32, f32View(sab), {
      setVelocity() {
        n++;
      },
    });
    assert.equal(n, capacity);

    ok = 0;
    for (let i = 0; i < capacity; i++) {
      if (enqueueSetVelocity(1000 + i, 3, 4)) ok++;
    }
    assert.equal(ok, capacity);
  });
}

function f32View(sab) {
  return new Float32Array(sab);
}
