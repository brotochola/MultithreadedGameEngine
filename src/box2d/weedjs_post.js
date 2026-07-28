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
  let pxChan = null;
  let pyChan = null;
  let rotChan = null;
  let vxChan = null;
  let vyChan = null;
  let angChan = null;
  let sleepingU8 = null;
  let running = false;

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

  let bodyApplyForceCenterFn = null;
  let bodyApplyTorqueFn = null;
  let bodySetLinearVelocityFn = null;
  let bodySetTransformFn = null;
  let bodySetAngularVelocityFn = null;
  let bodySetAwakeFn = null;
  let bodySetFixedRotationFn = null;

  function drainCommands() {
    if (!cmdI32 || !cmdF32) return;
    drainBox2dCommandRing(cmdI32, cmdF32, {
      setTransform(entity, x, y, angle) {
        if (!hasBody[entity]) return;
        bodySetAwakeFn(entity, 1);
        const a = isFixedRotation(entity) ? 0 : angle;
        bodySetTransformFn(entity, x, y, a);
      },
      setVelocity(entity, vx, vy) {
        if (!hasBody[entity]) return;
        if (vx !== 0 || vy !== 0) bodySetAwakeFn(entity, 1);
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
        if (w !== 0) bodySetAwakeFn(entity, 1);
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
    drainCommands();
    applyForcesAndTorque();
    world.step(dt, solverSteps);
    afterStep();
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
