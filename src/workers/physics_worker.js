self.postMessage({
  msg: 'log',
  message: 'js loaded',
  when: Date.now(),
});

// physics_worker.js — Box2D 3.0 WASM (nested weedjs worker; hot pose/vel rebound to HEAP)

import { Transform } from '../components/Transform.js';
import { RigidBody } from '../components/RigidBody.js';
import { Collider } from '../components/Collider.js';
import { Joint } from '../core/Joint.js';
import { AbstractWorker } from './AbstractWorker.js';
import { PHYSICS_DEFAULTS } from '../core/ConfigDefaults.js';
import { PHYSICS_STATS, createStatsWriter } from './workers-utils.js';
import { validatePhysicsConfig } from '../core/utils.js';
import { rebindBox2dHotFields } from '../box2d/box2dHotFields.js';
import {
  createCommandRingSab,
  bindCommandRing,
} from '../box2d/box2dCommandRing.js';
import { createContactRingSab } from '../box2d/box2dContactRing.js';

/** Dev / unbundled default. Bundle mode passes absolute blob URL via init. */
const BOX2D_WORKER_URL_DEFAULT = '/src/box2d/box2d_wasm.js';

const CTRL = {
  STATE: 0,
  SUBSTEPS: 1,
  ENTITY_COUNT: 2,
};

function packView(arr) {
  return {
    sab: arr.buffer,
    byteOffset: arr.byteOffset,
    length: arr.length,
  };
}

/**
 * PhysicsWorker — drives Box2D via nested classic worker (pthread entry = box2d_wasm.js).
 * STOP 2: hot Transform/RigidBody fields rebound to WASM HEAP (px, px/s).
 * STOP 4: command ring SAB for mid-sim teleport / velocity.
 */
class PhysicsWorker extends AbstractWorker {
  constructor(selfRef) {
    super(selfRef);
    this.needsGameScripts = false;
    this.settings = null;
    this.jointsEnabled = false;
    this.maxJoints = 0;

    this._box2dWorker = null;
    this._box2dWorkerUrl = BOX2D_WORKER_URL_DEFAULT;
    this._box2dReady = false;
    this._controlSab = null;
    this._ctrlI32 = null;
    this._ctrlF32 = null;
    this._pendingModule = null;
  }

  initialize(data) {
    if (data.buffers.physicsStats) {
      this.stats = createStatsWriter(data.buffers.physicsStats, PHYSICS_STATS);
    }

    if (data.joints && data.joints.enabled) {
      this.jointsEnabled = true;
      this.maxJoints = data.joints.maxJoints;
      Joint.initializeArrays(data.joints.data, this.maxJoints);
      Joint.initialize(this.maxJoints);
      Joint.initializeFreeList(
        data.joints.freeList,
        data.joints.freeListTop,
      );
    }

    if (data.box2dWorkerUrl) {
      this._box2dWorkerUrl = data.box2dWorkerUrl;
    }

    this.applyPhysicsConfig(this.config.physics || {});
    this._bootBox2d();
  }

