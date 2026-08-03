// WeedJS bridge — loaded by box2d_wasm.js (always).
// Owns Module; physics_host.impl.js calls weedjsDoStep in-process.
// Skip on em-pthread pool workers.

(function () {
  if (self.name === 'em-pthread') {
    return;
  }

  importScripts(
    'box2dConstants.impl.js',
    'physics-api.js',
    'box2dCommandRing.impl.js',
    'box2dContactRing.impl.js',
    'box2dContactHitRing.impl.js',
    'box2dJointBreakRing.impl.js',
    'box2dMovedBodies.impl.js',
    'box2dQueryAabb.impl.js',
  );
  const drainBox2dCommandRing = Box2dCommandRing.drainCommandRing;
  const publishBox2dContactEvent = Box2dContactRing.publishContactEvent;
  const CONTACT_KIND = Box2dContactRing.BOX2D_CONTACT_KIND;
  const publishContactHit = Box2dContactHitRing.publishContactHit;
  const publishJointBreak = Box2dJointBreakRing.publishJointBreak;
  const publishMovedBodies = Box2dMovedBodies.publishMovedBodies;
  const bindMovedBodies = Box2dMovedBodies.bindMovedBodies;

  const MAX_POLY_VERTS = 8;
  const BODY_DIRTY = {
    LIFECYCLE: 1,
    BODY_TYPE: 1 << 1,
    DAMPING: 1 << 2,
    MASS: 1 << 3,
    FILTER: 1 << 4,
    FRICTION: 1 << 5,
    GEOMETRY: 1 << 6,
  };
  // Units: px, px/s, px/s², rad, rad/s (Box2D native — no frame-unit scale).

  let world = null;
  let verdletSubSteps = 4;
  /** Set by physics_host before init (weedjsEnableHostMode). */
  let hostMode = false;
  let hostEntityCount = 0;
  let hostSubSteps = 4;
  let hostDt = 0;
  let moduleReady = false;
  const moduleReadyWaiters = [];
  let cmdI32 = null;
  let cmdF32 = null;
  let contactRingI32 = null;
  let hitRingBound = false;
  let jointBreakRingBound = false;
  let views = null;
  let hasBody = null;
  let createFailed = null;
  let denseList = null;
  let densePositions = null;
  let denseCount = 0;
  let lastBodySyncVisited = 0;
  let bodyDirtyFlags = null;
  let bodyDirtyWords = null;
  let bodyGeneration = null;
  let seenBodyGeneration = null;
  let jointViews = null;
  let jointHandle = null; // Int32Array, -1 = none, -2 = fail this revision
  let jointSeenRev = null; // Uint32Array — last synced Joint.revision
  let jointDense = null; // Uint16Array — indices with live WASM handles
  let jointDenseCount = 0;
  let jointLive = null; // Uint8Array scratch (dense-sized marks only)
  let maxJoints = 0;
  let jointCapacityWarn = false;
  let pxChan = null;
  let pyChan = null;
  let rotChan = null;
  let vxChan = null;
  let vyChan = null;
  let angChan = null;
  let sleepingU8 = null;
  let statsF32 = null;

  // Published pose double-buffer (render-queue style): visuals read post-step snapshot
  let poseSync = null; // Int32Array [readyFrame, consumedFrame]
  let poseBuffers = [null, null]; // { x, y, rotation } Float32Array views
  let poseCapacity = 0;
  let poseFrame = 0;

  // Mirrors PHYSICS_STATS in src/workers/workers-utils.js (nested classic worker — no ESM import).
  const PS = {
    BODY_COUNT: 3,
    JOINT_COUNT: 4,
    CONTACT_BEGIN: 5,
    CONTACT_END: 6,
    SENSOR_BEGIN: 7,
    SENSOR_END: 8,
    WEED_JOINTS: 9,
    BODY_SYNC_MS: 10,
    JOINT_SYNC_MS: 11,
    COMMAND_MS: 12,
    FORCE_MS: 13,
    BOX2D_MS: 14,
    POST_MS: 15,
    BODY_SYNC_CHANGES: 16,
    BODY_SYNC_VISITED: 17,
    JOINT_SYNC_CHANGES: 18,
    COMMAND_COUNT: 19,
    COMMAND_OVERFLOW_TOTAL: 20,
    CONTACT_DROPPED: 21,
    SENSOR_DROPPED: 22,
    HEAP_USED_KB: 23,
    HEAP_HIGH_WATER_KB: 24,
    BODY_MOVED_COUNT: 25,
    AWAKE_COUNT: 26,
    PROFILE_STEP_MS: 27,
    PROFILE_COLLIDE_MS: 28,
    PROFILE_SOLVE_MS: 29,
    PROFILE_SLEEP_MS: 30,
    PROFILE_SENSORS_MS: 31,
    COUNTER_CONTACTS: 32,
    COUNTER_ISLANDS: 33,
    COUNTER_AWAKE_CONTACTS: 34,
    COUNTER_TREE_HEIGHT: 35,
  };

  let heapHighWaterKb = 0;
  let weedjsHeapBytesUsed = null;

  function viewFromDesc(desc, TypedArray) {
    return new TypedArray(desc.sab, desc.byteOffset, desc.length);
  }

  function bindWeedViews(desc) {
    // Pose/vel/sleeping are HEAP-only (bound in bindStateChannels). SoA supplies the rest.
    views = {
      entityActive: viewFromDesc(desc.entityActive, Uint8Array),
      x: null,
      y: null,
      rotation: null,
      rbActive: viewFromDesc(desc.rbActive, Uint8Array),
      rbStatic: viewFromDesc(desc.rbStatic, Uint8Array),
      vx: null,
      vy: null,
      ax: viewFromDesc(desc.ax, Float32Array),
      ay: viewFromDesc(desc.ay, Float32Array),
      px: desc.px ? viewFromDesc(desc.px, Float32Array) : null,
      py: desc.py ? viewFromDesc(desc.py, Float32Array) : null,
      pRotation: desc.pRotation
        ? viewFromDesc(desc.pRotation, Float32Array)
        : null,
      angularVelocity: null,
      angularAccel: viewFromDesc(desc.angularAccel, Float32Array),
      mass: viewFromDesc(desc.mass, Float32Array),
      linearDamping: viewFromDesc(desc.linearDamping, Float32Array),
      angularDamping: viewFromDesc(desc.angularDamping, Float32Array),
      sleeping: null,
      fixedRotation: desc.fixedRotation
        ? viewFromDesc(desc.fixedRotation, Uint8Array)
        : null,
      sleepThreshold: desc.sleepThreshold
        ? viewFromDesc(desc.sleepThreshold, Float32Array)
        : null,
      colActive: viewFromDesc(desc.colActive, Uint8Array),
      offsetX: viewFromDesc(desc.offsetX, Float32Array),
      offsetY: viewFromDesc(desc.offsetY, Float32Array),
      shapeType: viewFromDesc(desc.shapeType, Uint8Array),
      radius: viewFromDesc(desc.radius, Float32Array),
      width: viewFromDesc(desc.width, Float32Array),
      height: viewFromDesc(desc.height, Float32Array),
      isTrigger: viewFromDesc(desc.isTrigger, Uint8Array),
      collisionLayer: viewFromDesc(desc.collisionLayer, Uint8Array),
      collisionMask: viewFromDesc(desc.collisionMask, Uint32Array),
      collisionGroupIndex: viewFromDesc(desc.collisionGroupIndex, Int32Array),
      friction: viewFromDesc(desc.friction, Float32Array),
      restitution: viewFromDesc(desc.restitution, Float32Array),
      enableHitEvents: viewFromDesc(desc.enableHitEvents, Uint8Array),
      polyCount: viewFromDesc(desc.polyCount, Uint8Array),
      polyVertexX: viewFromDesc(desc.polyVertexX, Float32Array),
      polyVertexY: viewFromDesc(desc.polyVertexY, Float32Array),
    };
  }

  function bindBodySyncViews(desc) {
    if (!desc) {
      bodyDirtyFlags = null;
      bodyDirtyWords = null;
      bodyGeneration = null;
      return;
    }
    bodyDirtyFlags = viewFromDesc(desc.dirtyFlags, Int32Array);
    bodyDirtyWords = viewFromDesc(desc.dirtyWords, Int32Array);
    bodyGeneration = viewFromDesc(desc.generation, Int32Array);
  }

  function bindJointViews(desc, maxJ) {
    if (!desc || !(maxJ > 0)) {
      jointViews = null;
      jointHandle = null;
      jointSeenRev = null;
      jointDense = null;
      jointDenseCount = 0;
      jointLive = null;
      maxJoints = 0;
      return;
    }
    maxJoints = maxJ | 0;
    jointViews = {
      type: viewFromDesc(desc.type, Uint8Array),
      pairs: viewFromDesc(desc.pairs, Uint32Array),
      localAnchorAX: viewFromDesc(desc.localAnchorAX, Float32Array),
      localAnchorAY: viewFromDesc(desc.localAnchorAY, Float32Array),
      localAnchorBX: viewFromDesc(desc.localAnchorBX, Float32Array),
      localAnchorBY: viewFromDesc(desc.localAnchorBY, Float32Array),
      forceThreshold: viewFromDesc(desc.forceThreshold, Float32Array),
      torqueThreshold: viewFromDesc(desc.torqueThreshold, Float32Array),
      active: viewFromDesc(desc.active, Uint8Array),
      length: viewFromDesc(desc.length, Float32Array),
      enableSpring: viewFromDesc(desc.enableSpring, Uint8Array),
      hertz: viewFromDesc(desc.hertz, Float32Array),
      dampingRatio: viewFromDesc(desc.dampingRatio, Float32Array),
      enableLimit: viewFromDesc(desc.enableLimit, Uint8Array),
      lowerAngle: viewFromDesc(desc.lowerAngle, Float32Array),
      upperAngle: viewFromDesc(desc.upperAngle, Float32Array),
      enableMotor: viewFromDesc(desc.enableMotor, Uint8Array),
      motorSpeed: viewFromDesc(desc.motorSpeed, Float32Array),
      maxMotorTorque: viewFromDesc(desc.maxMotorTorque, Float32Array),
      linearHertz: viewFromDesc(desc.linearHertz, Float32Array),
      angularHertz: viewFromDesc(desc.angularHertz, Float32Array),
      linearDampingRatio: viewFromDesc(desc.linearDampingRatio, Float32Array),
      angularDampingRatio: viewFromDesc(desc.angularDampingRatio, Float32Array),
      activeIndices: viewFromDesc(desc.activeIndices, Uint16Array),
      activeIndexPositions: viewFromDesc(desc.activeIndexPositions, Uint16Array),
      activeCount: viewFromDesc(desc.activeCount, Int32Array),
      activeListLock: viewFromDesc(desc.activeListLock, Int32Array),
      revision: viewFromDesc(desc.revision, Uint32Array),
    };
    jointHandle = new Int32Array(maxJoints);
    jointHandle.fill(-1);
    jointSeenRev = new Uint32Array(maxJoints);
    jointDense = new Uint16Array(maxJoints);
    jointDenseCount = 0;
    jointLive = new Uint8Array(maxJoints);
  }

  function bindStateChannels(ready, entityCount) {
    const sab = ready.sab;
    const n = ready.bodyCapacity;
    const off = ready.channelOffsets;
    pxChan = new Float32Array(sab, off[STATE_CHANNELS.X] << 2, n);
    pyChan = new Float32Array(sab, off[STATE_CHANNELS.Y] << 2, n);
    rotChan = new Float32Array(sab, off[STATE_CHANNELS.ROTATION] << 2, n);
    vxChan = new Float32Array(sab, off[STATE_CHANNELS.VX] << 2, n);
    vyChan = new Float32Array(sab, off[STATE_CHANNELS.VY] << 2, n);
    angChan = new Float32Array(sab, off[STATE_CHANNELS.ANG_VEL] << 2, n);
    const rotCChan = new Float32Array(sab, off[STATE_CHANNELS.ROT_C] << 2, n);
    const rotSChan = new Float32Array(sab, off[STATE_CHANNELS.ROT_S] << 2, n);
    sleepingU8 =
      ready.sleepingByteOffset >= 0
        ? new Uint8Array(sab, ready.sleepingByteOffset, n)
        : null;

    // HEAP is sole pose/vel/sleep store — zero channels, then point views (zero-copy).
    const count = Math.min(entityCount | 0, n);
    pxChan.fill(0, 0, count);
    pyChan.fill(0, 0, count);
    rotChan.fill(0, 0, count);
    vxChan.fill(0, 0, count);
    vyChan.fill(0, 0, count);
    angChan.fill(0, 0, count);
    rotCChan.fill(1, 0, count);
    rotSChan.fill(0, 0, count);
    if (sleepingU8) sleepingU8.fill(0, 0, count);

    views.x = pxChan;
    views.y = pyChan;
    views.rotation = rotChan;
    views.rotC = rotCChan;
    views.rotS = rotSChan;
    views.vx = vxChan;
    views.vy = vyChan;
    views.angularVelocity = angChan;
    if (sleepingU8) {
      views.sleeping = sleepingU8;
    }

    seedPrevPose(count);
  }

  function bindPosePublish(pose) {
    poseSync = null;
    poseBuffers = [null, null];
    poseCapacity = 0;
    poseFrame = 0;
    if (!pose || !pose.sync || !pose.dataA || !pose.dataB) return;
    const n = pose.capacity | 0;
    if (!(n > 0)) return;
    poseCapacity = n;
    poseSync = new Int32Array(pose.sync);
    const bytesPerBuf = n * 4 * 4;
    for (let i = 0; i < 2; i++) {
      const sab = i === 0 ? pose.dataA : pose.dataB;
      poseBuffers[i] = {
        x: new Float32Array(sab, 0, n),
        y: new Float32Array(sab, n * 4, n),
        rotC: new Float32Array(sab, n * 8, n),
        rotS: new Float32Array(sab, n * 12, n),
      };
      if (sab.byteLength < bytesPerBuf) {
        console.warn('[weedjs-box2d] pose buffer too small', sab.byteLength, bytesPerBuf);
      }
    }
  }

  function seedPrevPose(count) {
    if (!views.px) return;
    const n = count | 0;
    for (let i = 0; i < n; i++) {
      views.px[i] = views.x[i];
      views.py[i] = views.y[i];
      // pRotation unused by render; leave untouched (no atan2)
    }
  }

  /** Snapshot prev pose before world.step. */
  function snapshotPrevPose(entityCount) {
    if (!views.px) return;
    const n = entityCount | 0;
    const rb = views.rbActive;
    for (let i = 0; i < n; i++) {
      if (rb && !rb[i]) continue;
      views.px[i] = views.x[i];
      views.py[i] = views.y[i];
    }
  }

  /**
   * Publish post-step Transform into double-buffered pose SAB (Atomics seq).
   * SoA: x, y, rotC, rotS.
   */
  function publishPose(/* entityCount */) {
    if (!poseSync || !poseBuffers[0] || !denseList) return;
    const writeIdx = poseFrame % 2;
    const buf = poseBuffers[writeIdx];
    const x = views.x;
    const y = views.y;
    const rotC = views.rotC;
    const rotS = views.rotS;
    const outX = buf.x;
    const outY = buf.y;
    const outC = buf.rotC;
    const outS = buf.rotS;
    const list = denseList;
    const n = denseCount;
    for (let d = 0; d < n; d++) {
      const i = list[d];
      outX[i] = x[i];
      outY[i] = y[i];
      outC[i] = rotC[i];
      outS[i] = rotS[i];
    }
    poseFrame++;
    Atomics.store(poseSync, 0, poseFrame);
    Atomics.notify(poseSync, 0, 1);
  }

  function isFixedRotation(i) {
    return !!(views.fixedRotation && views.fixedRotation[i]);
  }

  function categoryBitsFor(i) {
    const layer = views.collisionLayer[i] | 0;
    return layer <= 31 ? 1 << layer : 1;
  }

  function densityForEntity(i, shape) {
    let area = 0;
    if (shape === ShapeType.Circle) {
      const r = views.radius[i];
      area = Math.PI * r * r;
    } else if (shape === ShapeType.Box) {
      area = views.width[i] * views.height[i];
    } else if (shape === ShapeType.Polygon) {
      const count = views.polyCount[i] | 0;
      const base = i * MAX_POLY_VERTS;
      let twiceArea = 0;
      for (let v = 0; v < count; v++) {
        const next = v + 1 < count ? v + 1 : 0;
        twiceArea +=
          views.polyVertexX[base + v] * views.polyVertexY[base + next] -
          views.polyVertexX[base + next] * views.polyVertexY[base + v];
      }
      area = Math.abs(twiceArea) * 0.5;
    }
    const mass = views.mass[i];
    return mass > 0 && area > 0 ? mass / area : 1;
  }

  function createBodyForEntity(i) {
    const isStatic = views.rbStatic[i] !== 0;
    const type = isStatic ? Box2dBodyType.STATIC : Box2dBodyType.DYNAMIC;
    const shape = views.shapeType[i] | 0;
    const rawFriction = views.friction[i];
    const friction = rawFriction >= 0 ? rawFriction : 0;
    const restitution = views.restitution[i] || 0;
    const enableHitEvents = views.enableHitEvents[i] !== 0;
    const linearDamping = views.linearDamping[i] || 0;
    const angularDamping = views.angularDamping[i] || 0;
    const angle = isFixedRotation(i) ? 0 : views.rotation[i];
    const opts = {
      type,
      x: views.x[i],
      y: views.y[i],
      angle,
      offsetX: views.offsetX[i],
      offsetY: views.offsetY[i],
      density: densityForEntity(i, shape),
      friction,
      restitution,
      linearDamping,
      angularDamping,
      gravityScale: 1,
      vx: views.vx[i],
      vy: views.vy[i],
      angularVelocity: views.angularVelocity[i],
      isSensor: views.isTrigger[i] !== 0,
      enableHitEvents,
      categoryBits: categoryBitsFor(i),
      maskBits: views.collisionMask[i] >>> 0,
      groupIndex: views.collisionGroupIndex[i] | 0,
      fixedRotation: isFixedRotation(i),
      entityIndex: i,
    };

    try {
      if (shape === ShapeType.Circle) {
        const r = views.radius[i];
        if (!(r > 0)) return false;
        world.createCircle({ ...opts, radius: r });
      } else if (shape === ShapeType.Box) {
        const hx = views.width[i] * 0.5;
        const hy = views.height[i] * 0.5;
        if (!(hx > 0 && hy > 0)) return false;
        world.createBox({ ...opts, hx, hy });
      } else if (shape === ShapeType.Polygon) {
        const count = views.polyCount[i] | 0;
        if (count < 3) return false;
        const base = i * MAX_POLY_VERTS;
        const verts = [];
        for (let v = 0; v < count; v++) {
          verts.push(views.polyVertexX[base + v], views.polyVertexY[base + v]);
        }
        world.createPolygon({ ...opts, verts });
      } else {
        return false;
      }
    } catch (err) {
      console.error('[weedjs-box2d] createBody failed', i, err);
      return false;
    }
    return true;
  }

  function syncBodyGeometry(i) {
    const shape = views.shapeType[i] | 0;
    const offsetX = views.offsetX[i];
    const offsetY = views.offsetY[i];
    if (shape === ShapeType.Circle) {
      const radius = views.radius[i];
      if (radius > 0) {
        bodySetShapeCircleFn(i, radius, offsetX, offsetY);
      }
    } else if (shape === ShapeType.Box) {
      const hx = views.width[i] * 0.5;
      const hy = views.height[i] * 0.5;
      if (hx > 0 && hy > 0) {
        bodySetShapeBoxFn(i, hx, hy, offsetX, offsetY);
      }
    } else if (shape === ShapeType.Polygon) {
      const count = views.polyCount[i] | 0;
      if (count < 3) return;
      const ptr = Module._malloc(count * 2 * 4);
      try {
        const base = i * MAX_POLY_VERTS;
        const heapBase = ptr >> 2;
        for (let v = 0; v < count; v++) {
          Module.HEAPF32[heapBase + v * 2] = views.polyVertexX[base + v];
          Module.HEAPF32[heapBase + v * 2 + 1] = views.polyVertexY[base + v];
        }
        bodySetShapePolygonFn(i, ptr, count, offsetX, offsetY);
      } finally {
        Module._free(ptr);
      }
    }
  }

  function syncBodyProperties(i, flags) {
    if (flags & BODY_DIRTY.BODY_TYPE) {
      bodySetTypeFn(
        i,
        views.rbStatic[i] ? Box2dBodyType.STATIC : Box2dBodyType.DYNAMIC,
      );
    }
    if (flags & BODY_DIRTY.DAMPING) {
      bodySetLinearDampingFn(i, views.linearDamping[i]);
      bodySetAngularDampingFn(i, views.angularDamping[i]);
    }
    if (flags & BODY_DIRTY.GEOMETRY) {
      syncBodyGeometry(i);
    }
    if (flags & (BODY_DIRTY.MASS | BODY_DIRTY.GEOMETRY)) {
      bodySetDensityFn(i, densityForEntity(i, views.shapeType[i] | 0));
    }
    if (flags & BODY_DIRTY.FILTER) {
      bodySetFilterFn(
        i,
        categoryBitsFor(i) >>> 0,
        views.collisionMask[i] >>> 0,
        views.collisionGroupIndex[i] | 0,
      );
    }
    if (flags & BODY_DIRTY.FRICTION) {
      const friction = views.friction[i];
      bodySetFrictionFn(i, friction >= 0 ? friction : 0);
      bodySetRestitutionFn(i, views.restitution[i] || 0);
    }
  }

  function addDenseBody(i) {
    if (densePositions[i] >= 0) return;
    densePositions[i] = denseCount;
    denseList[denseCount++] = i;
  }

  function removeDenseBody(i) {
    const position = densePositions[i];
    if (position < 0) return;
    const lastPosition = --denseCount;
    const lastEntity = denseList[lastPosition];
    if (position !== lastPosition) {
      denseList[position] = lastEntity;
      densePositions[lastEntity] = position;
    }
    densePositions[i] = -1;
  }

  function syncBodySlot(i, flags) {
    let changes = 0;
    let created = false;
    const want =
      views.entityActive[i] !== 0 &&
      views.rbActive[i] !== 0 &&
      views.colActive[i] !== 0
        ? 1
        : 0;
    let have = hasBody[i];
    const generation = bodyGeneration
      ? Atomics.load(bodyGeneration, i)
      : 0;

    if (have && (!want || seenBodyGeneration[i] !== generation)) {
      try {
        world.destroyBody(i);
      } catch (_) {
        /* slot may already be clear */
      }
      hasBody[i] = 0;
      createFailed[i] = 0;
      have = 0;
      removeDenseBody(i);
      changes++;
    }

    if (want && !have) {
      if (createBodyForEntity(i)) {
        hasBody[i] = 1;
        createFailed[i] = 0;
        seenBodyGeneration[i] = generation;
        addDenseBody(i);
        created = true;
        changes++;
        const sleepThreshold = views.sleepThreshold ? views.sleepThreshold[i] : 0;
        if (sleepThreshold > 0) {
          bodySetSleepThresholdFn(i, sleepThreshold);
        }
        if (views.px) {
          views.px[i] = views.x[i];
          views.py[i] = views.y[i];
        }
      } else if (!createFailed[i]) {
        createFailed[i] = 1;
        console.warn('[weedjs-box2d] createBody failed; wait for next dirty', i);
      }
    }
    if (hasBody[i] && !created && flags !== BODY_DIRTY.LIFECYCLE) {
      syncBodyProperties(i, flags);
    }
    return changes;
  }

  function syncBodies(entityCount) {
    if (!bodyDirtyFlags || !bodyDirtyWords) {
      throw new Error('[weedjs-box2d] body dirty sync buffers required');
    }
    let changes = 0;
    let visited = 0;
    for (let wordIndex = 0; wordIndex < bodyDirtyWords.length; wordIndex++) {
      let bits = Atomics.exchange(bodyDirtyWords, wordIndex, 0) >>> 0;
      while (bits !== 0) {
        const bit = 31 - Math.clz32(bits & -bits);
        const i = (wordIndex << 5) + bit;
        bits = (bits & (bits - 1)) >>> 0;
        if (i >= entityCount) continue;
        const flags = Atomics.exchange(bodyDirtyFlags, i, 0);
        visited++;
        changes += syncBodySlot(i, flags);
      }
    }
    lastBodySyncVisited = visited;
    return changes;
  }

  function jointRevision(idx) {
    const rev = jointViews.revision;
    return rev ? Atomics.load(rev, idx) >>> 0 : 0;
  }

  function destroyJointAt(idx) {
    const h = jointHandle[idx];
    if (h < 0) {
      if (h === -2) jointHandle[idx] = -1;
      return;
    }
    try {
      world.destroyJoint(h);
    } catch (_) {
      /* already gone with body */
    }
    jointHandle[idx] = -1;
    jointSeenRev[idx] = 0;
  }

  function acquireJointSpinLock(lockView) {
    if (!lockView) return;
    while (Atomics.compareExchange(lockView, 0, 0, 1) !== 0) {
      // Joint break is rare — short spin lock acceptable here.
    }
  }

  function releaseJointSpinLock(lockView) {
    if (!lockView) return;
    Atomics.store(lockView, 0, 0);
  }

  /** Mirrors Joint.remove (src/core/Joint.js) — pool free list untouched (ponytail: idx leak on break, upgrade: bind jointFreeList/jointFreeListTop here too). */
  function removeWeedJoint(idx) {
    const jv = jointViews;
    if (!jv || idx < 0 || idx >= maxJoints || !jv.active[idx]) return;

    acquireJointSpinLock(jv.activeListLock);
    try {
      if (!jv.active[idx]) return;
      const count = jv.activeCount ? Atomics.load(jv.activeCount, 0) : 0;
      const slot = jv.activeIndexPositions[idx];
      const lastSlot = count - 1;

      jv.active[idx] = 0;

      if (slot !== 0xffff && lastSlot >= 0) {
        const lastIdx = jv.activeIndices[lastSlot];
        if (slot !== lastSlot) {
          jv.activeIndices[slot] = lastIdx;
          jv.activeIndexPositions[lastIdx] = slot;
        }
        jv.activeIndices[lastSlot] = 0xffff;
        jv.activeIndexPositions[idx] = 0xffff;
        if (jv.activeCount) {
          Atomics.store(jv.activeCount, 0, lastSlot);
        }
      }
    } finally {
      releaseJointSpinLock(jv.activeListLock);
    }

    if (jv.revision) Atomics.add(jv.revision, idx, 1);
  }

  function createJointAt(idx) {
    const jv = jointViews;
    const packed = jv.pairs[idx];
    const a = packed >>> 16;
    const b = packed & 0xffff;
    if (a === b || !hasBody[a] || !hasBody[b]) return false;
    const rev = jointRevision(idx);
    // -2 = fail for this revision only; slot recycle bumps revision and retries
    if (jointHandle[idx] === -2) {
      if (jointSeenRev[idx] === rev) return false;
      jointHandle[idx] = -1;
    }

    const bodyA = { slot: a };
    const bodyB = { slot: b };
    const opts = {
      bodyA,
      bodyB,
      localAnchorAX: jv.localAnchorAX[idx],
      localAnchorAY: jv.localAnchorAY[idx],
      localAnchorBX: jv.localAnchorBX[idx],
      localAnchorBY: jv.localAnchorBY[idx],
    };

    let handleObj = null;
    try {
      const t = jv.type[idx] | 0;
      if (t === JOINT_TYPE.DISTANCE) {
        handleObj = world.createDistanceJointLocal({
          ...opts,
          length: jv.length[idx],
          enableSpring: jv.enableSpring[idx] !== 0,
          hertz: jv.hertz[idx],
          dampingRatio: jv.dampingRatio[idx],
        });
      } else if (t === JOINT_TYPE.REVOLUTE) {
        handleObj = world.createRevoluteJointLocal({
          ...opts,
          enableLimit: jv.enableLimit[idx] !== 0,
          lowerAngle: jv.lowerAngle[idx],
          upperAngle: jv.upperAngle[idx],
          enableMotor: jv.enableMotor[idx] !== 0,
          motorSpeed: jv.motorSpeed[idx],
          maxMotorTorque: jv.maxMotorTorque[idx],
        });
      } else if (t === JOINT_TYPE.WELD) {
        handleObj = world.createWeldJointLocal({
          ...opts,
          linearHertz: jv.linearHertz[idx],
          angularHertz: jv.angularHertz[idx],
          linearDampingRatio: jv.linearDampingRatio[idx],
          angularDampingRatio: jv.angularDampingRatio[idx],
        });
      } else {
        return false;
      }
    } catch (err) {
      jointHandle[idx] = -2;
      jointSeenRev[idx] = rev;
      if (!jointCapacityWarn) {
        jointCapacityWarn = true;
        console.warn(
          '[weedjs-box2d] joint create failed (OOM/cap/reject) — stop retry',
          err?.message ?? err,
        );
      }
      return false;
    }

    jointHandle[idx] = handleObj.handle;
    jointSeenRev[idx] = rev;
    const force = jv.forceThreshold ? jv.forceThreshold[idx] : Infinity;
    const torque = jv.torqueThreshold ? jv.torqueThreshold[idx] : Infinity;
    handleObj.configure(
      idx,
      Number.isFinite(force) ? force : 1e30,
      Number.isFinite(torque) ? torque : 1e30,
    );
    return true;
  }

  function syncJoints() {
    if (!jointViews || !jointHandle || !world) return 0;
    const jv = jointViews;
    const activeCount = Atomics.load(jv.activeCount, 0) | 0;
    let changes = 0;

    for (let i = 0; i < jointDenseCount; i++) {
      jointLive[jointDense[i]] = 0;
    }

    let nextDenseCount = 0;
    for (let slot = 0; slot < activeCount; slot++) {
      const idx = jv.activeIndices[slot];
      if (idx === 0xffff || !jv.active[idx]) continue;
      jointLive[idx] = 1;
      const packed = jv.pairs[idx];
      const a = packed >>> 16;
      const b = packed & 0xffff;
      const want = hasBody[a] && hasBody[b] ? 1 : 0;
      const have = jointHandle[idx] >= 0 ? 1 : 0;
      const rev = jointRevision(idx);
      if (want && have && jointSeenRev[idx] !== rev) {
        destroyJointAt(idx);
        createJointAt(idx);
        changes++;
      } else if (want && !have) {
        if (createJointAt(idx)) changes++;
      } else if (!want && have) {
        destroyJointAt(idx);
        changes++;
      }
      if (jointHandle[idx] >= 0) {
        jointDense[nextDenseCount++] = idx;
      }
    }

    for (let i = 0; i < jointDenseCount; i++) {
      const idx = jointDense[i];
      if (!jointLive[idx] && jointHandle[idx] >= 0) {
        destroyJointAt(idx);
        changes++;
      }
    }
    jointDenseCount = nextDenseCount;
    return changes;
  }

  let sleepingEnabled = true;

  let bodyApplyForceCenterFn = null;
  let bodyApplyTorqueFn = null;
  let bodySetLinearVelocityFn = null;
  let bodySetTransformFn = null;
  let bodySetAwakeFn = null;
  let bodySetAngularVelocityFn = null;
  let bodySetFixedRotationFn = null;
  let bodySetTypeFn = null;
  let bodySetLinearDampingFn = null;
  let bodySetAngularDampingFn = null;
  let bodySetFilterFn = null;
  let bodySetFrictionFn = null;
  let bodySetRestitutionFn = null;
  let bodySetSleepThresholdFn = null;
  let bodySetDensityFn = null;
  let bodySetShapeBoxFn = null;
  let bodySetShapeCircleFn = null;
  let bodySetShapePolygonFn = null;

  // Teleports skip b2BodyMoveEvent — accumulate and merge into moved SAB after step
  let pendingTeleportBits = null;
  let pendingTeleportList = null;
  let pendingTeleportCount = 0;

  function markTeleportMoved(entity) {
    const e = entity | 0;
    if (!pendingTeleportBits || e < 0 || e >= pendingTeleportBits.length) return;
    if (pendingTeleportBits[e]) return;
    pendingTeleportBits[e] = 1;
    pendingTeleportList[pendingTeleportCount++] = e >>> 0;
  }

  // Hoisted once — drainCommands must not allocate a fresh handlers object every step
  const cmdHandlers = {
    setTransform(entity, x, y, rotC, rotS) {
      if (!hasBody[entity]) return;
      let c = rotC;
      let s = rotS;
      if (isFixedRotation(entity)) {
        c = 1;
        s = 0;
      }
      bodySetTransformFn(entity, x, y, c, s);
      if (bodySetAwakeFn) bodySetAwakeFn(entity, 1);
      markTeleportMoved(entity);
    },
    setVelocity(entity, vx, vy) {
      if (!hasBody[entity]) return;
      bodySetLinearVelocityFn(entity, vx, vy);
    },
    setAngle(entity, rotC, rotS) {
      if (!hasBody[entity]) return;
      const x = pxChan[entity];
      const y = pyChan[entity];
      let c = rotC;
      let s = rotS;
      if (isFixedRotation(entity)) {
        c = 1;
        s = 0;
      }
      bodySetTransformFn(entity, x, y, c, s);
      if (bodySetAwakeFn) bodySetAwakeFn(entity, 1);
      markTeleportMoved(entity);
    },
    setAngularVelocity(entity, w) {
      if (!hasBody[entity]) return;
      bodySetAngularVelocityFn(entity, w);
    },
    setFixedRotation(entity, flag) {
      if (!hasBody[entity]) return;
      const f = flag ? 1 : 0;
      bodySetFixedRotationFn(entity, f);
      if (f) {
        rotChan[entity] = 0;
        if (views.rotC) views.rotC[entity] = 1;
        if (views.rotS) views.rotS[entity] = 0;
        bodySetAngularVelocityFn(entity, 0);
      }
    },
    explode(maskBits, x, y, radius, impulsePerLength) {
      if (!world) return;
      world.explode(x, y, radius, radius * 0.5, impulsePerLength, maskBits >>> 0);
    },
    setSleepThreshold(entity, threshold) {
      if (!hasBody[entity]) return;
      bodySetSleepThresholdFn(entity, threshold);
    },
  };

  function drainCommands() {
    if (!cmdI32 || !cmdF32) return 0;
    return drainBox2dCommandRing(cmdI32, cmdF32, cmdHandlers);
  }

  function serviceQueryAabb() {
    if (!world || !world._querySlots) return;
    Box2dQueryAabb.servicePendingQuery(function (
      x0,
      y0,
      x1,
      y1,
      categoryBits,
      maskBits,
      results,
      cap,
    ) {
      var n = world.overlapAABB(x0, y0, x1, y1, world._querySlots, {
        categoryBits: categoryBits,
        maskBits: maskBits,
      });
      var write = n < cap ? n : cap;
      var slots = world._querySlots;
      if (write > slots.length) write = slots.length;
      for (var i = 0; i < write; i++) {
        results[i] = slots[i] | 0;
      }
      return n | 0;
    });
  }

  function applyForcesAndTorque() {
    for (let n = 0; n < denseCount; n++) {
      const i = denseList[n];
      if (views.rbStatic[i]) {
        views.ax[i] = 0;
        views.ay[i] = 0;
        views.angularAccel[i] = 0;
        continue;
      }
      const m = views.mass[i];
      const mass = m > 0 ? m : 1;
      const ax = views.ax[i];
      const ay = views.ay[i];
      if (ax !== 0 || ay !== 0) {
        bodyApplyForceCenterFn(i, ax * mass, ay * mass, 1);
      }
      const aa = views.angularAccel[i];
      if (aa !== 0 && !isFixedRotation(i)) {
        bodyApplyTorqueFn(i, aa * mass, 1);
      }
      views.ax[i] = 0;
      views.ay[i] = 0;
      views.angularAccel[i] = 0;
    }
  }

  function entityGen(i) {
    return bodyGeneration ? Atomics.load(bodyGeneration, i) | 0 : 0;
  }

  function publishPairBuffer(buf, count, kind, stride) {
    if (!buf || !(count > 0) || !contactRingI32) return;
    for (let i = 0; i < count; i++) {
      const a = buf[i * stride] | 0;
      const b = buf[i * stride + 1] | 0;
      publishBox2dContactEvent(kind, a, b, entityGen(a), entityGen(b));
    }
  }

  function publishContactRingFromWasm() {
    if (!world || !contactRingI32) return;
    const hdr = world._eventHeader;
    if (!hdr) return;
    const stride = 2;
    const beginCount = hdr[EVENT_HEADER.CONTACT_BEGIN_COUNT] | 0;
    const endCount = hdr[EVENT_HEADER.CONTACT_END_COUNT] | 0;
    const sensorBeginCount = hdr[EVENT_HEADER.SENSOR_BEGIN_COUNT] | 0;
    const sensorEndCount = hdr[EVENT_HEADER.SENSOR_END_COUNT] | 0;
    // Ends before begins so logic can drop pairs before re-enter same frame
    publishPairBuffer(world._contactEnd, endCount, CONTACT_KIND.CONTACT_END, stride);
    publishPairBuffer(world._sensorEnd, sensorEndCount, CONTACT_KIND.SENSOR_END, stride);
    publishPairBuffer(world._contactBegin, beginCount, CONTACT_KIND.CONTACT_BEGIN, stride);
    publishPairBuffer(world._sensorBegin, sensorBeginCount, CONTACT_KIND.SENSOR_BEGIN, stride);
  }

  function publishHitsFromWasm() {
    if (!world || !hitRingBound) return;
    const hdr = world._eventHeader;
    const hits = world._contactHit;
    if (!hdr || !hits) return;
    const stride = world._contactHitStride || 8;
    const count = hdr[EVENT_HEADER.CONTACT_HIT_COUNT] | 0;
    for (let i = 0; i < count; i++) {
      const base = i * stride;
      const a = hits[base] | 0;
      const b = hits[base + 1] | 0;
      publishContactHit(
        a,
        b,
        entityGen(a),
        entityGen(b),
        hits[base + 2],
        hits[base + 3],
        hits[base + 4],
        hits[base + 5],
        hits[base + 6],
      );
    }
  }

  function publishJointBreaksFromWasm() {
    if (!world || !jointBreakRingBound || !jointViews) return;
    const hdr = world._eventHeader;
    const events = world._jointEvents;
    if (!hdr || !events) return;
    const count = hdr[EVENT_HEADER.JOINT_EVENT_COUNT] | 0;
    const jv = jointViews;
    for (let i = 0; i < count; i++) {
      const idx = events[i] | 0;
      if (idx < 0 || idx >= maxJoints) continue;
      const packed = jv.pairs[idx];
      const entityA = packed >>> 16;
      const entityB = packed & 0xffff;
      destroyJointAt(idx);
      removeWeedJoint(idx);
      publishJointBreak(idx, entityA, entityB, entityGen(entityA), entityGen(entityB));
    }
  }

  function afterStep() {
    publishContactRingFromWasm();
    publishHitsFromWasm();
    publishJointBreaksFromWasm();
    publishMovedSabFromStep();
  }

  function publishMovedSabFromStep() {
    if (!world || typeof publishMovedBodies !== 'function') return;
    const wasmCount =
      typeof world._getBodyMoveCount === 'function'
        ? world._getBodyMoveCount() | 0
        : 0;
    publishMovedBodies(
      world._bodyMoved,
      world._bodyFellAsleep,
      wasmCount,
      pendingTeleportList,
      pendingTeleportCount,
      pendingTeleportBits,
    );
    if (pendingTeleportCount > 0 && pendingTeleportBits) {
      for (let i = 0; i < pendingTeleportCount; i++) {
        pendingTeleportBits[pendingTeleportList[i]] = 0;
      }
      pendingTeleportCount = 0;
    }
  }

  function writePhysicsStats(
    bodySyncMs,
    jointSyncMs,
    commandMs,
    forceMs,
    box2dMs,
    postMs,
    bodySyncChanges,
    jointSyncChanges,
    commandCount,
  ) {
    if (!statsF32) return;
    statsF32[PS.BODY_COUNT] = denseCount;
    statsF32[PS.JOINT_COUNT] = world ? world.getJointCount() : 0;
    statsF32[PS.BODY_SYNC_MS] = bodySyncMs;
    statsF32[PS.JOINT_SYNC_MS] = jointSyncMs;
    statsF32[PS.COMMAND_MS] = commandMs;
    statsF32[PS.FORCE_MS] = forceMs;
    statsF32[PS.BOX2D_MS] = box2dMs;
    statsF32[PS.POST_MS] = postMs;
    statsF32[PS.BODY_SYNC_CHANGES] = bodySyncChanges;
    statsF32[PS.BODY_SYNC_VISITED] = lastBodySyncVisited;
    statsF32[PS.JOINT_SYNC_CHANGES] = jointSyncChanges;
    statsF32[PS.COMMAND_COUNT] = commandCount;
    statsF32[PS.COMMAND_OVERFLOW_TOTAL] = cmdI32
      ? Atomics.load(cmdI32, 3) | 0
      : 0;
    const hdr = world && world._eventHeader;
    if (hdr) {
      statsF32[PS.CONTACT_BEGIN] = hdr[EVENT_HEADER.CONTACT_BEGIN_COUNT] | 0;
      statsF32[PS.CONTACT_END] = hdr[EVENT_HEADER.CONTACT_END_COUNT] | 0;
      statsF32[PS.SENSOR_BEGIN] = hdr[EVENT_HEADER.SENSOR_BEGIN_COUNT] | 0;
      statsF32[PS.SENSOR_END] = hdr[EVENT_HEADER.SENSOR_END_COUNT] | 0;
      const wasmContactDrop = hdr[EVENT_HEADER.CONTACT_DROPPED_COUNT] | 0;
      const wasmSensorDrop = hdr[EVENT_HEADER.SENSOR_DROPPED_COUNT] | 0;
      const ringDrop = contactRingI32
        ? Atomics.load(contactRingI32, 2) | 0
        : 0;
      statsF32[PS.CONTACT_DROPPED] = wasmContactDrop + ringDrop;
      statsF32[PS.SENSOR_DROPPED] = wasmSensorDrop;
    } else {
      statsF32[PS.CONTACT_BEGIN] = 0;
      statsF32[PS.CONTACT_END] = 0;
      statsF32[PS.SENSOR_BEGIN] = 0;
      statsF32[PS.SENSOR_END] = 0;
      statsF32[PS.CONTACT_DROPPED] = 0;
      statsF32[PS.SENSOR_DROPPED] = 0;
    }
    if (jointViews && jointViews.activeCount) {
      statsF32[PS.WEED_JOINTS] = Atomics.load(jointViews.activeCount, 0) | 0;
    } else {
      statsF32[PS.WEED_JOINTS] = 0;
    }
    if (typeof weedjsHeapBytesUsed === 'function') {
      const usedKb = ((weedjsHeapBytesUsed() | 0) / 1024) | 0;
      if (usedKb > heapHighWaterKb) heapHighWaterKb = usedKb;
      statsF32[PS.HEAP_USED_KB] = usedKb;
      statsF32[PS.HEAP_HIGH_WATER_KB] = heapHighWaterKb;
    } else {
      statsF32[PS.HEAP_USED_KB] = 0;
      statsF32[PS.HEAP_HIGH_WATER_KB] = heapHighWaterKb;
    }

    const movedViews =
      typeof Box2dMovedBodies !== 'undefined' && Box2dMovedBodies.getMovedBodiesViews
        ? Box2dMovedBodies.getMovedBodiesViews()
        : null;
    statsF32[PS.BODY_MOVED_COUNT] = movedViews ? movedViews.count | 0 : 0;

    if (world && typeof world._getAwakeBodyCount === 'function') {
      statsF32[PS.AWAKE_COUNT] = world._getAwakeBodyCount(world.worldId) | 0;
    } else {
      statsF32[PS.AWAKE_COUNT] = 0;
    }

    const profile = world && world._profile;
    if (profile && profile.length >= 5) {
      statsF32[PS.PROFILE_STEP_MS] = profile[0];
      statsF32[PS.PROFILE_COLLIDE_MS] = profile[1];
      statsF32[PS.PROFILE_SOLVE_MS] = profile[2];
      statsF32[PS.PROFILE_SLEEP_MS] = profile[3];
      statsF32[PS.PROFILE_SENSORS_MS] = profile[4];
    } else {
      statsF32[PS.PROFILE_STEP_MS] = 0;
      statsF32[PS.PROFILE_COLLIDE_MS] = 0;
      statsF32[PS.PROFILE_SOLVE_MS] = 0;
      statsF32[PS.PROFILE_SLEEP_MS] = 0;
      statsF32[PS.PROFILE_SENSORS_MS] = 0;
    }

    const counters = world && world._counters;
    if (counters && counters.length >= 7) {
      statsF32[PS.COUNTER_CONTACTS] = counters[2] | 0;
      statsF32[PS.COUNTER_ISLANDS] = counters[4] | 0;
      statsF32[PS.COUNTER_AWAKE_CONTACTS] = counters[5] | 0;
      statsF32[PS.COUNTER_TREE_HEIGHT] = counters[6] | 0;
    } else {
      statsF32[PS.COUNTER_CONTACTS] = 0;
      statsF32[PS.COUNTER_ISLANDS] = 0;
      statsF32[PS.COUNTER_AWAKE_CONTACTS] = 0;
      statsF32[PS.COUNTER_TREE_HEIGHT] = 0;
    }
  }

  function doStep() {
    const entityCount = hostEntityCount | 0;
    // Honor scene physics.subStepCount (BallsScene = 4) — do not inflate
    const solverSteps = Math.max(1, hostSubSteps | 0);
    const dt = hostDt;
    if (!world) {
      return;
    }
    // Service even when dt==0 / paused so sync box2dQueryAABB callers do not hang.
    if (!(dt > 0)) {
      serviceQueryAabb();
      return;
    }
    const t0 = performance.now();
    const bodySyncChanges = syncBodies(entityCount);
    const t1 = performance.now();
    const jointSyncChanges = syncJoints();
    const t2 = performance.now();
    const commandCount = drainCommands();
    const t3 = performance.now();
    serviceQueryAabb();
    snapshotPrevPose(entityCount);
    applyForcesAndTorque();
    const t4 = performance.now();
    world.step(dt, solverSteps);
    const t5 = performance.now();
    publishPose(entityCount);
    afterStep();
    const t6 = performance.now();
    writePhysicsStats(
      t1 - t0,
      t2 - t1,
      t3 - t2,
      t4 - t3,
      t5 - t4,
      t6 - t5,
      bodySyncChanges,
      jointSyncChanges,
      commandCount,
    );
  }

  function handleInit(data) {
    const { PhysicsWorld } = createPhysicsApi(Module);
    const maxBodies = data.maxBodies | 0;
    verdletSubSteps = Math.max(1, data.subSteps | 0 || 4);
    sleepingEnabled = data.sleeping !== false;
    world = new PhysicsWorld(data.gravityX || 0, data.gravityY || 0, {
      lengthUnitsPerMeter: data.lengthUnitsPerMeter,
      contactHertz: data.contactHertz,
      contactDampingRatio: data.contactDampingRatio,
      contactSpeed: data.contactSpeed,
      maximumLinearSpeed: data.maximumLinearSpeed,
      box2dWorkerCount: data.box2dWorkerCount,
    });
    world.enableSleeping(sleepingEnabled);
    const slots = world.getMaxBodySlots();
    if (maxBodies <= 0 || maxBodies > slots) {
      throw new Error(
        `bindBuffers: maxBodies ${maxBodies} exceeds max slots ${slots}`,
      );
    }
    world.bindBuffers(maxBodies);

    bodyApplyForceCenterFn = Module.cwrap('body_apply_force_center', null, [
      'number',
      'number',
      'number',
      'number',
    ]);
    bodyApplyTorqueFn = Module.cwrap('body_apply_torque', null, [
      'number',
      'number',
      'number',
    ]);
    bodySetLinearVelocityFn = Module.cwrap(
      'body_set_linear_velocity',
      null,
      ['number', 'number', 'number'],
    );
    bodySetTransformFn = Module.cwrap('body_set_transform', null, [
      'number',
      'number',
      'number',
      'number',
      'number',
    ]);
    bodySetAwakeFn = Module.cwrap('body_set_awake', null, ['number', 'number']);
    bodySetAngularVelocityFn = Module.cwrap(
      'body_set_angular_velocity',
      null,
      ['number', 'number'],
    );
    bodySetFixedRotationFn = Module.cwrap('body_set_fixed_rotation', null, [
      'number',
      'number',
    ]);
    bodySetTypeFn = Module.cwrap('body_set_type', null, ['number', 'number']);
    bodySetLinearDampingFn = Module.cwrap('body_set_linear_damping', null, [
      'number',
      'number',
    ]);
    bodySetAngularDampingFn = Module.cwrap('body_set_angular_damping', null, [
      'number',
      'number',
    ]);
    bodySetFilterFn = Module.cwrap('body_set_filter', null, [
      'number',
      'number',
      'number',
      'number',
    ]);
    bodySetFrictionFn = Module.cwrap('body_set_friction', null, [
      'number',
      'number',
    ]);
    bodySetRestitutionFn = Module.cwrap('body_set_restitution', null, [
      'number',
      'number',
    ]);
    bodySetSleepThresholdFn = Module.cwrap('body_set_sleep_threshold', null, [
      'number',
      'number',
    ]);
    bodySetDensityFn = Module.cwrap('body_set_density', null, [
      'number',
      'number',
    ]);
    bodySetShapeBoxFn = Module.cwrap('body_set_shape_box', null, [
      'number',
      'number',
      'number',
      'number',
      'number',
    ]);
    bodySetShapeCircleFn = Module.cwrap('body_set_shape_circle', null, [
      'number',
      'number',
      'number',
      'number',
    ]);
    bodySetShapePolygonFn = Module.cwrap('body_set_shape_polygon', null, [
      'number',
      'number',
      'number',
      'number',
      'number',
    ]);
    weedjsHeapBytesUsed =
      typeof Module._weedjs_heap_bytes_used === 'function'
        ? Module._weedjs_heap_bytes_used
        : null;
    heapHighWaterKb = 0;
    hostEntityCount = data.entityCount | 0;
    hostSubSteps = Math.max(1, data.subSteps | 0 || 4);
    if (data.commandSab) {
      cmdI32 = new Int32Array(data.commandSab);
      cmdF32 = new Float32Array(data.commandSab);
    }
    if (data.queryAabbSab) {
      Box2dQueryAabb.bindQueryAabbSab(data.queryAabbSab);
    }
    if (data.contactSab) {
      Box2dContactRing.bindContactRing(data.contactSab);
      contactRingI32 = new Int32Array(data.contactSab);
    } else {
      contactRingI32 = null;
    }
    if (data.movedSab) {
      bindMovedBodies(data.movedSab);
    }
    if (data.hitSab) {
      Box2dContactHitRing.bindContactHitRing(data.hitSab);
      hitRingBound = true;
    }
    if (data.jointBreakSab) {
      Box2dJointBreakRing.bindJointBreakRing(data.jointBreakSab);
      jointBreakRingBound = true;
    }
    if (data.hitEventThreshold > 0) {
      world.setHitEventThreshold(data.hitEventThreshold);
    }

    bindWeedViews(data.views);
    bindPosePublish(data.posePublish);
    bindBodySyncViews(data.bodySync);
    if (!bodyDirtyFlags || !bodyDirtyWords) {
      throw new Error('[weedjs-box2d] WEEDJS_INIT missing bodySync dirty buffers');
    }
    bindJointViews(data.jointViews, data.maxJoints | 0);
    if (data.stats) {
      statsF32 = viewFromDesc(data.stats, Float32Array);
    } else {
      statsF32 = null;
    }
    const entityCount = data.entityCount | 0;
    hasBody = new Uint8Array(entityCount);
    createFailed = new Uint8Array(entityCount);
    denseList = new Uint16Array(entityCount);
    densePositions = new Int32Array(entityCount);
    densePositions.fill(-1);
    seenBodyGeneration = new Int32Array(entityCount);
    pendingTeleportBits = new Uint8Array(entityCount);
    pendingTeleportList = new Uint32Array(entityCount);
    pendingTeleportCount = 0;

    const ready = world.getReadyPayload();
    bindStateChannels(ready, entityCount);

    const readyMsg = {
      type: 'WEEDJS_READY',
      sab: ready.sab,
      bodyCapacity: ready.bodyCapacity,
      channelOffsets: ready.channelOffsets,
      sleepingByteOffset: ready.sleepingByteOffset,
      eventHeaderBaseIndex: ready.eventHeaderBaseIndex,
      contactBeginBaseIndex: ready.contactBeginBaseIndex,
      contactEndBaseIndex: ready.contactEndBaseIndex,
      sensorBeginBaseIndex: ready.sensorBeginBaseIndex,
      sensorEndBaseIndex: ready.sensorEndBaseIndex,
      contactEventCapacity: ready.contactEventCapacity,
      sensorEventCapacity: ready.sensorEventCapacity,
      contactPairIntStride: ready.contactPairIntStride,
      eventHeaderIntCount: ready.eventHeaderIntCount,
      movedSab: data.movedSab || null,
    };
    if (typeof globalThis.weedjsOnReady === 'function') {
      globalThis.weedjsOnReady(readyMsg);
    } else {
      postMessage(readyMsg);
    }
  }

  function notifyModuleReady() {
    if (moduleReady) return;
    moduleReady = true;
    while (moduleReadyWaiters.length) {
      moduleReadyWaiters.shift()();
    }
  }

  /**
   * In-process step for classic physics host.
   * @param {number} dtSec
   * @param {number} [subSteps]
   */
  function weedjsDoStep(dtSec, subSteps) {
    if (subSteps != null) {
      hostSubSteps = Math.max(1, subSteps | 0);
    }
    hostDt = dtSec;
    doStep();
  }

  function weedjsEnableHostMode() {
    hostMode = true;
  }

  function weedjsWhenModuleReady(cb) {
    if (typeof cb !== 'function') return;
    if (moduleReady) {
      cb();
      return;
    }
    moduleReadyWaiters.push(cb);
  }

  function weedjsApplyConfig(data) {
    if (!data) return;
    if (data.sleeping !== undefined) {
      sleepingEnabled = data.sleeping !== false;
      if (world) world.enableSleeping(sleepingEnabled);
    }
    if (data.subSteps != null) {
      hostSubSteps = Math.max(1, data.subSteps | 0);
    }
    if (data.entityCount != null) {
      hostEntityCount = data.entityCount | 0;
    }
    if (data.hitEventThreshold != null && world) {
      world.setHitEventThreshold(data.hitEventThreshold);
    }
  }

  globalThis.weedjsEnableHostMode = weedjsEnableHostMode;
  globalThis.weedjsDoStep = weedjsDoStep;
  globalThis.weedjsWhenModuleReady = weedjsWhenModuleReady;
  globalThis.weedjsHandleInit = handleInit;
  globalThis.weedjsApplyConfig = weedjsApplyConfig;

  const pending = [];
  let inited = false;

  self.onmessage = function (event) {
    const data = event.data;
    if (!data || !data.type) return;
    if (!inited && data.type !== 'WEEDJS_INIT') {
      pending.push(data);
      return;
    }
    if (data.type === 'WEEDJS_INIT') {
      try {
        handleInit(data);
        inited = true;
        while (pending.length) {
          self.onmessage({ data: pending.shift() });
        }
      } catch (err) {
        console.error('[weedjs-box2d] init failed', err);
        postMessage({
          type: 'WEEDJS_ERROR',
          message: err?.message ?? String(err),
        });
      }
      return;
    }
    if (data.type === 'WEEDJS_CONFIG') {
      weedjsApplyConfig(data);
    }
  };

  Module.onRuntimeInitialized = notifyModuleReady;
  // Defer so weed_post can importScripts(physics_host) and set hostMode first.
  if (typeof Module !== 'undefined' && Module.calledRun) {
    setTimeout(notifyModuleReady, 0);
  }
})();
