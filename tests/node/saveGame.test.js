import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_MAGIC,
  SAVE_FORMAT_VERSION,
  isEntityClassSerializable,
  shouldSaveEntity,
  encodeSaveUncompressed,
  decodeSaveUncompressed,
  encodeSave,
  decodeSave,
  applyEntitySaveRestore,
  componentSchemaFingerprint,
} from '../../src/core/entitySaveSnapshot.js';
import { Component } from '../../src/core/Component.js';

class FakeSerializable extends Component {
  static ARRAY_SCHEMA = {
    active: Uint8Array,
    hp: Float32Array,
  };
}

class FakeStatic extends Component {
  static ARRAY_SCHEMA = {
    active: Uint8Array,
  };
}

class FakeEntity {
  static serializable = true;
  static name = 'FakeEntity';
  static _componentClassMap = {
    FakeSerializable,
  };
}

class OtherEntity {
  static name = 'OtherEntity';
  static _componentClassMap = {
    FakeStatic,
  };
}

test('isEntityClassSerializable respects static flag', () => {
  assert.equal(isEntityClassSerializable(FakeEntity), true);
  assert.equal(isEntityClassSerializable(OtherEntity), false);
});

test('shouldSaveEntity requires serializable + active', () => {
  const active = new Uint8Array([0, 1, 1]);
  assert.equal(shouldSaveEntity(FakeEntity, 0, { active }), false);
  assert.equal(shouldSaveEntity(FakeEntity, 1, { active }), true);
  assert.equal(shouldSaveEntity(OtherEntity, 1, { active }), false);
});

test('encode/decode uncompressed roundtrip', () => {
  const payload = {
    magic: SAVE_MAGIC,
    formatVersion: SAVE_FORMAT_VERSION,
    engineVersion: '0.0.0-test',
    sceneName: 'TestScene',
    layout: { types: [{ name: 'FakeEntity', poolSize: 10 }], totalEntityCount: 10 },
    camera: [1, 2, 3, 4, 5, 6],
    sun: null,
    entities: [
      {
        typeName: 'FakeEntity',
        components: {
          FakeSerializable: {
            fingerprint: 1,
            fields: { active: 1, hp: 42.5 },
          },
        },
      },
    ],
  };

  const bytes = encodeSaveUncompressed(payload);
  const decoded = decodeSaveUncompressed(bytes);
  assert.equal(decoded.sceneName, 'TestScene');
  assert.equal(decoded.entities.length, 1);
  assert.equal(decoded.entities[0].components.FakeSerializable.fields.hp, 42.5);
  assert.deepEqual(decoded.camera, [1, 2, 3, 4, 5, 6]);
});

test('encode/decode deflate roundtrip', async () => {
  const payload = {
    magic: SAVE_MAGIC,
    formatVersion: SAVE_FORMAT_VERSION,
    engineVersion: '0.0.0-test',
    sceneName: 'TestScene',
    layout: { types: [], totalEntityCount: 0 },
    camera: null,
    sun: null,
    entities: [{ typeName: 'A', components: {} }],
  };
  const compressed = await encodeSave(payload);
  assert.ok(compressed.byteLength > 0);
  const decoded = await decodeSave(compressed);
  assert.equal(decoded.entities[0].typeName, 'A');
});

test('applyEntitySaveRestore writes SoA fields', () => {
  const sab = new SharedArrayBuffer(FakeSerializable.getBufferSize(4));
  FakeSerializable.initializeArrays(sab, 4);
  FakeSerializable.active[2] = 0;
  FakeSerializable.hp[2] = 0;

  applyEntitySaveRestore(2, FakeEntity, {
    FakeSerializable: {
      fingerprint: componentSchemaFingerprint(FakeSerializable),
      fields: { active: 1, hp: 99 },
    },
  });

  assert.equal(FakeSerializable.active[2], 1);
  assert.equal(FakeSerializable.hp[2], 99);
});

test('decode rejects bad magic', () => {
  assert.throws(() => decodeSaveUncompressed(new Uint8Array([1, 2, 3, 4])), /magic/);
});

