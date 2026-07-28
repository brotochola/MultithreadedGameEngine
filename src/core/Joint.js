// Joint.js - Box2D-mapped joint pool (distance / revolute / weld)
// Thread-safe pool backed by SharedArrayBuffer; syncs to WASM in weedjs_post.
// Extends SharedAtomicPool for atomic free list operations.

import { SharedAtomicPool } from './SharedAtomicPool.js';
import { Transform } from '../components/Transform.js';
import { JOINT_TYPE } from '../box2d/box2dConstants.js';

/**
 * Static class for distance / revolute / weld joints between entities.
 * Attachment points are body-local (localAnchor*). Default (0,0) = COM.
 */
export class Joint extends SharedAtomicPool {
  static INVALID_INDEX = 0xffff;

  static poolName = 'Joint';

  static TYPE = JOINT_TYPE;

  // Shared
  static type = null; // Uint8Array
  static pairs = null; // Uint32Array (entityA << 16) | entityB
  static localAnchorAX = null; // Float32Array
  static localAnchorAY = null;
  static localAnchorBX = null;
  static localAnchorBY = null;
  static active = null; // Uint8Array

  // Distance
  static length = null; // Float32Array
  static enableSpring = null; // Uint8Array
  static hertz = null; // Float32Array
  static dampingRatio = null; // Float32Array

  // Revolute
  static enableLimit = null; // Uint8Array
  static lowerAngle = null; // Float32Array
  static upperAngle = null; // Float32Array
  static enableMotor = null; // Uint8Array
  static motorSpeed = null; // Float32Array
  static maxMotorTorque = null; // Float32Array

  // Weld
  static linearHertz = null; // Float32Array
  static angularHertz = null; // Float32Array
  static linearDampingRatio = null; // Float32Array
  static angularDampingRatio = null; // Float32Array

  // Dense active list
  static activeIndices = null; // Uint16Array
  static activeIndexPositions = null; // Uint16Array
  static activeMeta = null; // Int32Array[2]
  static activeCount = null; // Int32Array[1]
  static activeListLock = null; // Int32Array[1]

  static getBufferSize(maxJoints) {
    // Mirror initializeArrays offsets
    let offset = 0;
    const n = maxJoints;
    const align4 = (o) => Math.ceil(o / 4) * 4;
    offset = align4(offset + n); // type
    offset += n * 4; // pairs
    offset += n * 4 * 4; // localAnchors
    offset = align4(offset + n); // active
    offset += n * 4; // length
    offset = align4(offset + n); // enableSpring
    offset += n * 4; // hertz
    offset += n * 4; // dampingRatio
    offset = align4(offset + n); // enableLimit
    offset += n * 4; // lowerAngle
    offset += n * 4; // upperAngle
    offset = align4(offset + n); // enableMotor
    offset += n * 4; // motorSpeed
    offset += n * 4; // maxMotorTorque
    offset += n * 4 * 4; // weld floats
    offset += n * 2; // activeIndices
    offset += n * 2; // activeIndexPositions
    offset += 8; // activeMeta
    return offset;
  }

  static initializeArrays(buffer, maxJoints) {
    let offset = 0;
    const n = maxJoints;
    const align4 = (o) => Math.ceil(o / 4) * 4;

    this.type = new Uint8Array(buffer, offset, n);
    offset = align4(offset + n);

    this.pairs = new Uint32Array(buffer, offset, n);
    offset += n * 4;

    this.localAnchorAX = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.localAnchorAY = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.localAnchorBX = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.localAnchorBY = new Float32Array(buffer, offset, n);
    offset += n * 4;

    this.active = new Uint8Array(buffer, offset, n);
    offset = align4(offset + n);

    this.length = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.enableSpring = new Uint8Array(buffer, offset, n);
    offset = align4(offset + n);
    this.hertz = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.dampingRatio = new Float32Array(buffer, offset, n);
    offset += n * 4;

    this.enableLimit = new Uint8Array(buffer, offset, n);
    offset = align4(offset + n);
    this.lowerAngle = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.upperAngle = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.enableMotor = new Uint8Array(buffer, offset, n);
    offset = align4(offset + n);
    this.motorSpeed = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.maxMotorTorque = new Float32Array(buffer, offset, n);
    offset += n * 4;

    this.linearHertz = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.angularHertz = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.linearDampingRatio = new Float32Array(buffer, offset, n);
    offset += n * 4;
    this.angularDampingRatio = new Float32Array(buffer, offset, n);
    offset += n * 4;

    this.activeIndices = new Uint16Array(buffer, offset, n);
    offset += n * 2;
    this.activeIndexPositions = new Uint16Array(buffer, offset, n);
    offset += n * 2;

    this.activeMeta = new Int32Array(buffer, offset, 2);
    this.activeCount = new Int32Array(buffer, offset, 1);
    this.activeListLock = new Int32Array(buffer, offset + 4, 1);

    this.active.fill(0);
    this.type.fill(0);
    this.activeIndices.fill(this.INVALID_INDEX);
    this.activeIndexPositions.fill(this.INVALID_INDEX);
    this.activeMeta[0] = 0;
    this.activeMeta[1] = 0;
  }

