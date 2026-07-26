self.postMessage({
  msg: 'log',
  message: 'js loaded',
  when: Date.now(),
});
// physics_worker.js - Physics integration (velocity, position updates)
// Now uses per-entity maxVel and friction from GameObject arrays
// Supports Circle, AABB Box, and OrientedBox (OBB) colliders

// Import engine dependencies
import { GameObject } from '../core/gameObject.js';
import { Transform } from '../components/Transform.js';
import { RigidBody } from '../components/RigidBody.js';
import { Collider } from '../components/Collider.js';
import { Constraint } from '../core/Constraint.js';
import { AbstractWorker } from './AbstractWorker.js';
import { Grid } from '../core/Grid.js';
import { PHYSICS_DEFAULTS } from '../core/ConfigDefaults.js';
import { PHYSICS_STATS, createStatsWriter } from './workers-utils.js';
import {
  validatePhysicsConfig,
  testCircleOBBCollision,
  testOBBOBBCollision,
} from '../core/utils.js';
// Note: Game-specific scripts are loaded dynamically by AbstractWorker
// Physics worker uses RigidBody component for physics calculations

// Shape type constants (must match Collider.shapeType / ShapeType enum)
const SHAPE_CIRCLE = 0;
const SHAPE_BOX = 1;
const SHAPE_ORIENTED_BOX = 2;
const MIN_CONSTRAINT_DIST_SQ = 0.0001 * 0.0001;
const CONSTRAINT_ERROR_EPSILON = 0.001;

/**
 * PhysicsWorker - Handles physics integration for all entities
 * Integrates acceleration -> velocity -> position
 * Extends AbstractWorker for common worker functionality
 */
class PhysicsWorker extends AbstractWorker {
  constructor(selfRef) {
    super(selfRef);

    // Physics worker doesn't create GameObject instances (but has access to all components)
    this.needsGameScripts = false;
    this.rigidBodyCount = 0

    // Runtime physics settings (will be filled from Scene config)
    this.settings = null;

    // Collision data buffer for Unity-style callbacks
    this.collisionData = null;
    this.maxCollisionPairs = 10000; // Default, will be set from config

    // Fixed timestep accumulator for stable physics with noLimitFPS
    // When noLimitFPS is true, we accumulate time and run physics at a fixed rate
    this.timeAccumulator = 0;
    this.fixedDeltaTime = 16.67; // Target: 60fps physics tick (will be divided by subStepCount)

    // Stats tracking
    this.collisionChecksThisFrame = 0;
    this.collisionsResolvedThisFrame = 0;
    this.collisionPairsThisFrame = 0;
    this.constraintSolveTimeThisFrame = 0;
    this.moveTimeThisFrame = 0;
    this.collisionSolveTimeThisFrame = 0;

    // PERFORMANCE: Reusable collision result object to avoid GC pressure
    // Instead of allocating thousands of objects per frame, we reuse this one
    this.collisionResult = {
      collided: false,
      depth: 0,
      nx: 0,
      ny: 0,
      cx: 0,
      cy: 0,
    };

    // Per-entity cos/sin cache for OrientedBox narrowphase (filled each resolve pass)
    this._obbCos = null;
    this._obbSin = null;
    this._obbCacheLen = 0;

    // Constraint system
    this.constraintsEnabled = false;
    this.maxConstraints = 0;
  }

  /**
   * Initialize physics worker (implementation of AbstractWorker.initialize)
   */
  initialize(data) {
    //console.log("PHYSICS WORKER: Initializing with component system");

    // Initialize stats buffer for writing metrics
    if (data.buffers.physicsStats) {
      this.stats = createStatsWriter(data.buffers.physicsStats, PHYSICS_STATS);
      console.log('PHYSICS WORKER: Stats buffer initialized');
    }

    // Note: Component arrays are automatically initialized by AbstractWorker.initializeAllComponents()

    // Initialize collision data buffer for Unity-style collision callbacks
    if (data.buffers.collisionData) {
      this.collisionData = new Int32Array(data.buffers.collisionData);
      this.maxCollisionPairs =
        this.config.physics?.maxCollisionPairs ?? this.config.maxCollisionPairs ?? PHYSICS_DEFAULTS.maxCollisionPairs;
    }

    // Initialize constraint system if enabled
    if (data.constraints && data.constraints.enabled) {
      this.constraintsEnabled = true;
      this.maxConstraints = data.constraints.maxConstraints;

      // Initialize Constraint arrays from SharedArrayBuffer
      Constraint.initializeArrays(data.constraints.data, this.maxConstraints);
      Constraint.initialize(this.maxConstraints);
      Constraint.initializeFreeList(data.constraints.freeList, data.constraints.freeListTop);

      console.log(`PHYSICS WORKER: Constraint system initialized with ${this.maxConstraints} max constraints`);
    }

    this.applyPhysicsConfig(this.config.physics || {});
  }

  /**
   * Update method called each frame (implementation of AbstractWorker.update)
   * Performs physics integration for all entities
   *
   * When noLimitFPS is true, uses a fixed-timestep accumulator to ensure stable physics.
   * SubSteps divide the fixed timestep for constraint solving, not the variable frame time.
   */
  update(deltaTime, dtRatio, resuming) {
    // Reset stats counters once per frame (before fixed-step accumulator loop)
    this.collisionChecksThisFrame = 0;
    this.collisionsResolvedThisFrame = 0;
    this.collisionPairsThisFrame = 0;
    this.constraintSolveTimeThisFrame = 0;
    this.moveTimeThisFrame = 0;
    this.collisionSolveTimeThisFrame = 0;

    // OPTIMIZATION: Cache query results per frame to avoid repeated calls
    // These queries are cached by the query system, but accessing them once is still faster
    this._cachedPhysicsEntities = null;
    this._cachedColliderEntities = null;

    this.buildDenseColliders();

    if (this.noLimitFPS && this.settings.subStepCount > 1) {
      // Fixed timestep mode: accumulate time and run physics at fixed intervals
      // This ensures subSteps work correctly regardless of actual frame rate
      const fixedStep = this.fixedDeltaTime / this.settings.subStepCount;
      const fixedDtRatio = fixedStep / 16.67;

      // Clamp accumulated time to prevent spiral of death (max ~3 frames worth)
      this.timeAccumulator += Math.min(deltaTime, 50);

      // Run physics steps at fixed intervals
      while (this.timeAccumulator >= fixedStep) {
        this.updateVerletFixedStep(fixedStep, fixedDtRatio);
        this.timeAccumulator -= fixedStep;
      }
    } else {
      // Standard mode: run physics with actual deltaTime
      this.updateVerlet(deltaTime, dtRatio, resuming);
    }
  }

  /**
   * Merge new physics config sent from main thread
   * @param {Object} partialConfig
   */
  applyPhysicsConfig(partialConfig = {}) {
    // Persist merged config on worker (helps future updates)
    this.config.physics = {
      ...(this.config.physics || {}),
      ...partialConfig,
    };

    // Use utility function for validation and merging
    this.settings = validatePhysicsConfig(this.settings, this.config.physics);

    // Cache derived values that don't change during the scene
    const wakeUpThreshold = this.config.physics.wakeUpThreshold ?? PHYSICS_DEFAULTS.wakeUpThreshold;
    this._wakeUpThresholdSq = wakeUpThreshold * wakeUpThreshold;
    this._sleepThreshold = this.config.physics.sleepThreshold ?? PHYSICS_DEFAULTS.sleepThreshold;
    this._sleepingEnabled = this.config.physics.sleeping ?? PHYSICS_DEFAULTS.sleeping;
  }

  handleCustomMessage(data) {
    if (data.msg === 'updatePhysicsConfig') {
      this.applyPhysicsConfig(data.config || {});
    }
  }