  _bootBox2d() {
    const entityCount = this.globalEntityCount | 0;
    const maxSlotsHint = 65535;
    const maxBodies = Math.min(entityCount, maxSlotsHint);
    if (entityCount > maxSlotsHint) {
      throw new Error(
        `Physics: totalEntityCount ${entityCount} exceeds Box2D MAX_BODIES ${maxSlotsHint}`,
      );
    }

    this._controlSab = new SharedArrayBuffer(32);
    this._ctrlI32 = new Int32Array(this._controlSab);
    this._ctrlF32 = new Float32Array(this._controlSab, 16, 4);
    Atomics.store(this._ctrlI32, CTRL.STATE, 0);
    Atomics.store(this._ctrlI32, CTRL.SUBSTEPS, this.settings.subStepCount | 0);
    Atomics.store(this._ctrlI32, CTRL.ENTITY_COUNT, entityCount);

    this._commandSab = createCommandRingSab();
    bindCommandRing(this._commandSab);
    this._contactSab = createContactRingSab(
      this.settings.contactRingCapacity ??
        this.config.physics?.contactRingCapacity ??
        PHYSICS_DEFAULTS.contactRingCapacity,
    );

    const s = this.settings;
    this._pendingModule = {
      type: 'WEEDJS_INIT',
      gravityX: s.gravity?.x ?? 0,
      gravityY: s.gravity?.y ?? 0,
      lengthUnitsPerMeter:
        s.lengthUnitsPerMeter ?? PHYSICS_DEFAULTS.lengthUnitsPerMeter,
      contactHertz: s.contactHertz ?? PHYSICS_DEFAULTS.contactHertz,
      contactDampingRatio:
        s.contactDampingRatio ?? PHYSICS_DEFAULTS.contactDampingRatio,
      contactSpeed: s.contactSpeed ?? PHYSICS_DEFAULTS.contactSpeed,
      maximumLinearSpeed:
        s.maximumLinearSpeed ?? PHYSICS_DEFAULTS.maximumLinearSpeed,
      box2dWorkerCount: s.box2dWorkerCount ?? PHYSICS_DEFAULTS.box2dWorkerCount,
      maxBodies,
      entityCount,
      subSteps: s.subStepCount,
      sleeping: this._sleepingEnabled !== false,
      controlSab: this._controlSab,
      commandSab: this._commandSab,
      contactSab: this._contactSab,
      stats: this.stats ? packView(this.stats) : null,
      bodySync: this.bodySyncViews
        ? {
            dirtyFlags: packView(this.bodySyncViews.dirtyFlags),
            dirtyWords: packView(this.bodySyncViews.dirtyWords),
            generation: packView(this.bodySyncViews.generation),
          }
        : null,
      views: {
        entityActive: packView(Transform.active),
        x: packView(Transform.x),
        y: packView(Transform.y),
        rotation: packView(Transform.rotation),
        rbActive: packView(RigidBody.active),
        rbStatic: packView(RigidBody.static),
        vx: packView(RigidBody.vx),
        vy: packView(RigidBody.vy),
        ax: packView(RigidBody.ax),
        ay: packView(RigidBody.ay),
        angularVelocity: packView(RigidBody.angularVelocity),
        angularAccel: packView(RigidBody.angularAccel),
        mass: packView(RigidBody.mass),
        maxLinearSpeed: packView(RigidBody.maxLinearSpeed),
        linearDamping: packView(RigidBody.linearDamping),
        angularDamping: packView(RigidBody.angularDamping),
        sleeping: packView(RigidBody.sleeping),
        fixedRotation: packView(RigidBody.fixedRotation),
        colActive: packView(Collider.active),
        offsetX: packView(Collider.offsetX),
        offsetY: packView(Collider.offsetY),
        shapeType: packView(Collider.shapeType),
        radius: packView(Collider.radius),
        width: packView(Collider.width),
        height: packView(Collider.height),
        isTrigger: packView(Collider.isTrigger),
        collisionLayer: packView(Collider.collisionLayer),
        collisionMask: packView(Collider.collisionMask),
        collisionGroupIndex: packView(Collider.collisionGroupIndex),
        friction: packView(Collider.friction),
        polyCount: packView(Collider.polyCount),
        polyVertexX: packView(Collider.polyVertexX),
        polyVertexY: packView(Collider.polyVertexY),
      },
    };

    if (this.jointsEnabled && Joint.active) {
      this._pendingModule.maxJoints = this.maxJoints;
      this._pendingModule.jointViews = {
        type: packView(Joint.type),
        pairs: packView(Joint.pairs),
        localAnchorAX: packView(Joint.localAnchorAX),
        localAnchorAY: packView(Joint.localAnchorAY),
        localAnchorBX: packView(Joint.localAnchorBX),
        localAnchorBY: packView(Joint.localAnchorBY),
        active: packView(Joint.active),
        length: packView(Joint.length),
        enableSpring: packView(Joint.enableSpring),
        hertz: packView(Joint.hertz),
        dampingRatio: packView(Joint.dampingRatio),
        enableLimit: packView(Joint.enableLimit),
        lowerAngle: packView(Joint.lowerAngle),
        upperAngle: packView(Joint.upperAngle),
        enableMotor: packView(Joint.enableMotor),
        motorSpeed: packView(Joint.motorSpeed),
        maxMotorTorque: packView(Joint.maxMotorTorque),
        linearHertz: packView(Joint.linearHertz),
        angularHertz: packView(Joint.angularHertz),
        linearDampingRatio: packView(Joint.linearDampingRatio),
        angularDampingRatio: packView(Joint.angularDampingRatio),
        activeIndices: packView(Joint.activeIndices),
        activeCount: packView(Joint.activeCount),
        revision: packView(Joint.revision),
      };
    }

    // Pending INIT must exist before Worker starts: embedded Box2D can post
    // WEEDJS_MODULE_READY before the next statement runs.
    this._box2dWorker = new Worker(this._box2dWorkerUrl);
    this._box2dWorker.onmessage = (event) => this._onBox2dMessage(event.data);
    this._box2dWorker.onerror = (err) => {
      console.error('[physics] box2d worker error', err);
      this.reportError('Box2D worker failed', err);
    };
  }