  static _worldToLocal(entity, wx, wy) {
    const x = Transform.x[entity];
    const y = Transform.y[entity];
    const rot = Transform.rotation[entity] || 0;
    const dx = wx - x;
    const dy = wy - y;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }

  static _resolveLocalAnchors(opts, entityA, entityB) {
    if (opts.worldAnchorX !== undefined && opts.worldAnchorY !== undefined) {
      const la = this._worldToLocal(entityA, opts.worldAnchorX, opts.worldAnchorY);
      const lb = this._worldToLocal(entityB, opts.worldAnchorX, opts.worldAnchorY);
      return { ax: la.x, ay: la.y, bx: lb.x, by: lb.y };
    }
    return {
      ax: opts.localAnchorAX ?? 0,
      ay: opts.localAnchorAY ?? 0,
      bx: opts.localAnchorBX ?? 0,
      by: opts.localAnchorBY ?? 0,
    };
  }

  static _activate(idx) {
    this.acquireSpinLock(this.activeListLock);
    try {
      const slot = this.activeCount ? Atomics.load(this.activeCount, 0) : 0;
      this.activeIndices[slot] = idx;
      this.activeIndexPositions[idx] = slot;
      this.active[idx] = 1;
      if (this.activeCount) {
        Atomics.store(this.activeCount, 0, slot + 1);
      }
    } finally {
      this.releaseSpinLock(this.activeListLock);
    }
  }

  static _acquireOrWarn() {
    const idx = this.acquireIndex();
    if (idx === -1) {
      console.warn('Joint: Pool exhausted');
    }
    return idx;
  }

  static _setPairAndAnchors(idx, entityA, entityB, anchors) {
    this.pairs[idx] = (entityA << 16) | (entityB & 0xffff);
    this.localAnchorAX[idx] = anchors.ax;
    this.localAnchorAY[idx] = anchors.ay;
    this.localAnchorBX[idx] = anchors.bx;
    this.localAnchorBY[idx] = anchors.by;
  }

  static addDistance(opts = {}) {
    const entityA = opts.entityA | 0;
    const entityB = opts.entityB | 0;
    const idx = this._acquireOrWarn();
    if (idx === -1) return -1;

    const anchors = this._resolveLocalAnchors(opts, entityA, entityB);
    this.type[idx] = JOINT_TYPE.DISTANCE;
    this._setPairAndAnchors(idx, entityA, entityB, anchors);
    this.length[idx] = opts.length ?? 0;
    this.enableSpring[idx] = opts.enableSpring ? 1 : 0;
    this.hertz[idx] = opts.hertz ?? 1;
    this.dampingRatio[idx] = opts.dampingRatio ?? 0.7;
    this._activate(idx);
    return idx;
  }

  static addRevolute(opts = {}) {
    const entityA = opts.entityA | 0;
    const entityB = opts.entityB | 0;
    const idx = this._acquireOrWarn();
    if (idx === -1) return -1;

    const anchors = this._resolveLocalAnchors(opts, entityA, entityB);
    this.type[idx] = JOINT_TYPE.REVOLUTE;
    this._setPairAndAnchors(idx, entityA, entityB, anchors);
    this.enableLimit[idx] = opts.enableLimit ? 1 : 0;
    this.lowerAngle[idx] = opts.lowerAngle ?? 0;
    this.upperAngle[idx] = opts.upperAngle ?? 0;
    this.enableMotor[idx] = opts.enableMotor ? 1 : 0;
    this.motorSpeed[idx] = opts.motorSpeed ?? 0;
    this.maxMotorTorque[idx] = opts.maxMotorTorque ?? 0;
    this._activate(idx);
    return idx;
  }

  static addWeld(opts = {}) {
    const entityA = opts.entityA | 0;
    const entityB = opts.entityB | 0;
    const idx = this._acquireOrWarn();
    if (idx === -1) return -1;

    const anchors = this._resolveLocalAnchors(opts, entityA, entityB);
    this.type[idx] = JOINT_TYPE.WELD;
    this._setPairAndAnchors(idx, entityA, entityB, anchors);
    this.linearHertz[idx] = opts.linearHertz ?? 0;
    this.angularHertz[idx] = opts.angularHertz ?? 0;
    this.linearDampingRatio[idx] = opts.linearDampingRatio ?? 1;
    this.angularDampingRatio[idx] = opts.angularDampingRatio ?? 1;
    this._activate(idx);
    return idx;
  }

  static remove(idx) {
    if (idx < 0 || idx >= this.maxCount) return;
    if (!this.active[idx]) return;

    this.acquireSpinLock(this.activeListLock);
    try {
      if (!this.active[idx]) return;

      const count = this.activeCount ? Atomics.load(this.activeCount, 0) : 0;
      const slot = this.activeIndexPositions[idx];
      const lastSlot = count - 1;

      this.active[idx] = 0;

      if (slot !== this.INVALID_INDEX && lastSlot >= 0) {
        const lastIdx = this.activeIndices[lastSlot];
        if (slot !== lastSlot) {
          this.activeIndices[slot] = lastIdx;
          this.activeIndexPositions[lastIdx] = slot;
        }
        this.activeIndices[lastSlot] = this.INVALID_INDEX;
        this.activeIndexPositions[idx] = this.INVALID_INDEX;
        if (this.activeCount) {
          Atomics.store(this.activeCount, 0, lastSlot);
        }
      }
    } finally {
      this.releaseSpinLock(this.activeListLock);
    }

    this.returnToPool(idx);
  }

