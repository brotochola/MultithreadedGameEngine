// WeedJS bridge — loaded by box2d_wasm.js (always).
// Owns Module; driven by Atomics handshake from physics_worker (ESM).
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
  );
  const drainBox2dCommandRing = Box2dCommandRing.drainCommandRing;
  const publishBox2dContactEvent = Box2dContactRing.publishContactEvent;
  const CONTACT_KIND = Box2dContactRing.BOX2D_CONTACT_KIND;

  const CTRL = {
    STATE: 0, // 0 idle, 1 step, 2 done, 3 fatal
    SUBSTEPS: 1,
    ENTITY_COUNT: 2,
  };

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
  let ctrlI32 = null;
  let ctrlF32 = null;
  let cmdI32 = null;
  let cmdF32 = null;
  let contactRingI32 = null;
  let views = null;
  let hasBody = null;
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
  let running = false;
  let statsF32 = null;

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
  };

  let heapHighWaterKb = 0;
  let weedjsHeapBytesUsed = null;

  function viewFromDesc(desc, TypedArray) {
    return new TypedArray(desc.sab, desc.byteOffset, desc.length);
  }

  function bindWeedViews(desc) {
    views = {
      entityActive: viewFromDesc(desc.entityActive, Uint8Array),
      x: viewFromDesc(desc.x, Float32Array),
      y: viewFromDesc(desc.y, Float32Array),
      rotation: viewFromDesc(desc.rotation, Float32Array),
      rbActive: viewFromDesc(desc.rbActive, Uint8Array),
      rbStatic: viewFromDesc(desc.rbStatic, Uint8Array),
      vx: viewFromDesc(desc.vx, Float32Array),
      vy: viewFromDesc(desc.vy, Float32Array),
      ax: viewFromDesc(desc.ax, Float32Array),
      ay: viewFromDesc(desc.ay, Float32Array),
      angularVelocity: viewFromDesc(desc.angularVelocity, Float32Array),
      angularAccel: viewFromDesc(desc.angularAccel, Float32Array),
      mass: viewFromDesc(desc.mass, Float32Array),
      maxLinearSpeed: viewFromDesc(desc.maxLinearSpeed, Float32Array),
      linearDamping: viewFromDesc(desc.linearDamping, Float32Array),
      angularDamping: viewFromDesc(desc.angularDamping, Float32Array),
      sleeping: viewFromDesc(desc.sleeping, Uint8Array),
      fixedRotation: desc.fixedRotation
        ? viewFromDesc(desc.fixedRotation, Uint8Array)
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
      activeCount: viewFromDesc(desc.activeCount, Int32Array),
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
    sleepingU8 =
      ready.sleepingByteOffset >= 0
        ? new Uint8Array(sab, ready.sleepingByteOffset, n)
        : null;

    // Seed HEAP from Weed SoA, then point all hot views at HEAP (zero-copy).
    const count = Math.min(entityCount | 0, n);
    for (let i = 0; i < count; i++) {
      pxChan[i] = views.x[i];
      pyChan[i] = views.y[i];
      rotChan[i] = isFixedRotation(i) ? 0 : views.rotation[i];
      vxChan[i] = views.vx[i];
      vyChan[i] = views.vy[i];
      angChan[i] = views.angularVelocity[i];
      if (sleepingU8) {
        sleepingU8[i] = views.sleeping[i];
      }
    }
    views.x = pxChan;
    views.y = pyChan;
    views.rotation = rotChan;
    views.vx = vxChan;
    views.vy = vyChan;
    views.angularVelocity = angChan;
    if (sleepingU8) {
      views.sleeping = sleepingU8;
    }
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
      restitution: 0,
      linearDamping,
      angularDamping,
      gravityScale: 1,
      vx: views.vx[i],
      vy: views.vy[i],
      angularVelocity: views.angularVelocity[i],
      isSensor: views.isTrigger[i] !== 0,
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
      have = 0;
      removeDenseBody(i);
      changes++;
    }

    if (want && !have) {
      if (createBodyForEntity(i)) {
        hasBody[i] = 1;
        seenBodyGeneration[i] = generation;
        addDenseBody(i);
        created = true;
        changes++;
      } else if (bodyDirtyFlags && bodyDirtyWords) {
        // Invalid/incomplete spawn data may become valid later; retry sparsely.
        Atomics.or(bodyDirtyFlags, i, 1);
        Atomics.or(bodyDirtyWords, i >>> 5, 1 << (i & 31));
      }
    }
    if (hasBody[i] && !created && flags !== BODY_DIRTY.LIFECYCLE) {
      syncBodyProperties(i, flags);
    }
    return changes;
  }

  function syncBodies(entityCount) {
    if (bodyDirtyFlags && bodyDirtyWords) {
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

    // Compatibility fallback for payloads created before sparse body sync.
    denseCount = 0;
    let changes = 0;
    const bodyCap = hasBody ? hasBody.length : 0;
    const n = Math.min(entityCount | 0, bodyCap);
    lastBodySyncVisited = n;
    densePositions.fill(-1);
    for (let i = 0; i < n; i++) {
      const want =
        views.entityActive[i] !== 0 &&
        views.rbActive[i] !== 0 &&
        views.colActive[i] !== 0
          ? 1
          : 0;
      const have = hasBody[i];
      if (want && !have) {
        if (createBodyForEntity(i)) {
          hasBody[i] = 1;
          changes++;
        }
      } else if (!want && have) {
        try {
          world.destroyBody(i);
        } catch (_) {
          /* slot may already be clear */
        }
        hasBody[i] = 0;
        changes++;
      }
      if (hasBody[i]) {
        addDenseBody(i);
      }
    }
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
  let bodySetAngularVelocityFn = null;
  let bodySetAwakeFn = null;
  let bodySetFixedRotationFn = null;
  let bodySetTypeFn = null;
  let bodySetLinearDampingFn = null;
  let bodySetAngularDampingFn = null;
  let bodySetFilterFn = null;
  let bodySetFrictionFn = null;
  let bodySetDensityFn = null;
  let bodySetShapeBoxFn = null;
  let bodySetShapeCircleFn = null;
  let bodySetShapePolygonFn = null;

  // Hoisted once — drainCommands must not allocate a fresh handlers object every step
  const cmdHandlers = {
    setTransform(entity, x, y, angle) {
      if (!hasBody[entity]) return;
      bodySetAwakeFn(entity, 1);
      const a = isFixedRotation(entity) ? 0 : angle;
      bodySetTransformFn(entity, x, y, a);
    },
    setVelocity(entity, vx, vy) {
      if (!hasBody[entity]) return;
      // Always wake: Box2D SetLinearVelocity(0) is a no-op on sleeping bodies (no state).
      // Games often write vx=0 while idle; without wake, later forces never stick.
      bodySetAwakeFn(entity, 1);
      bodySetLinearVelocityFn(entity, vx, vy);
    },
    setAngle(entity, angle) {
      if (!hasBody[entity]) return;
      bodySetAwakeFn(entity, 1);
      const x = pxChan[entity];
      const y = pyChan[entity];
      const a = isFixedRotation(entity) ? 0 : angle;
      bodySetTransformFn(entity, x, y, a);
    },
    setAngularVelocity(entity, w) {
      if (!hasBody[entity]) return;
      bodySetAwakeFn(entity, 1);
      bodySetAngularVelocityFn(entity, w);
    },
    setFixedRotation(entity, flag) {
      if (!hasBody[entity]) return;
      const f = flag ? 1 : 0;
      bodySetFixedRotationFn(entity, f);
      if (f) {
        rotChan[entity] = 0;
        bodySetAngularVelocityFn(entity, 0);
      }
    },
  };

  function drainCommands() {
    if (!cmdI32 || !cmdF32) return 0;
    return drainBox2dCommandRing(cmdI32, cmdF32, cmdHandlers);
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

  function clampMaxVel() {
    for (let n = 0; n < denseCount; n++) {
      const i = denseList[n];
      if (views.rbStatic[i] || !hasBody[i]) continue;
      const maxV = views.maxLinearSpeed[i];
      if (!(maxV > 0)) continue;
      const vx = vxChan[i];
      const vy = vyChan[i];
      const sp2 = vx * vx + vy * vy;
      const max2 = maxV * maxV;
      if (sp2 > max2 && sp2 > 0) {
        const s = maxV / Math.sqrt(sp2);
        bodySetLinearVelocityFn(i, vx * s, vy * s);
        vxChan[i] = vx * s;
        vyChan[i] = vy * s;
      }
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

  function afterStep() {
    const rotLen = rotChan ? rotChan.length : 0;
    for (let n = 0; n < denseCount; n++) {
      const i = denseList[n];
      if (i >= rotLen) continue;
      if (isFixedRotation(i)) {
        rotChan[i] = 0;
      }
    }
    clampMaxVel();
    // WASM marks all dynamics sleeping=1 then clears only movers. With sleeping
    // disabled, force awake + clear flags so cell-sleep / debug match config.
    if (!sleepingEnabled) {
      enforceAwakeDynamics();
    }
    publishContactRingFromWasm();
  }

  /**
   * Honor physics.sleeping === false (WASM has no world_enable_sleep export yet).
   */
  function enforceAwakeDynamics() {
    if (!bodySetAwakeFn) return;
    for (let n = 0; n < denseCount; n++) {
      const i = denseList[n];
      if (views.rbStatic[i]) continue;
      bodySetAwakeFn(i, 1);
      if (sleepingU8) sleepingU8[i] = 0;
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
  }

  function doStep() {
    const entityCount = Atomics.load(ctrlI32, CTRL.ENTITY_COUNT) | 0;
    // Honor scene physics.subStepCount (BallsScene = 4) — do not inflate
    const solverSteps = Math.max(1, Atomics.load(ctrlI32, CTRL.SUBSTEPS) | 0);
    const dt = ctrlF32[0];
    if (!(dt > 0) || !world) {
      return;
    }
    const t0 = performance.now();
    const bodySyncChanges = syncBodies(entityCount);
    const t1 = performance.now();
    const jointSyncChanges = syncJoints();
    const t2 = performance.now();
    const commandCount = drainCommands();
    const t3 = performance.now();
    if (!sleepingEnabled) {
      enforceAwakeDynamics();
    }
    applyForcesAndTorque();
    const t4 = performance.now();
    world.step(dt, solverSteps);
    const t5 = performance.now();
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

  function controlLoop() {
    running = true;
    while (running) {
      const wait = Atomics.wait(ctrlI32, CTRL.STATE, 0);
      if (Atomics.load(ctrlI32, CTRL.STATE) !== 1) {
        continue;
      }
      try {
        doStep();
        Atomics.store(ctrlI32, CTRL.STATE, 2);
        Atomics.notify(ctrlI32, CTRL.STATE, 1);
      } catch (err) {
        console.error('[weedjs-box2d] step failed', err);
        Atomics.store(ctrlI32, CTRL.STATE, 3);
        Atomics.notify(ctrlI32, CTRL.STATE, 1);
        postMessage({
          type: 'WEEDJS_ERROR',
          message: err?.message ?? String(err),
        });
      }
    }
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
    ]);
    bodySetAngularVelocityFn = Module.cwrap(
      'body_set_angular_velocity',
      null,
      ['number', 'number'],
    );
    bodySetAwakeFn = Module.cwrap('body_set_awake', null, ['number', 'number']);
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
    ctrlI32 = new Int32Array(data.controlSab);
    ctrlF32 = new Float32Array(data.controlSab, 16, 4);
    if (data.commandSab) {
      cmdI32 = new Int32Array(data.commandSab);
      cmdF32 = new Float32Array(data.commandSab);
    }
    if (data.contactSab) {
      Box2dContactRing.bindContactRing(data.contactSab);
      contactRingI32 = new Int32Array(data.contactSab);
    } else {
      contactRingI32 = null;
    }
    Atomics.store(ctrlI32, CTRL.ENTITY_COUNT, data.entityCount | 0);
    Atomics.store(ctrlI32, CTRL.SUBSTEPS, data.subSteps | 0 || 4);
    Atomics.store(ctrlI32, CTRL.STATE, 0);

    bindWeedViews(data.views);
    bindBodySyncViews(data.bodySync);
    bindJointViews(data.jointViews, data.maxJoints | 0);
    if (data.stats) {
      statsF32 = viewFromDesc(data.stats, Float32Array);
    } else {
      statsF32 = null;
    }
    const entityCount = data.entityCount | 0;
    hasBody = new Uint8Array(entityCount);
    denseList = new Uint16Array(entityCount);
    densePositions = new Int32Array(entityCount);
    densePositions.fill(-1);
    seenBodyGeneration = new Int32Array(entityCount);

    const ready = world.getReadyPayload();
    bindStateChannels(ready, entityCount);

    postMessage({
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
    });

    // Run control loop on this worker (blocks pthread main — OK, Box2D tasks use pool)
    setTimeout(controlLoop, 0);
  }

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
      if (data.sleeping !== undefined) {
        sleepingEnabled = data.sleeping !== false;
      }
      if (ctrlI32) {
        if (data.subSteps != null) {
          Atomics.store(ctrlI32, CTRL.SUBSTEPS, data.subSteps | 0);
        }
        if (data.entityCount != null) {
          Atomics.store(ctrlI32, CTRL.ENTITY_COUNT, data.entityCount | 0);
        }
      }
    }
  };

  Module.onRuntimeInitialized = function () {
    postMessage({ type: 'WEEDJS_MODULE_READY' });
  };
})();