  /**
   * Build a dense array of active colliders that ACTUALLY have collision candidates.
   * This runs ONCE per frame, eliminating thousands of empty loop iterations in sub-stepping.
   */
  buildDenseColliders() {
    if (!this._cachedColliderEntities) {
      this._cachedColliderEntities = this.queryActiveEntities([Collider]);
    }
    const colliderEntities = this._cachedColliderEntities;
    const colliderCount = colliderEntities.length;

    if (!this._denseColliders || this._denseColliders.length < colliderCount) {
      this._denseColliders = new Uint16Array(Math.max(colliderCount, 1024));
    }

    const denseColliders = this._denseColliders;
    let denseCount = 0;

    const neighborData = Grid.neighborData;
    const stride = Grid._stride;
    const colliderActive = Collider.active;

    for (let idx = 0; idx < colliderCount; idx++) {
      const i = colliderEntities[idx];
      if (colliderActive[i]) {
        if (neighborData[i * stride + 1] > 0) {
          denseColliders[denseCount++] = i;
        }
      }
    }

    this._denseColliderCount = denseCount;
  }

  /**
   * Verlet Integration Physics (RopeBall-style)
   * Uses position-based dynamics with constraint solving
   * More stable for particle systems and large numbers of colliding objects
   */
  updateVerlet(deltaTime, dtRatio, resuming) {
    // PERFORMANCE OPTIMIZATION: Cache TypedArray references locally
    // These are NOT copying data - they're caching references to avoid property lookups.
    // Each "Transform.x" access requires a property lookup. By caching the reference once,
    // we eliminate thousands of property lookups per frame (one per entity per iteration).
    // Local const variables are faster than "this.x" because:
    //   1. JIT can store them in CPU registers
    //   2. No object property chain traversal
    //   3. Clear scope boundaries help compiler optimization
    // DO NOT move these to instance properties (this.x) - that would be slower!
    const active = Transform.active;
    const rigidBodyActive = RigidBody.active;
    const colliderActive = Collider.active;
    const x = Transform.x;
    const y = Transform.y;
    const rotation = Transform.rotation;
    const px = RigidBody.px;
    const py = RigidBody.py;
    const vx = RigidBody.vx;
    const vy = RigidBody.vy;
    const ax = RigidBody.ax;
    const ay = RigidBody.ay;
    const maxVel = RigidBody.maxVel;
    const collisionCount = RigidBody.collisionCount;

    // Collider properties
    const shapeType = Collider.shapeType;
    const radius = Collider.radius;
    const width = Collider.width;
    const height = Collider.height;
    const isTrigger = Collider.isTrigger;

    const offsetX = Collider.offsetX;
    const offsetY = Collider.offsetY;

    // // Get world bounds for boundary constraints
    // const worldWidth = this.config.worldWidth;
    // const worldHeight = this.config.worldHeight;

    // Get the number of entities with RigidBody (not all entities have physics)
    // const rigidBodyCount = this.globalEntityCount;

    // OPTIMIZATION: Use queryActiveEntities to reset collision counters only for active physics entities
    // Cache query result to avoid repeated calls in the same frame
    if (!this._cachedPhysicsEntities) {
      this._cachedPhysicsEntities = this.queryActiveEntities([RigidBody]);
    }
    const physicsEntities = this._cachedPhysicsEntities;
    this.rigidBodyCount = physicsEntities.length;

    for (let idx = 0; idx < this.rigidBodyCount; idx++) {
      const i = physicsEntities[idx];
      collisionCount[i] = 0;
    }

    const gx = this.settings.gravity.x;
    const gy = this.settings.gravity.y;

    // Step 1: Move entities using Verlet integration
    const shouldProfile = !!this.stats;
    let startTime = shouldProfile ? performance.now() : 0;
    this.moveEntitiesVerlet(
      active,
      rigidBodyActive,
      x,
      y,
      px,
      py,
      vx,
      vy,
      ax,
      ay,
      dtRatio,
      gx,
      gy,
      maxVel
    );
    if (shouldProfile) {
      this.moveTimeThisFrame += performance.now() - startTime;
    }

    // Step 2: Apply constraints (collisions, boundary) with sub-stepping
    for (let step = 0; step < this.settings.subStepCount; step++) {
      startTime = shouldProfile ? performance.now() : 0;
      this.resolveCollisionsVerlet(
        active,
        rigidBodyActive,
        colliderActive,
        x,
        y,
        offsetX,
        offsetY,
        shapeType,
        radius,
        width,
        height,
        isTrigger,
        collisionCount
      );
      if (shouldProfile) {
        this.collisionSolveTimeThisFrame += performance.now() - startTime;
      }

      // Solve distance constraints (position-based dynamics)
      if (this.constraintsEnabled) {
        const distIters = this.settings.distanceConstraintIterations;
        for (let it = 0; it < distIters; it++) {
          this.solveDistanceConstraints(x, y, active);
        }
      }
    }

    // Keep velocity arrays consistent with final post-collision positions.
    // moveEntitiesVerlet() computes vx/vy before collision correction.
    const invDtRatio = dtRatio !== 0 ? 1 / dtRatio : 0;
    this.syncVelocitiesFromPositions(
      physicsEntities,
      this.rigidBodyCount,
      rigidBodyActive,
      RigidBody.static,
      x,
      y,
      px,
      py,
      vx,
      vy,
      invDtRatio
    );
  }

  /**
   * Fixed-step Verlet update for use with accumulator (noLimitFPS mode)
   * Runs movement + collision resolve + distance-constraint sweeps per call. The accumulator loop handles substepping.
   * This ensures physics runs at a consistent rate regardless of actual frame rate.
   * OPTIMIZED: Uses query system to iterate only entities with physics components
   */
  updateVerletFixedStep(fixedDeltaTime, fixedDtRatio) {
    // PERFORMANCE OPTIMIZATION: Cache TypedArray references (see updateVerlet for full explanation)
    // These local consts eliminate property lookups in hot loops - DO NOT move to instance properties!
    const active = Transform.active;
    const rigidBodyActive = RigidBody.active;
    const colliderActive = Collider.active;
    const x = Transform.x;
    const y = Transform.y;
    const px = RigidBody.px;
    const py = RigidBody.py;
    const vx = RigidBody.vx;
    const vy = RigidBody.vy;
    const ax = RigidBody.ax;
    const ay = RigidBody.ay;
    const maxVel = RigidBody.maxVel;
    const collisionCount = RigidBody.collisionCount;

    // Collider properties
    const shapeType = Collider.shapeType;
    const radius = Collider.radius;
    const width = Collider.width;
    const height = Collider.height;
    const isTrigger = Collider.isTrigger;
    const offsetX = Collider.offsetX;
    const offsetY = Collider.offsetY;

    // // Get world bounds for boundary constraints
    // const worldWidth = this.config.worldWidth;
    // const worldHeight = this.config.worldHeight;

    // Get the number of entities with RigidBody
    // const rigidBodyCount = RigidBody.px?.length || 0;

    // OPTIMIZATION: Use queryActiveEntities to reset collision counters only for active physics entities
    // Note: In fixed step mode, we reset per-step to avoid accumulation issues
    // Cache query result to avoid repeated calls in the same frame
    if (!this._cachedPhysicsEntities) {
      this._cachedPhysicsEntities = this.queryActiveEntities([RigidBody]);
    }
    const physicsEntities = this._cachedPhysicsEntities;
    const rigidBodyCount = physicsEntities.length;
    for (let idx = 0; idx < rigidBodyCount; idx++) {
      const i = physicsEntities[idx];
      collisionCount[i] = 0;
    }

    const gx = this.settings.gravity.x;
    const gy = this.settings.gravity.y;

    // Step 1: Move entities using Verlet integration with fixed timestep
    const shouldProfile = !!this.stats;
    let startTime = shouldProfile ? performance.now() : 0;
    this.moveEntitiesVerlet(
      active,
      rigidBodyActive,
      x,
      y,
      px,
      py,
      vx,
      vy,
      ax,
      ay,
      fixedDtRatio,
      gx,
      gy,
      maxVel
    );
    if (shouldProfile) {
      this.moveTimeThisFrame += performance.now() - startTime;
    }

    // Step 2: Apply constraints per fixed step (substepping is handled by accumulator)
    startTime = shouldProfile ? performance.now() : 0;
    this.resolveCollisionsVerlet(
      active,
      rigidBodyActive,
      colliderActive,
      x,
      y,
      offsetX,
      offsetY,
      shapeType,
      radius,
      width,
      height,
      isTrigger,
      collisionCount
    );
    if (shouldProfile) {
      this.collisionSolveTimeThisFrame += performance.now() - startTime;
    }

    // Solve distance constraints (position-based dynamics)
    if (this.constraintsEnabled) {
      const distIters = this.settings.distanceConstraintIterations;
      for (let it = 0; it < distIters; it++) {
        this.solveDistanceConstraints(x, y, active);
      }
    }

    // Keep velocity arrays consistent with final post-collision positions.
    const invFixedDtRatio = fixedDtRatio !== 0 ? 1 / fixedDtRatio : 0;
    this.syncVelocitiesFromPositions(
      physicsEntities,
      rigidBodyCount,
      rigidBodyActive,
      RigidBody.static,
      x,
      y,
      px,
      py,
      vx,
      vy,
      invFixedDtRatio
    );
  }

