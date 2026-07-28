import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createContactRingSab,
  bindContactRing,
  publishContactEvent,
  drainContactRing,
  initialContactCursor,
  BOX2D_CONTACT_KIND,
} from '../../src/box2d/box2dContactRing.js';

test('contact ring: ordered publish and drain with generations', () => {
  const sab = createContactRingSab(256);
  bindContactRing(sab);
  const i32 = new Int32Array(sab);

  assert.equal(
    publishContactEvent(BOX2D_CONTACT_KIND.CONTACT_BEGIN, 1, 2, 3, 4),
    true,
  );
  assert.equal(
    publishContactEvent(BOX2D_CONTACT_KIND.CONTACT_END, 1, 2, 3, 4),
    true,
  );

  const seen = [];
  let cursor = 0;
  const r1 = drainContactRing(i32, cursor, (kind, a, b, ga, gb) => {
    seen.push([kind, a, b, ga, gb]);
  });
  assert.equal(r1.overrun, false);
  assert.equal(r1.count, 2);
  cursor = r1.nextCursor;
  assert.deepEqual(seen, [
    [BOX2D_CONTACT_KIND.CONTACT_BEGIN, 1, 2, 3, 4],
    [BOX2D_CONTACT_KIND.CONTACT_END, 1, 2, 3, 4],
  ]);

  const r2 = drainContactRing(i32, cursor, () => {
    assert.fail('should be empty');
  });
  assert.equal(r2.count, 0);
  assert.equal(r2.nextCursor, cursor);
});

test('contact ring: overrun jumps cursor when consumer lags past capacity', () => {
  const cap = 256;
  const sab = createContactRingSab(cap);
  bindContactRing(sab);
  const i32 = new Int32Array(sab);

  for (let i = 0; i < cap + 10; i++) {
    publishContactEvent(BOX2D_CONTACT_KIND.SENSOR_BEGIN, i, i + 1, 0, 0);
  }

  const r = drainContactRing(i32, 0, () => {
    assert.fail('overrun should skip payload');
  });
  assert.equal(r.overrun, true);
  assert.equal(r.count, 0);
  assert.ok(r.nextCursor >= cap + 10);
});

test('contact ring: late bind always snaps to write head', () => {
  const sab = createContactRingSab(256);
  bindContactRing(sab);
  const i32 = new Int32Array(sab);

  publishContactEvent(BOX2D_CONTACT_KIND.CONTACT_BEGIN, 1, 2, 0, 0);
  publishContactEvent(BOX2D_CONTACT_KIND.CONTACT_BEGIN, 3, 4, 0, 0);

  const cursor = initialContactCursor(i32);
  assert.equal(cursor, 2);
  const r = drainContactRing(i32, cursor, () => {
    assert.fail('snapped cursor should skip backlog');
  });
  assert.equal(r.overrun, false);
  assert.equal(r.count, 0);
});

test('contact ring: late bind snaps past overwritten backlog', () => {
  const cap = 256;
  const sab = createContactRingSab(cap);
  bindContactRing(sab);
  const i32 = new Int32Array(sab);

  for (let i = 0; i < cap + 10; i++) {
    publishContactEvent(BOX2D_CONTACT_KIND.SENSOR_BEGIN, i, i + 1, 0, 0);
  }

  const cursor = initialContactCursor(i32);
  assert.ok(cursor > cap);
  const r = drainContactRing(i32, cursor, () => {
    assert.fail('snapped cursor should see empty backlog');
  });
  assert.equal(r.overrun, false);
  assert.equal(r.count, 0);
});

test('contact ring: two consumers with independent cursors', () => {
  const sab = createContactRingSab(256);
  bindContactRing(sab);
  const i32 = new Int32Array(sab);

  publishContactEvent(BOX2D_CONTACT_KIND.CONTACT_BEGIN, 10, 20, 1, 1);

  let c0 = 0;
  let c1 = 0;
  let n0 = 0;
  let n1 = 0;
  c0 = drainContactRing(i32, c0, () => {
    n0++;
  }).nextCursor;
  c1 = drainContactRing(i32, c1, () => {
    n1++;
  }).nextCursor;
  assert.equal(n0, 1);
  assert.equal(n1, 1);

  publishContactEvent(BOX2D_CONTACT_KIND.CONTACT_END, 10, 20, 1, 1);
  c0 = drainContactRing(i32, c0, () => {
    n0++;
  }).nextCursor;
  assert.equal(n0, 2);
  assert.equal(n1, 1);
  c1 = drainContactRing(i32, c1, () => {
    n1++;
  }).nextCursor;
  assert.equal(n1, 2);
});
