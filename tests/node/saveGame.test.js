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