  syncVelocitiesFromPositions(
    physicsEntities,
    count,
    rigidBodyActive,
    isStatic,
    x,
    y,
    px,
    py,
    vx,
    vy,
    invDtRatio
  ) {
    if (count === 0) return;

    for (let idx = 0; idx < count; idx++) {
      const i = physicsEntities[idx];
      if (!rigidBodyActive[i]) continue;

      if (isStatic[i]) {
        vx[i] = 0;
        vy[i] = 0;
      } else {
        vx[i] = (x[i] - px[i]) * invDtRatio;
        vy[i] = (y[i] - py[i]) * invDtRatio;
      }
    }
  }

  /**
   * Ensure OBB cos/sin scratch buffers can index every entity id used this pass.
   */
  _ensureObbCache(neededLen) {
    if (this._obbCacheLen >= neededLen) return;
    const len = Math.max(neededLen, 1024);
    this._obbCos = new Float32Array(len);
    this._obbSin = new Float32Array(len);
    this._obbCacheLen = len;
  }

  /**
   * Fill cos/sin for EVERY active OrientedBox (dense + neighbors / static OBBs).
   * Runs once per resolve pass so the pair loop never calls Math.cos/sin.
   * AABB Box uses identity (1,0) without a cache write.
   */
  _fillObbOrientationCache(shapeType, rotation) {
    const entities = this._cachedColliderEntities;
    if (!entities) return;

    const count = entities.length;
    let maxIndex = 0;
    for (let idx = 0; idx < count; idx++) {
      const i = entities[idx];
      if (i > maxIndex) maxIndex = i;
    }
    // Dense by entity id — only grow to highest active collider index + 1
    this._ensureObbCache(maxIndex + 1);

    const cosArr = this._obbCos;
    const sinArr = this._obbSin;

    for (let idx = 0; idx < count; idx++) {
      const i = entities[idx];
      if (shapeType[i] === SHAPE_ORIENTED_BOX) {
        const th = rotation[i];
        cosArr[i] = Math.cos(th);
        sinArr[i] = Math.sin(th);
      }
    }
  }

