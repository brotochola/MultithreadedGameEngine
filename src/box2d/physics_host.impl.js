// Classic physics host — Scene's workers.physics IS box2d_wasm + weedjs_post + this file.
// Speak Weed protocol (init/start/…) and call weedjsDoStep in-process (no nest Atomics).
// Loaded only when wired as the physics worker (B2); skip on em-pthread pool threads.
//
// ponytail: classic SoA bind mirrors Component.initializeArrays schemas — keep in sync
// with Transform / RigidBody / Collider ARRAY_SCHEMA (upgrade: shared classic schema module).

(function (global) {
  if (typeof self !== 'undefined' && self.name === 'em-pthread') {
    return;
  }
  if (typeof weedjsEnableHostMode !== 'function' || typeof weedjsDoStep !== 'function') {
    console.error('[physics_host] weedjs host APIs missing — load after weedjs_post.js');
    return;
  }

  weedjsEnableHostMode();

  var MAX_POLYGON_VERTICES = 8;
  var MAX_BODIES_HINT = 65535;

  var PHYSICS_DEFAULTS = {
    subStepCount: 4,
    contactHertz: 30,
    contactDampingRatio: 0.7,
    gravity: { x: 0, y: 0 },
    lengthUnitsPerMeter: 100,
    contactSpeed: 1000,
    maximumLinearSpeed: 50000,
    box2dWorkerCount: 4,
    contactRingCapacity: 65536,
    sleeping: true,
  };

  // Mirrors PHYSICS_STATS (workers-utils.js) — host writes FPS / STEP_MS / MSG_MS.
  var PS = {
    FPS: 0,
    STEP_MS: 1,
    MSG_MS: 2,
  };

  var TRANSFORM_SCHEMA = {
    active: Uint8Array,
    entityType: Uint8Array,
    isItOnScreen: Uint8Array,
    x: Float32Array,
    y: Float32Array,
    rotation: Float32Array,
  };

  var RIGIDBODY_SCHEMA = {
    active: Uint8Array,
    static: Uint8Array,
    vx: Float32Array,
    vy: Float32Array,
    ax: Float32Array,
    ay: Float32Array,
    px: Float32Array,
    py: Float32Array,
    pRotation: Float32Array,
    angularVelocity: Float32Array,
    angularAccel: Float32Array,
    mass: Float32Array,
    invMass: Float32Array,
    inertia: Float32Array,
    invInertia: Float32Array,
    linearDamping: Float32Array,
    angularDamping: Float32Array,
    fixedRotation: Uint8Array,
    velocityAngle: Float32Array,
    speed: Float32Array,
    sleeping: Uint8Array,
  };

  var COLLIDER_SCHEMA = {
    active: Uint8Array,
    shapeType: Uint8Array,
    offsetX: Float32Array,
    offsetY: Float32Array,
    radius: Float32Array,
    width: Float32Array,
    height: Float32Array,
    isTrigger: Uint8Array,
    collisionLayer: Uint8Array,
    collisionMask: Uint32Array,
    collisionGroupIndex: Int32Array,
    friction: Float32Array,
    visualRange: Float32Array,
    polyCount: Uint8Array,
    polyCentroidX: Float32Array,
    polyCentroidY: Float32Array,
    polyVertexX: { type: Float32Array, length: MAX_POLYGON_VERTICES },
    polyVertexY: { type: Float32Array, length: MAX_POLYGON_VERTICES },
    polyNormalX: { type: Float32Array, length: MAX_POLYGON_VERTICES },
    polyNormalY: { type: Float32Array, length: MAX_POLYGON_VERTICES },
  };

  function schemaEntry(typeOrSpec) {
    if (typeOrSpec && typeof typeOrSpec === 'object' && typeOrSpec.type) {
      return { type: typeOrSpec.type, length: typeOrSpec.length | 0 || 1 };
    }
    return { type: typeOrSpec, length: 1 };
  }

  function bindSchema(buffer, count, schema) {
    var views = {};
    var offset = 0;
    var names = Object.keys(schema);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var entry = schemaEntry(schema[name]);
      var type = entry.type;
      var elements = count * entry.length;
      var bytesPerElement = type.BYTES_PER_ELEMENT;
      var remainder = offset % bytesPerElement;
      if (remainder !== 0) {
        offset += bytesPerElement - remainder;
      }
      views[name] = new type(buffer, offset, elements);
      offset += elements * bytesPerElement;
    }
    return views;
  }

  function packView(arr) {
    return {
      sab: arr.buffer,
      byteOffset: arr.byteOffset,
      length: arr.length,
    };
  }

  function validatePhysicsConfig(current, next) {
    var base = current || PHYSICS_DEFAULTS;
    var n = next || {};
    var g = n.gravity || base.gravity || PHYSICS_DEFAULTS.gravity;
    return {
      subStepCount: Math.max(
        1,
        (n.subStepCount != null ? n.subStepCount : base.subStepCount) | 0,
      ),
      contactHertz:
        n.contactHertz != null ? n.contactHertz : base.contactHertz,
      contactDampingRatio:
        n.contactDampingRatio != null
          ? n.contactDampingRatio
          : base.contactDampingRatio,
      gravity: { x: g.x || 0, y: g.y || 0 },
      lengthUnitsPerMeter:
        n.lengthUnitsPerMeter != null
          ? n.lengthUnitsPerMeter
          : base.lengthUnitsPerMeter,
      contactSpeed:
        n.contactSpeed != null ? n.contactSpeed : base.contactSpeed,
      maximumLinearSpeed:
        n.maximumLinearSpeed != null
          ? n.maximumLinearSpeed
          : base.maximumLinearSpeed,
      box2dWorkerCount:
        n.box2dWorkerCount != null
          ? n.box2dWorkerCount
          : base.box2dWorkerCount,
      contactRingCapacity:
        n.contactRingCapacity != null
          ? n.contactRingCapacity
          : base.contactRingCapacity,
      sleeping: n.sleeping != null ? n.sleeping : base.sleeping,
    };
  }

  function bindJointViews(buffer, maxJoints) {
    var n = maxJoints;
    var offset = 0;
    var align4 = function (o) {
      return Math.ceil(o / 4) * 4;
    };
    var type = new Uint8Array(buffer, offset, n);
    offset = align4(offset + n);
    var pairs = new Uint32Array(buffer, offset, n);
    offset += n * 4;
    var localAnchorAX = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var localAnchorAY = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var localAnchorBX = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var localAnchorBY = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var active = new Uint8Array(buffer, offset, n);
    offset = align4(offset + n);
    var length = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var enableSpring = new Uint8Array(buffer, offset, n);
    offset = align4(offset + n);
    var hertz = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var dampingRatio = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var enableLimit = new Uint8Array(buffer, offset, n);
    offset = align4(offset + n);
    var lowerAngle = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var upperAngle = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var enableMotor = new Uint8Array(buffer, offset, n);
    offset = align4(offset + n);
    var motorSpeed = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var maxMotorTorque = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var linearHertz = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var angularHertz = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var linearDampingRatio = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var angularDampingRatio = new Float32Array(buffer, offset, n);
    offset += n * 4;
    var activeIndices = new Uint16Array(buffer, offset, n);
    offset += n * 2;
    offset += n * 2; // activeIndexPositions
    var activeCount = new Int32Array(buffer, offset, 1);
    offset += 8;
    var revision = new Uint32Array(buffer, offset, n);
    return {
      type: type,
      pairs: pairs,
      localAnchorAX: localAnchorAX,
      localAnchorAY: localAnchorAY,
      localAnchorBX: localAnchorBX,
      localAnchorBY: localAnchorBY,
      active: active,
      length: length,
      enableSpring: enableSpring,
      hertz: hertz,
      dampingRatio: dampingRatio,
      enableLimit: enableLimit,
      lowerAngle: lowerAngle,
      upperAngle: upperAngle,
      enableMotor: enableMotor,
      motorSpeed: motorSpeed,
      maxMotorTorque: maxMotorTorque,
      linearHertz: linearHertz,
      angularHertz: angularHertz,
      linearDampingRatio: linearDampingRatio,
      angularDampingRatio: angularDampingRatio,
      activeIndices: activeIndices,
      activeCount: activeCount,
      revision: revision,
    };
  }

  var state = {
    config: {},
    settings: null,
    sleepingEnabled: true,
    globalEntityCount: 0,
    stats: null,
    frameRateData: null,
    frameRateIndex: -1,
    frameRateStride: 1,
    commandSab: null,
    contactSab: null,
    movedSab: null,
    bodySyncViews: null,
    transform: null,
    rigidBody: null,
    collider: null,
    jointsEnabled: false,
    maxJoints: 0,
    jointViews: null,
    box2dReady: false,
    isPaused: true,
    lastFrameTime: 0,
    frameNumber: 0,
    currentFPS: 0,
    messageTimeThisFrame: 0,
    noLimitFPS: false,
    fixedFps: 0,
    intervalId: 0,
    posePublish: null,
    workerPorts: new Map(),
    timeoutId: 0,
  };

  function reportReady() {
    self.postMessage({ msg: 'workerReady', worker: 'PhysicsHost' });
  }

  function reportError(title, err) {
    self.postMessage({
      msg: 'error',
      title: title,
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack,
      when: Date.now(),
    });
  }

  function writeFPS() {
    if (state.frameRateData && state.frameRateIndex >= 0) {
      state.frameRateData[state.frameRateIndex * state.frameRateStride] =
        state.currentFPS;
    }
    if (state.stats) {
      state.stats[PS.FPS] = state.currentFPS;
      state.stats[PS.MSG_MS] = state.messageTimeThisFrame;
    }
  }

  function fanoutBox2dReady(ready) {
    self.postMessage({
      msg: 'box2dReady',
      sab: ready.sab,
      bodyCapacity: ready.bodyCapacity,
      channelOffsets: ready.channelOffsets,
      sleepingByteOffset: ready.sleepingByteOffset,
      commandSab: state.commandSab,
      contactSab: state.contactSab,
      movedSab: state.movedSab,
      eventHeaderBaseIndex: ready.eventHeaderBaseIndex,
      contactBeginBaseIndex: ready.contactBeginBaseIndex,
      contactEndBaseIndex: ready.contactEndBaseIndex,
      sensorBeginBaseIndex: ready.sensorBeginBaseIndex,
      sensorEndBaseIndex: ready.sensorEndBaseIndex,
      contactEventCapacity: ready.contactEventCapacity,
      sensorEventCapacity: ready.sensorEventCapacity,
      contactPairIntStride: ready.contactPairIntStride || 2,
      eventHeaderIntCount: ready.eventHeaderIntCount || 8,
    });
  }

  function bootWorld() {
    var entityCount = state.globalEntityCount | 0;
    var maxBodies = Math.min(entityCount, MAX_BODIES_HINT);
    if (entityCount > MAX_BODIES_HINT) {
      throw new Error(
        'Physics: totalEntityCount ' +
          entityCount +
          ' exceeds Box2D MAX_BODIES ' +
          MAX_BODIES_HINT,
      );
    }

    state.commandSab = Box2dCommandRing.createCommandRingSab();
    Box2dCommandRing.bindCommandRing(state.commandSab);
    state.contactSab = Box2dContactRing.createContactRingSab(
      state.settings.contactRingCapacity,
    );
    state.movedSab = Box2dMovedBodies.createMovedBodiesSab(entityCount);
    Box2dMovedBodies.bindMovedBodies(state.movedSab);

    var s = state.settings;
    var T = state.transform;
    var R = state.rigidBody;
    var C = state.collider;
    var initPayload = {
      type: 'WEEDJS_INIT',
      gravityX: s.gravity.x,
      gravityY: s.gravity.y,
      lengthUnitsPerMeter: s.lengthUnitsPerMeter,
      contactHertz: s.contactHertz,
      contactDampingRatio: s.contactDampingRatio,
      contactSpeed: s.contactSpeed,
      maximumLinearSpeed: s.maximumLinearSpeed,
      box2dWorkerCount: s.box2dWorkerCount,
      maxBodies: maxBodies,
      entityCount: entityCount,
      subSteps: s.subStepCount,
      sleeping: state.sleepingEnabled !== false,
      commandSab: state.commandSab,
      contactSab: state.contactSab,
      movedSab: state.movedSab,
      stats: state.stats ? packView(state.stats) : null,
      posePublish: state.posePublish
        ? {
            dataA: state.posePublish.dataA,
            dataB: state.posePublish.dataB,
            sync: state.posePublish.sync,
            capacity: state.posePublish.capacity | 0,
          }
        : null,
      bodySync: state.bodySyncViews
        ? {
            dirtyFlags: packView(state.bodySyncViews.dirtyFlags),
            dirtyWords: packView(state.bodySyncViews.dirtyWords),
            generation: packView(state.bodySyncViews.generation),
          }
        : null,
      views: {
        entityActive: packView(T.active),
        x: packView(T.x),
        y: packView(T.y),
        rotation: packView(T.rotation),
        rbActive: packView(R.active),
        rbStatic: packView(R.static),
        vx: packView(R.vx),
        vy: packView(R.vy),
        ax: packView(R.ax),
        ay: packView(R.ay),
        px: packView(R.px),
        py: packView(R.py),
        pRotation: packView(R.pRotation),
        angularVelocity: packView(R.angularVelocity),
        angularAccel: packView(R.angularAccel),
        mass: packView(R.mass),
        linearDamping: packView(R.linearDamping),
        angularDamping: packView(R.angularDamping),
        sleeping: packView(R.sleeping),
        fixedRotation: packView(R.fixedRotation),
        colActive: packView(C.active),
        offsetX: packView(C.offsetX),
        offsetY: packView(C.offsetY),
        shapeType: packView(C.shapeType),
        radius: packView(C.radius),
        width: packView(C.width),
        height: packView(C.height),
        isTrigger: packView(C.isTrigger),
        collisionLayer: packView(C.collisionLayer),
        collisionMask: packView(C.collisionMask),
        collisionGroupIndex: packView(C.collisionGroupIndex),
        friction: packView(C.friction),
        polyCount: packView(C.polyCount),
        polyVertexX: packView(C.polyVertexX),
        polyVertexY: packView(C.polyVertexY),
      },
    };

    if (state.jointsEnabled && state.jointViews) {
      var J = state.jointViews;
      initPayload.maxJoints = state.maxJoints;
      initPayload.jointViews = {
        type: packView(J.type),
        pairs: packView(J.pairs),
        localAnchorAX: packView(J.localAnchorAX),
        localAnchorAY: packView(J.localAnchorAY),
        localAnchorBX: packView(J.localAnchorBX),
        localAnchorBY: packView(J.localAnchorBY),
        active: packView(J.active),
        length: packView(J.length),
        enableSpring: packView(J.enableSpring),
        hertz: packView(J.hertz),
        dampingRatio: packView(J.dampingRatio),
        enableLimit: packView(J.enableLimit),
        lowerAngle: packView(J.lowerAngle),
        upperAngle: packView(J.upperAngle),
        enableMotor: packView(J.enableMotor),
        motorSpeed: packView(J.motorSpeed),
        maxMotorTorque: packView(J.maxMotorTorque),
        linearHertz: packView(J.linearHertz),
        angularHertz: packView(J.angularHertz),
        linearDampingRatio: packView(J.linearDampingRatio),
        angularDampingRatio: packView(J.angularDampingRatio),
        activeIndices: packView(J.activeIndices),
        activeCount: packView(J.activeCount),
        revision: packView(J.revision),
      };
    }

    global.weedjsOnReady = function (ready) {
      state.box2dReady = true;
      fanoutBox2dReady(ready);
      console.log(
        '[physics_host] Box2D READY + hot rebind + command ring',
        ready.bodyCapacity,
      );
    };

    weedjsHandleInit(initPayload);
  }

  function applyPhysicsConfig(partial) {
    state.config.physics = Object.assign(
      {},
      state.config.physics || {},
      partial || {},
    );
    state.settings = validatePhysicsConfig(
      state.settings,
      state.config.physics,
    );
    state.sleepingEnabled =
      state.config.physics.sleeping != null
        ? state.config.physics.sleeping
        : PHYSICS_DEFAULTS.sleeping;

    if (state.box2dReady) {
      weedjsApplyConfig({
        subSteps: state.settings.subStepCount,
        sleeping: state.sleepingEnabled !== false,
      });
    }
  }

  function initializeWorkerPorts(ports) {
    if (!ports) return;
    var keys = Object.keys(ports);
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      var port = ports[name];
      state.workerPorts.set(name, port);
      port.onmessage = function () {
        /* physics host: ports reserved for renderer link; no entity scripts */
      };
    }
  }

  function initializeFromWeedInit(data) {
    state.config = data.config || {};
    state.globalEntityCount = data.globalEntityCount | 0;
    state.posePublish = data.posePublish || null;

    if (data.buffers && data.buffers.physicsStats) {
      state.stats = new Float32Array(data.buffers.physicsStats);
    }
    if (data.buffers && data.buffers.frameRateData) {
      state.frameRateData = new Float32Array(data.buffers.frameRateData);
    }
    if (data.frameRateIndex !== undefined) {
      state.frameRateIndex = data.frameRateIndex | 0;
    }
    if (data.frameRateStride !== undefined) {
      state.frameRateStride = data.frameRateStride | 0 || 1;
    }

    var physCfg = state.config.physics || {};
    var fixedFps = Number(physCfg.fixedFps);
    if (fixedFps > 0) {
      state.fixedFps = fixedFps;
      state.noLimitFPS = false;
    } else if (physCfg.noLimitFPS === true) {
      state.noLimitFPS = true;
    }

    var buffers = data.buffers || {};
    var componentData = buffers.componentData || {};
    if (!componentData.Transform || !componentData.RigidBody || !componentData.Collider) {
      throw new Error('[physics_host] init missing Transform/RigidBody/Collider buffers');
    }

    state.transform = bindSchema(
      componentData.Transform,
      state.globalEntityCount,
      TRANSFORM_SCHEMA,
    );
    state.rigidBody = bindSchema(
      componentData.RigidBody,
      state.globalEntityCount,
      RIGIDBODY_SCHEMA,
    );
    state.collider = bindSchema(
      componentData.Collider,
      state.globalEntityCount,
      COLLIDER_SCHEMA,
    );

    if (buffers.bodyDirtyFlags && buffers.bodyDirtyWords && buffers.bodyGeneration) {
      state.bodySyncViews = {
        dirtyFlags: new Int32Array(buffers.bodyDirtyFlags),
        dirtyWords: new Int32Array(buffers.bodyDirtyWords),
        generation: new Int32Array(buffers.bodyGeneration),
      };
    } else {
      state.bodySyncViews = null;
    }

    if (data.joints && data.joints.enabled) {
      state.jointsEnabled = true;
      state.maxJoints = data.joints.maxJoints | 0;
      state.jointViews = bindJointViews(data.joints.data, state.maxJoints);
    }

    initializeWorkerPorts(data.workerPorts);
    applyPhysicsConfig(physCfg);

    weedjsWhenModuleReady(function () {
      try {
        bootWorld();
        reportReady();
      } catch (err) {
        console.error('[physics_host] boot failed', err);
        reportError('Physics host boot failed', err);
      }
    });
  }

  function gameLoop() {
    if (state.isPaused) return;

    state.frameNumber++;
    var now = performance.now();
    var deltaTime = now - state.lastFrameTime;
    if (!(deltaTime > 0) || deltaTime > 1000) {
      deltaTime = 1000 / 60;
    }
    state.lastFrameTime = now;
    state.currentFPS = 1000 / deltaTime;

    if (state.box2dReady) {
      var t0 = performance.now();
      var dt = deltaTime / 1000;
      if (dt > 1 / 20) dt = 1 / 20;
      if (dt > 0) {
        weedjsDoStep(dt, state.settings.subStepCount);
      }
      if (state.stats) {
        state.stats[PS.STEP_MS] = performance.now() - t0;
      }
    }

    writeFPS();
    state.messageTimeThisFrame = 0;

    if (state.fixedFps > 0) {
      if (!state.intervalId) {
        state.intervalId = setInterval(gameLoop, 1000 / state.fixedFps);
      }
    } else if (state.noLimitFPS) {
      state.timeoutId = setTimeout(gameLoop, 2);
    } else {
      requestAnimationFrame(gameLoop);
    }
  }

  function clearSchedulers() {
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = 0;
    }
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = 0;
    }
  }

  function startGameLoop() {
    state.isPaused = false;
    state.lastFrameTime = performance.now();
    clearSchedulers();
    gameLoop();
  }

  self.onmessage = function (event) {
    var data = event.data;
    if (!data || !data.msg) return;
    var t0 = performance.now();
    try {
      if (data.msg === 'init') {
        state.isPaused = true;
        initializeFromWeedInit(data);
      } else if (data.msg === 'start') {
        startGameLoop();
      } else if (data.msg === 'pause') {
        state.isPaused = true;
        clearSchedulers();
      } else if (data.msg === 'resume') {
        startGameLoop();
      } else if (data.msg === 'updatePhysicsConfig') {
        applyPhysicsConfig(data.config || {});
      }
    } catch (err) {
      console.error('[physics_host]', err);
      reportError('Physics host message failed', err);
    }
    state.messageTimeThisFrame += performance.now() - t0;
  };

  self.postMessage({
    msg: 'log',
    message: 'physics_host loaded',
    when: Date.now(),
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