  _onBox2dMessage(data) {
    if (!data || !data.type) return;
    if (data.type === 'WEEDJS_MODULE_READY') {
      if (this._pendingModule) {
        this._box2dWorker.postMessage(this._pendingModule);
        this._pendingModule = null;
      }
      return;
    }
    if (data.type === 'WEEDJS_READY') {
      this._box2dReady = true;
      this.box2dEventLayout = data;
      rebindBox2dHotFields(data);
      this.self.postMessage({
        msg: 'box2dReady',
        sab: data.sab,
        bodyCapacity: data.bodyCapacity,
        channelOffsets: data.channelOffsets,
        sleepingByteOffset: data.sleepingByteOffset,
        commandSab: this._commandSab,
        contactSab: this._contactSab,
        eventHeaderBaseIndex: data.eventHeaderBaseIndex,
        contactBeginBaseIndex: data.contactBeginBaseIndex,
        contactEndBaseIndex: data.contactEndBaseIndex,
        sensorBeginBaseIndex: data.sensorBeginBaseIndex,
        sensorEndBaseIndex: data.sensorEndBaseIndex,
        contactEventCapacity: data.contactEventCapacity,
        sensorEventCapacity: data.sensorEventCapacity,
        contactPairIntStride: data.contactPairIntStride || 2,
        eventHeaderIntCount: data.eventHeaderIntCount || 8,
      });
      console.log('[physics] Box2D READY + hot rebind + command ring', data.bodyCapacity);
      return;
    }
    if (data.type === 'WEEDJS_ERROR') {
      console.error('[physics] Box2D:', data.message);
      this.reportError('Box2D error', new Error(data.message));
    }
  }

  applyPhysicsConfig(partialConfig = {}) {
    this.config.physics = {
      ...(this.config.physics || {}),
      ...partialConfig,
    };
    this.settings = validatePhysicsConfig(this.settings, this.config.physics);
    this._wakeUpThresholdSq =
      (this.config.physics.wakeUpThreshold ?? PHYSICS_DEFAULTS.wakeUpThreshold) **
      2;
    this._sleepThreshold =
      this.config.physics.sleepThreshold ?? PHYSICS_DEFAULTS.sleepThreshold;
    this._sleepingEnabled =
      this.config.physics.sleeping ?? PHYSICS_DEFAULTS.sleeping;

    if (this._ctrlI32) {
      Atomics.store(this._ctrlI32, CTRL.SUBSTEPS, this.settings.subStepCount | 0);
    }
    if (this._box2dWorker && this._box2dReady) {
      this._box2dWorker.postMessage({
        type: 'WEEDJS_CONFIG',
        subSteps: this.settings.subStepCount,
        sleeping: this._sleepingEnabled !== false,
      });
    }
  }

  handleCustomMessage(data) {
    if (data.msg === 'updatePhysicsConfig') {
      this.applyPhysicsConfig(data.config || {});
    }
  }

  /**
   * Sync step: wake nested worker, wait until STATE=2 (or 3 fatal).
   */
  _stepBox2d(dtSec) {
    if (!this._box2dReady || !this._ctrlI32) return;
    const t0 = performance.now();
    this._ctrlF32[0] = dtSec;
    Atomics.store(this._ctrlI32, CTRL.SUBSTEPS, this.settings.subStepCount | 0);
    Atomics.store(this._ctrlI32, CTRL.STATE, 1);
    Atomics.notify(this._ctrlI32, CTRL.STATE, 1);
    // Wait while STATE === 1 (done = 2, fatal = 3)
    while (Atomics.load(this._ctrlI32, CTRL.STATE) === 1) {
      Atomics.wait(this._ctrlI32, CTRL.STATE, 1);
    }
    const state = Atomics.load(this._ctrlI32, CTRL.STATE);
    Atomics.store(this._ctrlI32, CTRL.STATE, 0);
    if (this.stats) {
      this.stats[PHYSICS_STATS.STEP_MS] = performance.now() - t0;
    }
    if (state === 3) {
      console.error('[physics] Box2D step reported fatal');
    }
  }

  update(deltaTime, dtRatio, resuming) {
    if (!this._box2dReady) {
      return;
    }
    // deltaTime is ms; Box2D wants seconds. Cap like lab MAX_DT.
    let dt = deltaTime / 1000;
    if (dt > 1 / 20) dt = 1 / 20;
    if (!(dt > 0)) return;
    this._stepBox2d(dt);
  }

  reportFPS() {
    if (this.stats) {
      this.stats[PHYSICS_STATS.FPS] = this.currentFPS;
      this.stats[PHYSICS_STATS.MSG_MS] = this.messageTimeThisFrame;
    }
  }
}

const physicsWorker = new PhysicsWorker(self);