  /**
   * Move entities using Verlet integration
   * Works for both circles and boxes - shape doesn't affect movement
   * OPTIMIZED: Uses query system to iterate only entities with RigidBody
   */
  moveEntitiesVerlet(
    active,
    rigidBodyActive,
    x,
    y,
    px,
    py,
    vx,
    vy,
    ax,
    ay,
    dtRatio,
    gx,
    gy,
    maxVel
  ) {
    const damping = this.settings.verletDamping;
    const isStatic = RigidBody.static;
    const friction = RigidBody.friction;
    const sleeping = RigidBody.sleeping;
    const rotation = Transform.rotation;
    const angularVelocity = RigidBody.angularVelocity;
    const angularAccel = RigidBody.angularAccel;
    const angularDrag = RigidBody.angularDrag;

    // Use cached values (calculated once in applyPhysicsConfig, not per-frame)
    const wakeUpThresholdSq = this._wakeUpThresholdSq;
    const sleepingEnabled = this._sleepingEnabled;
    const stillnessTime = RigidBody.stillnessTime;

    const gravityScale = dtRatio * dtRatio;
    const invDtRatio = dtRatio !== 0 ? 1 / dtRatio : 0;

    // Fused angular integrate — one body, called from each unroll lane
    const integrateAngular = (i) => {
      let omega = angularVelocity[i] + angularAccel[i] * dtRatio;
      const ad = angularDrag[i];
      if (ad > 0) {
        const keep = 1 - ad * dtRatio;
        omega *= keep > 0 ? keep : 0;
      }
      angularVelocity[i] = omega;
      angularAccel[i] = 0;
      if (omega !== 0) rotation[i] += omega * dtRatio;
    };

    // Use cached query result from updateVerlet/updateVerletFixedStep
    // This avoids redundant queryActiveEntities calls per frame
    const physicsEntities = this._cachedPhysicsEntities;

    const physicsCount = physicsEntities.length;
    let idx = 0;

    // Manual 4-way unrolling keeps the hot math in a straighter-line block,
    // which gives the JIT a better chance to optimize this SoA loop.
    for (; idx + 3 < physicsCount; idx += 4) {
      let i = physicsEntities[idx];
      // Note: active[i] and rigidBodyActive[i] checks removed - queryActiveEntities already filters
      if (!(isStatic[i] || (sleepingEnabled && sleeping[i]))) {
        const accX = ax[i] * dtRatio;
        const accY = ay[i] * dtRatio;
        if (accX * accX > wakeUpThresholdSq || accY * accY > wakeUpThresholdSq) {
          sleeping[i] = 0;
          stillnessTime[i] = 0;
        }
        const oldX = x[i];
        const oldY = y[i];
        if (px[i] !== px[i] || py[i] !== py[i]) {
          px[i] = oldX;
          py[i] = oldY;
        }
        let dx = (x[i] - px[i]) * damping;
        let dy = (y[i] - py[i]) * damping;
        if (friction[i] > 0) {
          const frictionFactor = 1 - friction[i] * dtRatio;
          dx *= frictionFactor;
          dy *= frictionFactor;
        }
        dx += gravityScale * gx + accX;
        dy += gravityScale * gy + accY;
        const speedSquared = dx * dx + dy * dy;
        const maxSpeed = maxVel[i] * dtRatio;
        const maxSpeedSquared = maxSpeed * maxSpeed;
        if (speedSquared > maxSpeedSquared) {
          const velScale = maxSpeed / Math.sqrt(speedSquared);
          dx *= velScale;
          dy *= velScale;
        }
        if (dx !== dx || dy !== dy || dx === Infinity || dx === -Infinity || dy === Infinity || dy === -Infinity) {
          px[i] = oldX;
          py[i] = oldY;
          vx[i] = 0;
          vy[i] = 0;
          ax[i] = 0;
          ay[i] = 0;
        } else {
          x[i] = oldX + dx;
          y[i] = oldY + dy;
          px[i] = oldX;
          py[i] = oldY;
          vx[i] = dx * invDtRatio;
          vy[i] = dy * invDtRatio;
          ax[i] = 0;
          ay[i] = 0;
        }
        integrateAngular(i);
      } else if (sleepingEnabled && sleeping[i]) {
        px[i] = x[i];
        py[i] = y[i];
        ax[i] = 0;
        ay[i] = 0;
      }

      i = physicsEntities[idx + 1];
      if (!(isStatic[i] || (sleepingEnabled && sleeping[i]))) {
        const accX = ax[i] * dtRatio;
        const accY = ay[i] * dtRatio;
        if (accX * accX > wakeUpThresholdSq || accY * accY > wakeUpThresholdSq) {
          sleeping[i] = 0;
          stillnessTime[i] = 0;
        }
        const oldX = x[i];
        const oldY = y[i];
        if (px[i] !== px[i] || py[i] !== py[i]) {
          px[i] = oldX;
          py[i] = oldY;
        }
        let dx = (x[i] - px[i]) * damping;
        let dy = (y[i] - py[i]) * damping;
        if (friction[i] > 0) {
          const frictionFactor = 1 - friction[i] * dtRatio;
          dx *= frictionFactor;
          dy *= frictionFactor;
        }
        dx += gravityScale * gx + accX;
        dy += gravityScale * gy + accY;
        const speedSquared = dx * dx + dy * dy;
        const maxSpeed = maxVel[i] * dtRatio;
        const maxSpeedSquared = maxSpeed * maxSpeed;
        if (speedSquared > maxSpeedSquared) {
          const velScale = maxSpeed / Math.sqrt(speedSquared);
          dx *= velScale;
          dy *= velScale;
        }
        if (dx !== dx || dy !== dy || dx === Infinity || dx === -Infinity || dy === Infinity || dy === -Infinity) {
          px[i] = oldX;
          py[i] = oldY;
          vx[i] = 0;
          vy[i] = 0;
          ax[i] = 0;
          ay[i] = 0;
        } else {
          x[i] = oldX + dx;
          y[i] = oldY + dy;
          px[i] = oldX;
          py[i] = oldY;
          vx[i] = dx * invDtRatio;
          vy[i] = dy * invDtRatio;
          ax[i] = 0;
          ay[i] = 0;
        }
        integrateAngular(i);
      } else if (sleepingEnabled && sleeping[i]) {
        px[i] = x[i];
        py[i] = y[i];
        ax[i] = 0;
        ay[i] = 0;
      }

      i = physicsEntities[idx + 2];
      if (!(isStatic[i] || (sleepingEnabled && sleeping[i]))) {
        const accX = ax[i] * dtRatio;
        const accY = ay[i] * dtRatio;
        if (accX * accX > wakeUpThresholdSq || accY * accY > wakeUpThresholdSq) {
          sleeping[i] = 0;
          stillnessTime[i] = 0;
        }
        const oldX = x[i];
        const oldY = y[i];
        if (px[i] !== px[i] || py[i] !== py[i]) {
          px[i] = oldX;
          py[i] = oldY;
        }
        let dx = (x[i] - px[i]) * damping;
        let dy = (y[i] - py[i]) * damping;
        if (friction[i] > 0) {
          const frictionFactor = 1 - friction[i] * dtRatio;
          dx *= frictionFactor;
          dy *= frictionFactor;
        }
        dx += gravityScale * gx + accX;
        dy += gravityScale * gy + accY;
        const speedSquared = dx * dx + dy * dy;
        const maxSpeed = maxVel[i] * dtRatio;
        const maxSpeedSquared = maxSpeed * maxSpeed;
        if (speedSquared > maxSpeedSquared) {
          const velScale = maxSpeed / Math.sqrt(speedSquared);
          dx *= velScale;
          dy *= velScale;
        }
        if (dx !== dx || dy !== dy || dx === Infinity || dx === -Infinity || dy === Infinity || dy === -Infinity) {
          px[i] = oldX;
          py[i] = oldY;
          vx[i] = 0;
          vy[i] = 0;
          ax[i] = 0;
          ay[i] = 0;
        } else {
          x[i] = oldX + dx;
          y[i] = oldY + dy;
          px[i] = oldX;
          py[i] = oldY;
          vx[i] = dx * invDtRatio;
          vy[i] = dy * invDtRatio;
          ax[i] = 0;
          ay[i] = 0;
        }
        integrateAngular(i);
      } else if (sleepingEnabled && sleeping[i]) {
        px[i] = x[i];
        py[i] = y[i];
        ax[i] = 0;
        ay[i] = 0;
      }

      i = physicsEntities[idx + 3];
      if (!(isStatic[i] || (sleepingEnabled && sleeping[i]))) {
        const accX = ax[i] * dtRatio;
        const accY = ay[i] * dtRatio;
        if (accX * accX > wakeUpThresholdSq || accY * accY > wakeUpThresholdSq) {
          sleeping[i] = 0;
          stillnessTime[i] = 0;
        }
        const oldX = x[i];
        const oldY = y[i];
        if (px[i] !== px[i] || py[i] !== py[i]) {
          px[i] = oldX;
          py[i] = oldY;
        }
        let dx = (x[i] - px[i]) * damping;
        let dy = (y[i] - py[i]) * damping;
        if (friction[i] > 0) {
          const frictionFactor = 1 - friction[i] * dtRatio;
          dx *= frictionFactor;
          dy *= frictionFactor;
        }
        dx += gravityScale * gx + accX;
        dy += gravityScale * gy + accY;
        const speedSquared = dx * dx + dy * dy;
        const maxSpeed = maxVel[i] * dtRatio;
        const maxSpeedSquared = maxSpeed * maxSpeed;
        if (speedSquared > maxSpeedSquared) {
          const velScale = maxSpeed / Math.sqrt(speedSquared);
          dx *= velScale;
          dy *= velScale;
        }
        if (dx !== dx || dy !== dy || dx === Infinity || dx === -Infinity || dy === Infinity || dy === -Infinity) {
          px[i] = oldX;
          py[i] = oldY;
          vx[i] = 0;
          vy[i] = 0;
          ax[i] = 0;
          ay[i] = 0;
        } else {
          x[i] = oldX + dx;
          y[i] = oldY + dy;
          px[i] = oldX;
          py[i] = oldY;
          vx[i] = dx * invDtRatio;
          vy[i] = dy * invDtRatio;
          ax[i] = 0;
          ay[i] = 0;
        }
        integrateAngular(i);
      } else if (sleepingEnabled && sleeping[i]) {
        px[i] = x[i];
        py[i] = y[i];
        ax[i] = 0;
        ay[i] = 0;
      }
    }

    for (; idx < physicsCount; idx++) {
      const i = physicsEntities[idx];
      // Note: active[i] and rigidBodyActive[i] checks removed - queryActiveEntities already filters

      // Combined static + sleeping early-out (single branch for non-moving entities)
      if (isStatic[i] || (sleepingEnabled && sleeping[i])) {
        if (sleepingEnabled && sleeping[i]) {
          px[i] = x[i];
          py[i] = y[i];
          ax[i] = 0;
          ay[i] = 0;
        }
        continue;
      }

      const accX = ax[i] * dtRatio;
      const accY = ay[i] * dtRatio;

      // Wake-up check: use squared comparison to avoid Math.abs overhead
      if (accX * accX > wakeUpThresholdSq || accY * accY > wakeUpThresholdSq) {
        sleeping[i] = 0;
        stillnessTime[i] = 0;
      }

      const oldX = x[i];
      const oldY = y[i];

      // Initialize px/py for newly created entities (NaN !== NaN is faster than isNaN)
      if (px[i] !== px[i] || py[i] !== py[i]) {
        px[i] = oldX;
        py[i] = oldY;
      }

      // Verlet Integration
      let dx = (x[i] - px[i]) * damping;
      let dy = (y[i] - py[i]) * damping;

      // Apply friction using linear approximation (faster than Math.pow)
      if (friction[i] > 0) {
        const frictionFactor = 1 - friction[i] * dtRatio;
        dx *= frictionFactor;
        dy *= frictionFactor;
      }

      dx += gravityScale * gx + accX;
      dy += gravityScale * gy + accY;

      // Velocity clamping using squared comparison (avoids sqrt for most entities)
      const speedSquared = dx * dx + dy * dy;
      const maxSpeed = maxVel[i] * dtRatio;
      const maxSpeedSquared = maxSpeed * maxSpeed;

      if (speedSquared > maxSpeedSquared) {
        const velScale = maxSpeed / Math.sqrt(speedSquared);
        dx *= velScale;
        dy *= velScale;
      }

      // NaN/Infinity safety: if integration produced non-finite values, reset entity motion.
      // Catches bugs in game code (e.g. 0/0 in steering) and the Infinity*0=NaN path
      // in velocity clamping. Without this, one bad frame corrupts the entity permanently.
      if (dx !== dx || dy !== dy || dx === Infinity || dx === -Infinity || dy === Infinity || dy === -Infinity) {
        px[i] = oldX;
        py[i] = oldY;
        vx[i] = 0;
        vy[i] = 0;
        ax[i] = 0;
        ay[i] = 0;
        continue;
      }

      x[i] = oldX + dx;
      y[i] = oldY + dy;

      px[i] = oldX;
      py[i] = oldY;

      vx[i] = dx * invDtRatio;
      vy[i] = dy * invDtRatio;

      ax[i] = 0;
      ay[i] = 0;

      integrateAngular(i);
    }
  }

