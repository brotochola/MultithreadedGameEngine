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
  );
  const drainBox2dCommandRing = Box2dCommandRing.drainCommandRing;

  const CTRL = {
    STATE: 0, // 0 idle, 1 step, 2 done, 3 fatal
    SUBSTEPS: 1,
    ENTITY_COUNT: 2,
  };

  const MAX_POLY_VERTS = 8;
  // Units: px, px/s, px/s², rad, rad/s (Box2D native — no frame-unit scale).

  let world = null;
  let verdletSubSteps = 4;
  let ctrlI32 = null;
  let ctrlF32 = null;
  let cmdI32 = null;
  let cmdF32 = null;
  let views = null;
  let hasBody = null;
  let denseList = null;
  let denseCount = 0;
  let jointViews = null;
  let jointHandle = null; // Int32Array, -1 = none
  let jointFp = null; // Float32Array fingerprint per joint
  let jointLive = null; // Uint8Array scratch
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
  };

  function viewFromDesc(desc, TypedArray) {
    return new TypedArray(desc.sab, desc.byteOffset, desc.length);
  }

  function bindWeedViews(desc) {
    views = {
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

  function bindJointViews(desc, maxJ) {
    if (!desc || !(maxJ > 0)) {
      jointViews = null;
      jointHandle = null;
      jointFp = null;
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
    };
    jointHandle = new Int32Array(maxJoints);
    jointHandle.fill(-1);
    jointFp = new Float32Array(maxJoints);
    jointFp.fill(NaN);
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

  function createBodyForEntity(i) {
    const isStatic = views.rbStatic[i] !== 0;
    const type = isStatic ? Box2dBodyType.STATIC : Box2dBodyType.DYNAMIC;
    const shape = views.shapeType[i] | 0;
    const friction = views.friction[i] || 0.3;
    const linearDamping = views.linearDamping[i] || 0;
    const angularDamping = views.angularDamping[i] || 0;
    const angle = isFixedRotation(i) ? 0 : views.rotation[i];
    const opts = {
      type,
      x: views.x[i],
      y: views.y[i],
      angle,
      density: 1,
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

  function syncBodies(entityCount) {
    denseCount = 0;
    const bodyCap = hasBody ? hasBody.length : 0;
    const n = Math.min(entityCount | 0, bodyCap);
    for (let i = 0; i < n; i++) {
      const want =
        views.rbActive[i] !== 0 && views.colActive[i] !== 0 ? 1 : 0;
      const have = hasBody[i];
      if (want && !have) {
        if (createBodyForEntity(i)) {
          hasBody[i] = 1;
        }
      } else if (!want && have) {
        try {
          world.destroyBody(i);
        } catch (_) {
          /* slot may already be clear */
        }
        hasBody[i] = 0;
      }
      if (hasBody[i]) {
        denseList[denseCount++] = i;
      }
    }
  }

  function jointFingerprint(idx) {
    const jv = jointViews;
    const t = jv.type[idx] | 0;
    // Cheap fingerprint: type + anchors + type-specific floats
    let fp =
      t * 1e6 +
      jv.localAnchorAX[idx] +
      jv.localAnchorAY[idx] * 1.1 +
      jv.localAnchorBX[idx] * 1.2 +
      jv.localAnchorBY[idx] * 1.3;
    if (t === JOINT_TYPE.DISTANCE) {
      fp +=
        jv.length[idx] * 2 +
        (jv.enableSpring[idx] ? 100 : 0) +
        jv.hertz[idx] * 3 +
        jv.dampingRatio[idx] * 4;
    } else if (t === JOINT_TYPE.REVOLUTE) {
      fp +=
        (jv.enableLimit[idx] ? 10 : 0) +
        jv.lowerAngle[idx] +
        jv.upperAngle[idx] * 1.5 +
        (jv.enableMotor[idx] ? 20 : 0) +
        jv.motorSpeed[idx] * 2 +
        jv.maxMotorTorque[idx] * 3;
    } else if (t === JOINT_TYPE.WELD) {
      fp +=
        jv.linearHertz[idx] +
        jv.angularHertz[idx] * 1.1 +
        jv.linearDampingRatio[idx] * 1.2 +
        jv.angularDampingRatio[idx] * 1.3;
    }
    return fp;
  }

  function destroyJointAt(idx) {
    const h = jointHandle[idx];
    if (h < 0) return;
    try {
      world.destroyJoint(h);
    } catch (_) {
      /* already gone with body */
    }
    jointHandle[idx] = -1;
    jointFp[idx] = NaN;
  }

  function createJointAt(idx) {
    const jv = jointViews;
    const packed = jv.pairs[idx];
    const a = packed >>> 16;
    const b = packed & 0xffff;
    if (a === b || !hasBody[a] || !hasBody[b]) return false;
    // -2 = permanent fail this session (avoid per-frame retry / leak storm)
    if (jointHandle[idx] === -2) return false;

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
    jointFp[idx] = jointFingerprint(idx);
    return true;
  }

  function syncJoints() {
    if (!jointViews || !jointHandle || !world) return;
    const jv = jointViews;
    const activeCount = Atomics.load(jv.activeCount, 0) | 0;
    jointLive.fill(0);

    for (let slot = 0; slot < activeCount; slot++) {
      const idx = jv.activeIndices[slot];
      if (idx === 0xffff || !jv.active[idx]) continue;
      jointLive[idx] = 1;
      const packed = jv.pairs[idx];
      const a = packed >>> 16;
      const b = packed & 0xffff;
      const want = hasBody[a] && hasBody[b] ? 1 : 0;
      const have = jointHandle[idx] >= 0 ? 1 : 0;
      const fp = jointFingerprint(idx);
      if (want && have && jointFp[idx] !== fp) {
        destroyJointAt(idx);
        createJointAt(idx);
      } else if (want && !have) {
        createJointAt(idx);
      } else if (!want && have) {
        destroyJointAt(idx);
      }
    }

    for (let i = 0; i < maxJoints; i++) {
      if (!jointLive[i] && jointHandle[i] >= 0) {
        destroyJointAt(i);
      }
    }
  }

  let sleepingEnabled = true;

  let bodyApplyForceCenterFn = null;
  let bodyApplyTorqueFn = null;
  let bodySetLinearVelocityFn = null;
  let bodySetTransformFn = null;
  let bodySetAngularVelocityFn = null;
  let bodySetAwakeFn = null;
  let bodySetFixedRotationFn = null;

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
    if (!cmdI32 || !cmdF32) return;
    drainBox2dCommandRing(cmdI32, cmdF32, cmdHandlers);
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

  function writePhysicsStats() {
    if (!statsF32) return;
    statsF32[PS.BODY_COUNT] = denseCount;
    statsF32[PS.JOINT_COUNT] = world ? world.getJointCount() : 0;
    const hdr = world && world._eventHeader;
    if (hdr) {
      statsF32[PS.CONTACT_BEGIN] = hdr[EVENT_HEADER.CONTACT_BEGIN_COUNT] | 0;
      statsF32[PS.CONTACT_END] = hdr[EVENT_HEADER.CONTACT_END_COUNT] | 0;
      statsF32[PS.SENSOR_BEGIN] = hdr[EVENT_HEADER.SENSOR_BEGIN_COUNT] | 0;
      statsF32[PS.SENSOR_END] = hdr[EVENT_HEADER.SENSOR_END_COUNT] | 0;
    } else {
      statsF32[PS.CONTACT_BEGIN] = 0;
      statsF32[PS.CONTACT_END] = 0;
      statsF32[PS.SENSOR_BEGIN] = 0;
      statsF32[PS.SENSOR_END] = 0;
    }
    if (jointViews && jointViews.activeCount) {
      statsF32[PS.WEED_JOINTS] = Atomics.load(jointViews.activeCount, 0) | 0;
    } else {
      statsF32[PS.WEED_JOINTS] = 0;
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
    syncBodies(entityCount);
    syncJoints();
    drainCommands();
    if (!sleepingEnabled) {
      enforceAwakeDynamics();
    }
    applyForcesAndTorque();
    world.step(dt, solverSteps);
    afterStep();
    writePhysicsStats();
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

    ctrlI32 = new Int32Array(data.controlSab);
    ctrlF32 = new Float32Array(data.controlSab, 16, 4);
    if (data.commandSab) {
      cmdI32 = new Int32Array(data.commandSab);
      cmdF32 = new Float32Array(data.commandSab);
    }
    Atomics.store(ctrlI32, CTRL.ENTITY_COUNT, data.entityCount | 0);
    Atomics.store(ctrlI32, CTRL.SUBSTEPS, data.subSteps | 0 || 4);
    Atomics.store(ctrlI32, CTRL.STATE, 0);

    bindWeedViews(data.views);
    bindJointViews(data.jointViews, data.maxJoints | 0);
    if (data.stats) {
      statsF32 = viewFromDesc(data.stats, Float32Array);
    } else {
      statsF32 = null;
    }
    const entityCount = data.entityCount | 0;
    hasBody = new Uint8Array(entityCount);
    denseList = new Uint16Array(entityCount);

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