test('SAVE_FORMAT_VERSION is 2', () => {
  assert.equal(SAVE_FORMAT_VERSION, 2);
});

test('isEntityClassSerializable own false wins over ancestor true', () => {
  class Parent {
    static serializable = true;
  }
  class GhostChild extends Parent {
    static serializable = false;
  }
  assert.equal(isEntityClassSerializable(Parent), true);
  assert.equal(isEntityClassSerializable(GhostChild), false);
});

test('joints + entityIndex roundtrip in uncompressed payload', () => {
  const payload = {
    magic: SAVE_MAGIC,
    formatVersion: SAVE_FORMAT_VERSION,
    engineVersion: '0.0.0-test',
    sceneName: 'TestScene',
    layout: { types: [], totalEntityCount: 0 },
    camera: null,
    sun: null,
    entities: [
      { typeName: 'MachineBox', entityIndex: 7, components: {} },
      { typeName: 'MachineWheel', entityIndex: 9, components: {} },
    ],
    joints: [
      {
        type: 4,
        entityA: 7,
        entityB: 9,
        localAnchorAX: 0,
        localAnchorAY: 0,
        localAnchorBX: 0,
        localAnchorBY: 0,
        forceThreshold: Infinity,
        torqueThreshold: Infinity,
        enableMotor: 1,
        motorSpeed: 10,
        maxMotorTorque: 100,
      },
    ],
    liquidFun: null,
  };
  const bytes = encodeSaveUncompressed(payload);
  const decoded = decodeSaveUncompressed(bytes);
  assert.equal(decoded.formatVersion, 2);
  assert.equal(decoded.entities[0].entityIndex, 7);
  assert.equal(decoded.joints.length, 1);
  assert.equal(decoded.joints[0].entityA, 7);
  assert.equal(decoded.joints[0].type, 4);
});

test('liquidFun pack/unpack roundtrip', async () => {
  const { packLiquidFunSnapshot, unpackLiquidFunSnapshot } = await import('../../src/core/liquidFunSave.js');
  const snap = {
    count: 2,
    radius: 8,
    maxCount: 100,
    pos: new Float32Array([1, 2, 3, 4]),
    vel: new Float32Array([0.1, 0.2, 0.3, 0.4]),
    flags: new Uint32Array([1, 2]),
    groupIndex: new Int32Array([0, 0]),
    restOffset: new Float32Array([0.5, -0.5, -0.5, 0.5]),
    groups: {
      slotCount: 1,
      alive: new Uint8Array([1]),
      flags: new Uint32Array([16]),
      groupFlags: new Uint32Array([0]),
      strength: new Float32Array([0.55]),
      viscousScale: new Float32Array([1]),
      firstIndex: new Int32Array([0]),
      lastIndex: new Int32Array([2]),
    },
    pairs: {
      count: 1,
      a: new Uint16Array([0]),
      b: new Uint16Array([1]),
      flags: new Uint32Array([64]),
      distance: new Float32Array([12]),
      strength: new Float32Array([0.25]),
    },
    render: {
      tint: new Uint32Array([0xff0000, 0x00ff00]),
      textureId: new Uint16Array([1, 2]),
      scaleX: new Float32Array([1, 1]),
      scaleY: new Float32Array([1, 1]),
      alpha: new Float32Array([1, 0.5]),
    },
  };
  const packed = packLiquidFunSnapshot(snap);
  const unpacked = unpackLiquidFunSnapshot(packed);
  assert.equal(unpacked.count, 2);
  assert.deepEqual([...unpacked.pos], [1, 2, 3, 4]);
  assert.deepEqual([...unpacked.flags], [1, 2]);
  assert.deepEqual([...unpacked.groupIndex], [0, 0]);
  assert.deepEqual([...unpacked.restOffset], [0.5, -0.5, -0.5, 0.5]);
  assert.equal(unpacked.groups.slotCount, 1);
  assert.ok(Math.abs(unpacked.groups.strength[0] - 0.55) < 1e-6);
  assert.equal(unpacked.pairs.count, 1);
  assert.equal(unpacked.pairs.distance[0], 12);
  assert.deepEqual([...unpacked.render.tint], [0xff0000, 0x00ff00]);
});