  /**
   * Resolve collisions - routes to appropriate handler based on shape types
   */
  resolveCollisionsVerlet(
    active,
    rigidBodyActive,
    colliderActive,
    x,
    y,
    offsetX,
    offsetY,
    shapeType,
    radius,
    width,
    height,
    isTrigger,
    collisionCount
  ) {

    const responseStrength = this.settings.collisionResponseStrength;
    const isStatic = RigidBody.static;
    const invMass = RigidBody.invMass;
    const invInertia = RigidBody.invInertia;
    const angularVelocity = RigidBody.angularVelocity;
    const px = RigidBody.px;
    const py = RigidBody.py;
    const rotation = Transform.rotation;

    let pairCount = 0;
    const collisionData = this.collisionData;
    const maxPairs = this.maxCollisionPairs;

    // PERFORMANCE: Cache Grid arrays locally to avoid method call overhead in hot loop
    const neighborData = Grid.neighborData;
    const stride = Grid._stride;
    const visualRange = Collider.visualRange;
    const collisionLayer = Collider.collisionLayer;
    const collisionMask = Collider.collisionMask;
    const collisionGroupIndex = Collider.collisionGroupIndex;
    const contactFriction = Collider.contactFriction;

    // OPTIMIZATION: Use pre-built dense list of active colliders that ACTUALLY have collision candidates
    // This perfectly bypasses thousands of empty loop iterations in sub-stepping.
    const denseColliders = this._denseColliders;
    const denseCount = this._denseColliderCount;

    if (denseCount === 0) {
      if (collisionData) collisionData[0] = 0;
      return;
    }

    // Cache sleeping array reference for performance
    const sleeping = RigidBody.sleeping;
    const sleepingEnabled = this._sleepingEnabled;
    const collisionResult = this.collisionResult;

    // Stats: local counters in hot loop, write back once (skip entirely if no stats buffer)
    const profile = !!this.stats;
    let checks = 0;
    let resolved = 0;

    // Face lever / slop as fraction of smaller body's min half-extent
    const CROSS_EPS_FRAC = 0.15;
    const PENETRATION_SLOP_FRAC = 0.0375;
    // Below this |vn| (step displacement) + shallow: resting — no Δθ, damp spin
    // Never sync invent with PBD (that invents separation velocity = jumps).
    const REST_VN = 0.35;
    const REST_OMEGA_KEEP = 0.85;
    // Squared epsilon for tangential relative velocity (skip friction if smaller)
    const VT_EPS2 = 1e-8;
    const gx = this.settings.gravity?.x || 0;
    const gy = this.settings.gravity?.y || 0;
    // Gravity support impulse scale (step-displacement units; matches Verlet gravity ≈ g)
    const gravityScale = 1;

    // Precompute cos/sin for all OrientedBoxes once per resolve (no trig in pair loop)
    this._fillObbOrientationCache(shapeType, rotation);
    const obbCos = this._obbCos;
    const obbSin = this._obbSin;

    for (let idx = 0; idx < denseCount; idx++) {
      const i = denseColliders[idx];
      // Note: active[i], colliderActive[i], and candidateCount > 0 are already checked in buildDenseColliders

      // Direct array access (no method call overhead)
      // Layout: [totalCount, collisionCount, neighbors...]
      // Physics only iterates collision candidates (first collisionCount neighbors)
      const offset = i * stride;
      const collisionCandidateCount = neighborData[offset + 1];

      // HOISTED: Access entity 'i' properties ONCE outside the inner loop
      const shapeI = shapeType[i];
      const radiusI = radius[i];
      const widthI = width[i];
      const heightI = height[i];
      const halfMinI =
        shapeI === SHAPE_CIRCLE
          ? radiusI
          : (widthI < heightI ? widthI : heightI) * 0.5;
      // Hoist offsets (invariant) but NOT position (variant)
      const offXi = offsetX[i];
      const offYi = offsetY[i];
      let cosI = shapeI === SHAPE_ORIENTED_BOX ? obbCos[i] : 1;
      let sinI = shapeI === SHAPE_ORIENTED_BOX ? obbSin[i] : 0;
      // World-space offset for OrientedBox; axis-aligned add for Circle/AABB
      let worldOffXi = shapeI === SHAPE_ORIENTED_BOX ? cosI * offXi - sinI * offYi : offXi;
      let worldOffYi = shapeI === SHAPE_ORIENTED_BOX ? sinI * offXi + cosI * offYi : offYi;

      // NOTE: colliderX_i / colliderY_i CANNOT be hoisted arbitrarily because x[i]/y[i]
      // change during the loop as collisions are resolved!
      // But reading from SAB over and over is slow, so we cache it in a local register and update when it moves.
      let localXi = x[i];
      let localYi = y[i];

      // OPTIMIZATION: Cache entity i's layer/mask/group and static/sleeping state outside the loop
      const layerBitI = 1 << (collisionLayer[i] & 31);
      const maskI = collisionMask[i];
      const groupI = collisionGroupIndex[i];
      const iHasRigidBody = rigidBodyActive[i];
      const iStatic = !iHasRigidBody || isStatic[i];
      const iSleeping = sleepingEnabled && iHasRigidBody && sleeping[i];
      const muI = contactFriction[i];

      // Iterate only collision candidates (partitioned by spatial worker)
      // Filter order: cheapest rejects first (dedupe before RB / mask loads)
      for (let n = 0; n < collisionCandidateCount; n++) {
        const j = neighborData[offset + 2 + n];

        // 1. Self
        if (i === j) continue;

        // 2. Pair once (~half of candidates). Keep pairs where j can't see (visualRange=0 static)
        if (i >= j && visualRange[j] > 0) continue;

        // 3. Inactive
        if (!active[j] || !colliderActive[j]) continue;

        // 4. Static–static (no motion possible)
        const jHasRigidBody = rigidBodyActive[j];
        const jStatic = !jHasRigidBody || isStatic[j];
        if (iStatic && jStatic) continue;

        // 5. Sleeping–sleeping — only load sleeping[j] when i itself sleeps
        if (iSleeping && jHasRigidBody && sleeping[j]) continue;

        // 6. Group / layer mask
        const groupJ = collisionGroupIndex[j];
        if (groupI !== 0 && groupI === groupJ) {
          if (groupI < 0) continue;
          // groupI > 0: always collide — skip layer/mask check
        } else {
          const layerBitJ = 1 << (collisionLayer[j] & 31);
          if (!(layerBitI & collisionMask[j]) || !(layerBitJ & maskI)) continue;
        }

        // Get shape type for neighbor 'j'
        const shapeJ = shapeType[j];
        // OrientedBox basis from per-pass cache (AABB / circle → identity)
        const cosJ = shapeJ === SHAPE_ORIENTED_BOX ? obbCos[j] : 1;
        const sinJ = shapeJ === SHAPE_ORIENTED_BOX ? obbSin[j] : 0;
        const offXj = offsetX[j];
        const offYj = offsetY[j];
        const worldOffXj = shapeJ === SHAPE_ORIENTED_BOX ? cosJ * offXj - sinJ * offYj : offXj;
        const worldOffYj = shapeJ === SHAPE_ORIENTED_BOX ? sinJ * offXj + cosJ * offYj : offYj;

        // Calculate offset-adjusted collider positions
        // We MUST re-calculate i's position here because it might have moved
        // in a previous iteration of this same loop (multi-collision)
        const colliderX_i = localXi + worldOffXi;
        const colliderY_i = localYi + worldOffYi;

        const colliderX_j = x[j] + worldOffXj;
        const colliderY_j = y[j] + worldOffYj;

        // Collision result: { collided, depth, nx, ny, cx, cy }
        let result = null;

        if (profile) checks++;

        if (shapeI === SHAPE_CIRCLE && shapeJ === SHAPE_CIRCLE) {
          // Inlined circle–circle (hottest path — no call overhead)
          const dx = colliderX_i - colliderX_j;
          const dy = colliderY_i - colliderY_j;
          const dist2 = dx * dx + dy * dy;
          const minDist = radiusI + radius[j];
          if (dist2 >= minDist * minDist) {
            result = null;
          } else {
            const dist = Math.sqrt(dist2);
            collisionResult.collided = true;
            if (dist === 0) {
              collisionResult.depth = minDist;
              collisionResult.nx = 1;
              collisionResult.ny = 0;
            } else {
              const invD = 1 / dist;
              collisionResult.depth = minDist - dist;
              collisionResult.nx = dx * invD;
              collisionResult.ny = dy * invD;
            }
            collisionResult.cx = (colliderX_i + colliderX_j) * 0.5;
            collisionResult.cy = (colliderY_i + colliderY_j) * 0.5;
            result = collisionResult;
          }
        } else if (shapeI === SHAPE_CIRCLE && shapeJ === SHAPE_BOX) {
          // Inlined circle–AABB
          const halfW = width[j] * 0.5;
          const halfH = height[j] * 0.5;
          const minX = colliderX_j - halfW;
          const maxX = colliderX_j + halfW;
          const minY = colliderY_j - halfH;
          const maxY = colliderY_j + halfH;
          const closestX = colliderX_i < minX ? minX : colliderX_i > maxX ? maxX : colliderX_i;
          const closestY = colliderY_i < minY ? minY : colliderY_i > maxY ? maxY : colliderY_i;
          const dx = colliderX_i - closestX;
          const dy = colliderY_i - closestY;
          const dist2 = dx * dx + dy * dy;
          const r = radiusI;
          if (dist2 >= r * r) {
            result = null;
          } else {
            const dist = Math.sqrt(dist2);
            collisionResult.collided = true;
            if (dist === 0) {
              const distToLeft = colliderX_i - minX;
              const distToRight = maxX - colliderX_i;
              const distToTop = colliderY_i - minY;
              const distToBottom = maxY - colliderY_i;
              const minDistX = distToLeft < distToRight ? distToLeft : distToRight;
              const minDistY = distToTop < distToBottom ? distToTop : distToBottom;
              if (minDistX < minDistY) {
                collisionResult.depth = minDistX + r;
                collisionResult.nx = distToLeft < distToRight ? -1 : 1;
                collisionResult.ny = 0;
              } else {
                collisionResult.depth = minDistY + r;
                collisionResult.nx = 0;
                collisionResult.ny = distToTop < distToBottom ? -1 : 1;
              }
            } else {
              const invD = 1 / dist;
              collisionResult.depth = r - dist;
              collisionResult.nx = dx * invD;
              collisionResult.ny = dy * invD;
            }
            collisionResult.cx = closestX;
            collisionResult.cy = closestY;
            result = collisionResult;
          }
        } else if (shapeI === SHAPE_BOX && shapeJ === SHAPE_CIRCLE) {
          // Inlined AABB–circle (swap + invert normal)
          const halfW = widthI * 0.5;
          const halfH = heightI * 0.5;
          const minX = colliderX_i - halfW;
          const maxX = colliderX_i + halfW;
          const minY = colliderY_i - halfH;
          const maxY = colliderY_i + halfH;
          const cjx = colliderX_j;
          const cjy = colliderY_j;
          const closestX = cjx < minX ? minX : cjx > maxX ? maxX : cjx;
          const closestY = cjy < minY ? minY : cjy > maxY ? maxY : cjy;
          const dx = cjx - closestX;
          const dy = cjy - closestY;
          const dist2 = dx * dx + dy * dy;
          const r = radius[j];
          if (dist2 >= r * r) {
            result = null;
          } else {
            const dist = Math.sqrt(dist2);
            collisionResult.collided = true;
            if (dist === 0) {
              const distToLeft = cjx - minX;
              const distToRight = maxX - cjx;
              const distToTop = cjy - minY;
              const distToBottom = maxY - cjy;
              const minDistX = distToLeft < distToRight ? distToLeft : distToRight;
              const minDistY = distToTop < distToBottom ? distToTop : distToBottom;
              if (minDistX < minDistY) {
                collisionResult.depth = minDistX + r;
                collisionResult.nx = distToLeft < distToRight ? 1 : -1; // inverted vs circle-box
                collisionResult.ny = 0;
              } else {
                collisionResult.depth = minDistY + r;
                collisionResult.nx = 0;
                collisionResult.ny = distToTop < distToBottom ? 1 : -1;
              }
            } else {
              const invD = 1 / dist;
              collisionResult.depth = r - dist;
              collisionResult.nx = -(dx * invD);
              collisionResult.ny = -(dy * invD);
            }
            collisionResult.cx = closestX;
            collisionResult.cy = closestY;
            result = collisionResult;
          }
        } else if (shapeI === SHAPE_BOX && shapeJ === SHAPE_BOX) {
          // Inlined AABB–AABB
          const halfW1 = widthI * 0.5;
          const halfH1 = heightI * 0.5;
          const halfW2 = width[j] * 0.5;
          const halfH2 = height[j] * 0.5;
          const dx = colliderX_i - colliderX_j;
          const dy = colliderY_i - colliderY_j;
          const adx = dx < 0 ? -dx : dx;
          const ady = dy < 0 ? -dy : dy;
          const overlapX = halfW1 + halfW2 - adx;
          const overlapY = halfH1 + halfH2 - ady;
          if (overlapX <= 0 || overlapY <= 0) {
            result = null;
          } else {
            collisionResult.collided = true;
            if (overlapX < overlapY) {
              collisionResult.depth = overlapX;
              collisionResult.nx = dx > 0 ? 1 : -1;
              collisionResult.ny = 0;
            } else {
              collisionResult.depth = overlapY;
              collisionResult.nx = 0;
              collisionResult.ny = dy > 0 ? 1 : -1;
            }
            collisionResult.cx = (colliderX_i + colliderX_j) * 0.5;
            collisionResult.cy = (colliderY_i + colliderY_j) * 0.5;
            result = collisionResult;
          }
        } else if (shapeI === SHAPE_CIRCLE && shapeJ === SHAPE_ORIENTED_BOX) {
          result = testCircleOBBCollision(
            colliderX_i, colliderY_i, radiusI,
            colliderX_j, colliderY_j, width[j], height[j], cosJ, sinJ,
            collisionResult
          );
        } else if (shapeI === SHAPE_ORIENTED_BOX && shapeJ === SHAPE_CIRCLE) {
          result = testCircleOBBCollision(
            colliderX_j, colliderY_j, radius[j],
            colliderX_i, colliderY_i, widthI, heightI, cosI, sinI,
            collisionResult
          );
          if (result && result.collided) {
            result.nx = -result.nx;
            result.ny = -result.ny;
          }
        } else if (
          (shapeI === SHAPE_ORIENTED_BOX || shapeI === SHAPE_BOX) &&
          (shapeJ === SHAPE_ORIENTED_BOX || shapeJ === SHAPE_BOX) &&
          (shapeI === SHAPE_ORIENTED_BOX || shapeJ === SHAPE_ORIENTED_BOX)
        ) {
          // OrientedBox–OrientedBox or Box–OrientedBox (AABB uses cos=1, sin=0)
          const cI = shapeI === SHAPE_ORIENTED_BOX ? cosI : 1;
          const sI = shapeI === SHAPE_ORIENTED_BOX ? sinI : 0;
          const cJ = shapeJ === SHAPE_ORIENTED_BOX ? cosJ : 1;
          const sJ = shapeJ === SHAPE_ORIENTED_BOX ? sinJ : 0;
          result = testOBBOBBCollision(
            colliderX_i, colliderY_i, widthI, heightI, cI, sI,
            colliderX_j, colliderY_j, width[j], height[j], cJ, sJ,
            collisionResult
          );
        }

        if (!result || !result.collided) continue;

        if (profile) resolved++;

        const eitherIsTrigger = isTrigger[i] || isTrigger[j];

        // Apply physical response if neither is a trigger
        // Step F: slop — skip micro-overlaps so stacks can settle / sleep (wake only when resolving)
        if (!eitherIsTrigger) {
          const halfMinJ =
            shapeJ === SHAPE_CIRCLE
              ? radius[j]
              : (width[j] < height[j] ? width[j] : height[j]) * 0.5;
          const minHalf = halfMinI < halfMinJ ? halfMinI : halfMinJ;
          const crossEps = minHalf * CROSS_EPS_FRAC;
          const penetrationSlop = minHalf * PENETRATION_SLOP_FRAC;
          const depthEff = result.depth - penetrationSlop;
          if (depthEff > 0) {
            // Wake only on meaningful penetration (micro jitter must not reset sleep)
            const wakeDepth = penetrationSlop > 1e-6 ? penetrationSlop : 0.5;
            if (depthEff > wakeDepth) {
              if (iHasRigidBody && iSleeping) {
                sleeping[i] = 0;
                RigidBody.stillnessTime[i] = 0;
              }
              if (jHasRigidBody && sleepingEnabled && sleeping[j]) {
                sleeping[j] = 0;
                RigidBody.stillnessTime[j] = 0;
              }
            }

            const correction = depthEff * responseStrength;
            const nx = result.nx;
            const ny = result.ny;
            const cx = result.cx;
            const cy = result.cy;

            const invMassI = iStatic ? 0 : invMass[i];
            const invMassJ = jStatic ? 0 : invMass[j];
            const totalInvMass = invMassI + invMassJ;

            if (totalInvMass > 0) {
              // Circles: rotationally symmetric — no collision torque / sprite spin.
              const invII =
                iStatic || shapeI === SHAPE_CIRCLE ? 0 : invInertia[i];
              const invIJ =
                jStatic || shapeJ === SHAPE_CIRCLE ? 0 : invInertia[j];
              const rix = cx - localXi;
              const riy = cy - localYi;
              const rjx = cx - x[j];
              const rjy = cy - y[j];
              const crossI = rix * ny - riy * nx;
              const crossJ = -rjx * ny + rjy * nx;

              // PBD effective mass: include angular or corner hits explode vs static floors
              const invMassAng =
                totalInvMass +
                crossI * crossI * invII +
                crossJ * crossJ * invIJ;
              const lambda = correction / invMassAng;

              // Pre-positional vn for resting detect (torque gate only — never invent sync)
              let vix0 = 0;
              let viy0 = 0;
              let vjx0 = 0;
              let vjy0 = 0;
              if (!iStatic && iHasRigidBody) {
                vix0 = localXi - px[i];
                viy0 = localYi - py[i];
                if (invII > 0) {
                  const wi = angularVelocity[i];
                  vix0 += -wi * riy;
                  viy0 += wi * rix;
                }
              }
              if (!jStatic && jHasRigidBody) {
                vjx0 = x[j] - px[j];
                vjy0 = y[j] - py[j];
                if (invIJ > 0) {
                  const wj = angularVelocity[j];
                  vjx0 += -wj * rjy;
                  vjy0 += wj * rjx;
                }
              }
              const vn0 = (vix0 - vjx0) * nx + (viy0 - vjy0) * ny;
              const absVn0 = vn0 < 0 ? -vn0 : vn0;
              const shallow =
                depthEff <
                Math.max(penetrationSlop * 6, minHalf * 0.12);
              const resting = absVn0 < REST_VN && shallow;

              // Move x only — leave invent so PBD eats approach, does not invent bounce
              x[i] = localXi += nx * (lambda * invMassI);
              y[i] = localYi += ny * (lambda * invMassI);
              x[j] -= nx * (lambda * invMassJ);
              y[j] -= ny * (lambda * invMassJ);

              // Face-ish / resting: no Δθ (off-center support rock). Impacts may tip.
              const hitStatic = iStatic || jStatic;
              const allowTorque = !resting && !shallow;
              if (invII > 0) {
                const absCross = crossI < 0 ? -crossI : crossI;
                if (allowTorque && absCross > crossEps) {
                  const dTh = crossI * invII * lambda;
                  rotation[i] += dTh;
                  if (shapeI === SHAPE_ORIENTED_BOX) {
                    const c = cosI;
                    const s = sinI;
                    cosI = c - s * dTh;
                    sinI = s + c * dTh;
                    const invLen = 1.5 - 0.5 * (cosI * cosI + sinI * sinI);
                    cosI *= invLen;
                    sinI *= invLen;
                    worldOffXi = cosI * offXi - sinI * offYi;
                    worldOffYi = sinI * offXi + cosI * offYi;
                    obbCos[i] = cosI;
                    obbSin[i] = sinI;
                  }
                } else if (hitStatic || resting || shallow || absCross <= crossEps) {
                  angularVelocity[i] *= resting || shallow ? REST_OMEGA_KEEP : 0.8;
                }
              }
              if (invIJ > 0) {
                const absCross = crossJ < 0 ? -crossJ : crossJ;
                if (allowTorque && absCross > crossEps) {
                  const dTh = crossJ * invIJ * lambda;
                  rotation[j] += dTh;
                  if (shapeJ === SHAPE_ORIENTED_BOX) {
                    const c = obbCos[j];
                    const s = obbSin[j];
                    let cj = c - s * dTh;
                    let sj = s + c * dTh;
                    const invLen = 1.5 - 0.5 * (cj * cj + sj * sj);
                    cj *= invLen;
                    sj *= invLen;
                    obbCos[j] = cj;
                    obbSin[j] = sj;
                  }
                } else if (hitStatic || resting || shallow || absCross <= crossEps) {
                  angularVelocity[j] *= resting || shallow ? REST_OMEGA_KEEP : 0.8;
                }
              }

              // Contact friction: min combine + Coulomb clamp (μ * |jn|)
              const muJ = contactFriction[j];
              if (muI > 0 && muJ > 0) {
                const mu = muI < muJ ? muI : muJ;

                let vix = 0;
                let viy = 0;
                let vjx = 0;
                let vjy = 0;
                if (!iStatic && iHasRigidBody) {
                  vix = localXi - px[i];
                  viy = localYi - py[i];
                  if (invII > 0) {
                    const wi = angularVelocity[i];
                    vix += -wi * riy;
                    viy += wi * rix;
                  }
                }
                if (!jStatic && jHasRigidBody) {
                  vjx = x[j] - px[j];
                  vjy = y[j] - py[j];
                  if (invIJ > 0) {
                    const wj = angularVelocity[j];
                    vjx += -wj * rjy;
                    vjy += wj * rjx;
                  }
                }

                const rvx = vix - vjx;
                const rvy = viy - vjy;
                const vn = rvx * nx + rvy * ny;
                const vtx = rvx - vn * nx;
                const vty = rvy - vn * ny;
                const vtLen2 = vtx * vtx + vty * vty;

                if (vtLen2 > VT_EPS2) {
                  // |jn| floor: at rest depth→slop so μ·correction ≈ ice without gravity support
                  let jnAbs = correction;
                  {
                    const gAlongN = -(gx * nx + gy * ny) * gravityScale;
                    if (gAlongN > 0) {
                      const jnSupport = gAlongN / invMassAng;
                      if (jnSupport > jnAbs) jnAbs = jnSupport;
                    }
                  }
                  const maxSlide = resting ? mu * jnAbs * 1.25 : mu * jnAbs;
                  const maxSlide2 = maxSlide * maxSlide;
                  let scale;
                  if (vtLen2 <= maxSlide2) {
                    scale = 1;
                  } else {
                    scale = maxSlide / Math.sqrt(vtLen2);
                  }

                  const fdx = vtx * scale;
                  const fdy = vty * scale;
                  const invTotal = 1 / totalInvMass;
                  const wI = invMassI * invTotal;
                  const wJ = invMassJ * invTotal;

                  // Kill tangent vel via px only (same as scaleVelocity). Moving x invents water-motion.
                  if (!iStatic && iHasRigidBody) {
                    px[i] += fdx * wI;
                    py[i] += fdy * wI;
                  }
                  if (!jStatic && jHasRigidBody) {
                    px[j] -= fdx * wJ;
                    py[j] -= fdy * wJ;
                  }

                  // Angular friction — face-gated + mass-weighted; no θ move
                  if (invII > 0) {
                    const absCross = crossI < 0 ? -crossI : crossI;
                    if (absCross > crossEps) {
                      angularVelocity[i] -= (riy * fdx - rix * fdy) * invII * wI;
                    }
                  }
                  if (invIJ > 0) {
                    const absCross = crossJ < 0 ? -crossJ : crossJ;
                    if (absCross > crossEps) {
                      angularVelocity[j] -= (rjx * fdy - rjy * fdx) * invIJ * wJ;
                    }
                  }
                }
              }
            }
          } // depthEff > 0
        }

        // Track collision count
        if (iHasRigidBody) collisionCount[i]++;
        if (jHasRigidBody) collisionCount[j]++;

        // Record collision pair for callbacks
        if (collisionData && pairCount < maxPairs) {
          collisionData[1 + pairCount * 2] = i;
          collisionData[1 + pairCount * 2 + 1] = j;
          pairCount++;
        }
      }
    }

    if (collisionData) {
      collisionData[0] = pairCount;
    }

    // Write stats once per resolve (not per pair)
    if (profile) {
      this.collisionChecksThisFrame += checks;
      this.collisionsResolvedThisFrame += resolved;
      this.collisionPairsThisFrame = pairCount;
    }
  }