  static getEntities(idx) {
    const packed = this.pairs[idx];
    return {
      entityA: packed >>> 16,
      entityB: packed & 0xffff,
    };
  }

  static update(idx, props = {}) {
    if (idx < 0 || idx >= this.maxCount || !this.active[idx]) return;
    const t = this.type[idx];

    if (props.localAnchorAX !== undefined) this.localAnchorAX[idx] = props.localAnchorAX;
    if (props.localAnchorAY !== undefined) this.localAnchorAY[idx] = props.localAnchorAY;
    if (props.localAnchorBX !== undefined) this.localAnchorBX[idx] = props.localAnchorBX;
    if (props.localAnchorBY !== undefined) this.localAnchorBY[idx] = props.localAnchorBY;

    if (t === JOINT_TYPE.DISTANCE) {
      if (props.length !== undefined) this.length[idx] = props.length;
      if (props.enableSpring !== undefined) this.enableSpring[idx] = props.enableSpring ? 1 : 0;
      if (props.hertz !== undefined) this.hertz[idx] = props.hertz;
      if (props.dampingRatio !== undefined) this.dampingRatio[idx] = props.dampingRatio;
    } else if (t === JOINT_TYPE.REVOLUTE) {
      if (props.enableLimit !== undefined) this.enableLimit[idx] = props.enableLimit ? 1 : 0;
      if (props.lowerAngle !== undefined) this.lowerAngle[idx] = props.lowerAngle;
      if (props.upperAngle !== undefined) this.upperAngle[idx] = props.upperAngle;
      if (props.enableMotor !== undefined) this.enableMotor[idx] = props.enableMotor ? 1 : 0;
      if (props.motorSpeed !== undefined) this.motorSpeed[idx] = props.motorSpeed;
      if (props.maxMotorTorque !== undefined) this.maxMotorTorque[idx] = props.maxMotorTorque;
    } else if (t === JOINT_TYPE.WELD) {
      if (props.linearHertz !== undefined) this.linearHertz[idx] = props.linearHertz;
      if (props.angularHertz !== undefined) this.angularHertz[idx] = props.angularHertz;
      if (props.linearDampingRatio !== undefined) {
        this.linearDampingRatio[idx] = props.linearDampingRatio;
      }
      if (props.angularDampingRatio !== undefined) {
        this.angularDampingRatio[idx] = props.angularDampingRatio;
      }
    }
  }

  static isActive(idx) {
    return idx >= 0 && idx < this.maxCount && this.active[idx] === 1;
  }

  static removeAllForEntity(entityIdx) {
    const activeCount = this.getDenseActiveCount();
    for (let slot = activeCount - 1; slot >= 0; slot--) {
      const idx = this.activeIndices[slot];
      if (idx === this.INVALID_INDEX || !this.active[idx]) continue;
      const packed = this.pairs[idx];
      const a = packed >>> 16;
      const b = packed & 0xffff;
      if (a === entityIdx || b === entityIdx) {
        this.remove(idx);
      }
    }
  }

  static getDenseActiveCount() {
    if (!this.activeCount) return 0;
    return Atomics.load(this.activeCount, 0);
  }

  static getAllActive() {
    const result = [];
    const activeCount = this.getDenseActiveCount();
    for (let slot = 0; slot < activeCount; slot++) {
      const idx = this.activeIndices[slot];
      if (idx === this.INVALID_INDEX || !this.active[idx]) continue;
      const packed = this.pairs[idx];
      result.push({
        idx,
        type: this.type[idx],
        entityA: packed >>> 16,
        entityB: packed & 0xffff,
        localAnchorAX: this.localAnchorAX[idx],
        localAnchorAY: this.localAnchorAY[idx],
        localAnchorBX: this.localAnchorBX[idx],
        localAnchorBY: this.localAnchorBY[idx],
        length: this.length[idx],
      });
    }
    return result;
  }

  static reset() {
    super.reset();
    this.type = null;
    this.pairs = null;
    this.localAnchorAX = null;
    this.localAnchorAY = null;
    this.localAnchorBX = null;
    this.localAnchorBY = null;
    this.active = null;
    this.length = null;
    this.enableSpring = null;
    this.hertz = null;
    this.dampingRatio = null;
    this.enableLimit = null;
    this.lowerAngle = null;
    this.upperAngle = null;
    this.enableMotor = null;
    this.motorSpeed = null;
    this.maxMotorTorque = null;
    this.linearHertz = null;
    this.angularHertz = null;
    this.linearDampingRatio = null;
    this.angularDampingRatio = null;
    this.activeIndices = null;
    this.activeIndexPositions = null;
    this.activeMeta = null;
    this.activeCount = null;
    this.activeListLock = null;
  }
}