  /**
   * Override reportFPS to write stats to SharedArrayBuffer
   */
  reportFPS() {
    // Write stats to SharedArrayBuffer every frame
    if (this.stats) {
      this.stats[PHYSICS_STATS.FPS] = this.currentFPS;
      this.stats[PHYSICS_STATS.COLLISION_CHECKS] = this.collisionChecksThisFrame;
      this.stats[PHYSICS_STATS.COLLISIONS_RESOLVED] = this.collisionsResolvedThisFrame;
      this.stats[PHYSICS_STATS.COLLISION_PAIRS] = this.collisionPairsThisFrame;
      this.stats[PHYSICS_STATS.CONSTRAINT_MS] = this.constraintSolveTimeThisFrame;
      this.stats[PHYSICS_STATS.MSG_MS] = this.messageTimeThisFrame;
      this.stats[PHYSICS_STATS.MOVE_MS] = this.moveTimeThisFrame;
      this.stats[PHYSICS_STATS.COLLISION_MS] = this.collisionSolveTimeThisFrame;
    }
  }

  // ========================================
  // DISTANCE CONSTRAINT SOLVING
  // ========================================

  /**
   * Solve distance constraints using position-based dynamics (PBD)
   * Each constraint maintains a target distance between two entities.
   *
   * Algorithm:
   * 1. For each active constraint, get entity positions
   * 2. Calculate current distance between entities
   * 3. Compute position correction to reach target distance
   * 4. Apply correction scaled by stiffness (split 50/50 between entities)
   *
   * @param {Float32Array} x - Entity X positions
   * @param {Float32Array} y - Entity Y positions
   * @param {Uint8Array} active - Entity active flags
   */
  solveDistanceConstraints(x, y, active) {
    const shouldProfile = !!this.stats;
    const startTime = shouldProfile ? performance.now() : 0;

    const pairs = Constraint.pairs;
    const restLength = Constraint.restLength;
    const stiffness = Constraint.stiffness;
    const constraintActive = Constraint.active;
    const denseConstraints = Constraint.activeIndices;
    const denseConstraintCount = Constraint.getDenseActiveCount();

    if (!constraintActive || !denseConstraints || denseConstraintCount === 0) {
      if (shouldProfile) {
        this.constraintSolveTimeThisFrame += performance.now() - startTime;
      }
      return;
    }

    // Cache RigidBody static flags for mass-weighted response
    const isStatic = RigidBody.static;
    const invMass = RigidBody.invMass;
    const rigidBodyActive = RigidBody.active;

    for (let denseIdx = 0; denseIdx < denseConstraintCount; denseIdx++) {
      const i = denseConstraints[denseIdx];
      if (!constraintActive[i]) continue;

      // Unpack entity indices
      const packed = pairs[i];
      const entityA = packed >>> 16;
      const entityB = packed & 0xFFFF;

      // Skip if either entity is inactive
      if (!active[entityA] || !active[entityB]) continue;

      // Mass-weighted response (similar to collision resolution)
      const aHasRB = rigidBodyActive[entityA];
      const bHasRB = rigidBodyActive[entityB];
      const aStatic = !aHasRB || isStatic[entityA];
      const bStatic = !bHasRB || isStatic[entityB];

      // Get inverse masses (static = 0 = infinite mass)
      const invMassA = aStatic ? 0 : invMass[entityA];
      const invMassB = bStatic ? 0 : invMass[entityB];
      const totalInvMass = invMassA + invMassB;

      // Skip if both are static (no movement possible)
      if (totalInvMass === 0) continue;

      // Get current positions
      const ax = x[entityA];
      const ay = y[entityA];
      const bx = x[entityB];
      const by = y[entityB];

      // Calculate distance vector and current distance
      const dx = bx - ax;
      const dy = by - ay;
      const distSq = dx * dx + dy * dy;

      // Skip if entities are at same position (avoid division by zero)
      if (distSq < MIN_CONSTRAINT_DIST_SQ) continue;

      const currentDist = Math.sqrt(distSq);

      // Calculate error (how far from rest length)
      const targetDist = restLength[i];
      const error = currentDist - targetDist;

      // Skip if already at target distance
      if (error > -CONSTRAINT_ERROR_EPSILON && error < CONSTRAINT_ERROR_EPSILON) continue;

      // Calculate correction direction (normalized)
      const invCurrentDist = 1 / currentDist;
      const nx = dx * invCurrentDist;
      const ny = dy * invCurrentDist;

      // Apply stiffness to correction
      const correction = error * stiffness[i] * 0.5; // 0.5 for relaxation

      // Distribute correction based on mass
      const corrA = correction * (invMassA / totalInvMass);
      const corrB = correction * (invMassB / totalInvMass);

      // Apply position corrections
      // Entity A moves toward B (positive correction)
      // Entity B moves toward A (negative correction)
      x[entityA] += nx * corrA;
      y[entityA] += ny * corrA;
      x[entityB] -= nx * corrB;
      y[entityB] -= ny * corrB;
    }

    if (shouldProfile) {
      this.constraintSolveTimeThisFrame += performance.now() - startTime;
    }
  }
}

// Create singleton instance and setup message handler
const physicsWorker = new PhysicsWorker(self);
self.physicsWorker = physicsWorker;
