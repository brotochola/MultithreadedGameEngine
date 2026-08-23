// physics-api.js — thin ergonomic layer over wasm cwrap.
// Requires: box2d_wasm.js loaded first (Module global).

function createPhysicsApi(Module) {
  const wrap = (name, ret, args) => Module.cwrap(name, ret, args);

  const createWorld = wrap("create_world", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const worldEnableSleeping = wrap("world_enable_sleeping", null, [
    "number",
    "number",
  ]);
  const bindGameBuffers = wrap("bind_game_buffers", "number", ["number"]);
  const createBodyBox = wrap("create_body_box", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createBodyCircle = wrap("create_body_circle", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createBodyPolygon = wrap("create_body_polygon", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const destroyBody = wrap("destroy_body", null, ["number"]);
  const bodySetTransform = wrap("body_set_transform", null, [
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const bodySetLinearVelocity = wrap("body_set_linear_velocity", null, [
    "number",
    "number",
    "number",
  ]);
  const bodySetAngularVelocity = wrap("body_set_angular_velocity", null, [
    "number",
    "number",
  ]);
  const bodySetFixedRotation = wrap("body_set_fixed_rotation", null, [
    "number",
    "number",
  ]);
  const bodyApplyForce = wrap("body_apply_force", null, [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const bodyApplyForceCenter = wrap("body_apply_force_center", null, [
    "number",
    "number",
    "number",
    "number",
  ]);
  const bodySetLinearDamping = wrap("body_set_linear_damping", null, [
    "number",
    "number",
  ]);
  const bodySetAngularDamping = wrap("body_set_angular_damping", null, [
    "number",
    "number",
  ]);
  const bodySetGravityScale = wrap("body_set_gravity_scale", null, [
    "number",
    "number",
  ]);
  const bodyApplyLinearImpulse = wrap("body_apply_linear_impulse", null, [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const bodyApplyLinearImpulseCenter = wrap(
    "body_apply_linear_impulse_center",
    null,
    ["number", "number", "number", "number"],
  );
  const bodyApplyAngularImpulse = wrap("body_apply_angular_impulse", null, [
    "number",
    "number",
    "number",
  ]);
  const bodyApplyTorque = wrap("body_apply_torque", null, [
    "number",
    "number",
    "number",
  ]);
  const bodySetAwake = wrap("body_set_awake", null, ["number", "number"]);
  const bodySetFilter = wrap("body_set_filter", null, [
    "number",
    "number",
    "number",
    "number",
  ]);
  const overlapAabbIntoFn = wrap("overlap_aabb_into", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const overlapCircleFn = wrap("overlap_circle", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const overlapBoxFn = wrap("overlap_box", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const castRayClosestFn = wrap("cast_ray_closest", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const castRayAllFn = wrap("cast_ray_all", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const castMoverFn = wrap("cast_mover", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const collideMoverFn = wrap("collide_mover", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createRevoluteJoint = wrap("create_revolute_joint", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createDistanceJoint = wrap("create_distance_joint", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createPrismaticJoint = wrap("create_prismatic_joint", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createWeldJoint = wrap("create_weld_joint", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createDistanceJointLocal = wrap("create_distance_joint_local", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createRevoluteJointLocal = wrap("create_revolute_joint_local", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createWeldJointLocal = wrap("create_weld_joint_local", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const destroyJoint = wrap("destroy_joint", null, ["number"]);
  const getJointCount = wrap("get_joint_count", "number", []);
  const stepWorld = wrap("step_world", null, ["number", "number", "number"]);
  const getStateByteOffset = wrap("get_state_byte_offset", "number", []);
  const getSleepingByteOffset = wrap("get_sleeping_byte_offset", "number", []);
  const getMetaByteOffset = wrap("get_meta_byte_offset", "number", []);
  const getStateChannelOffset = wrap("get_state_channel_offset", "number", [
    "number",
  ]);
  const getMetaFloatStride = wrap("get_meta_float_stride", "number", []);
  const getBodyCapacity = wrap("get_body_capacity", "number", []);
  const getMaxBodySlots = wrap("get_max_body_slots", "number", []);
  const getSlotCount = wrap("get_slot_count", "number", []);
  const getStateRegionBytes = wrap("get_state_region_bytes", "number", []);
  const getMetaRegionBytes = wrap("get_meta_region_bytes", "number", []);
  const getJointByteOffset = wrap("get_joint_byte_offset", "number", []);
  const getJointFloatStride = wrap("get_joint_float_stride", "number", []);
  const getJointRegionBytes = wrap("get_joint_region_bytes", "number", []);
  const getJointCapacity = wrap("get_joint_capacity", "number", []);
  const getQuerySlotsByteOffset = wrap("get_query_slots_byte_offset", "number", []);
  const getQueryHitsByteOffset = wrap("get_query_hits_byte_offset", "number", []);
  const getEventHeaderByteOffset = wrap("get_event_header_byte_offset", "number", []);
  const getContactBeginByteOffset = wrap("get_contact_begin_byte_offset", "number", []);
  const getContactEndByteOffset = wrap("get_contact_end_byte_offset", "number", []);
  const getContactHitByteOffset = wrap("get_contact_hit_byte_offset", "number", []);
  const getSensorBeginByteOffset = wrap("get_sensor_begin_byte_offset", "number", []);
  const getSensorEndByteOffset = wrap("get_sensor_end_byte_offset", "number", []);
  const getMoverPlanesByteOffset = wrap("get_mover_planes_byte_offset", "number", []);
  const getQueryCapacity = wrap("get_query_capacity", "number", []);
  const getRayHitCapacity = wrap("get_ray_hit_capacity", "number", []);
  const getQueryHitFloatStride = wrap("get_query_hit_float_stride", "number", []);
  const getContactEventCapacity = wrap("get_contact_event_capacity", "number", []);
  const getSensorEventCapacity = wrap("get_sensor_event_capacity", "number", []);
  const getContactHitCapacity = wrap("get_contact_hit_capacity", "number", []);
  const getMoverPlaneCapacity = wrap("get_mover_plane_capacity", "number", []);
  const getMoverPlaneFloatStride = wrap("get_mover_plane_float_stride", "number", []);
  const getEventHeaderIntCount = wrap("get_event_header_int_count", "number", []);
  const getContactPairIntStride = wrap("get_contact_pair_int_stride", "number", []);
  const getBodyMoveCount = wrap("get_body_move_count", "number", []);
  const getBodyMoveByteOffset = wrap("get_body_move_byte_offset", "number", []);
  const getBodyFellAsleepByteOffset = wrap(
    "get_body_fell_asleep_byte_offset",
    "number",
    [],
  );
  const getBodyMoveCapacity = wrap("get_body_move_capacity", "number", []);
  const getAwakeBodyCount = wrap("get_awake_body_count", "number", ["number"]);
  const getProfileByteOffset = wrap("get_profile_byte_offset", "number", []);
  const getProfileFloatCount = wrap("get_profile_float_count", "number", []);
  const getCountersByteOffset = wrap("get_counters_byte_offset", "number", []);
  const getCountersIntCount = wrap("get_counters_int_count", "number", []);
  const getJointEventsByteOffset = wrap(
    "get_joint_events_byte_offset",
    "number",
    [],
  );
  const getJointEventCapacity = wrap("get_joint_event_capacity", "number", []);
  const bodySetRestitution = wrap("body_set_restitution", null, [
    "number",
    "number",
  ]);
  const bodySetSleepThreshold = wrap("body_set_sleep_threshold", null, [
    "number",
    "number",
  ]);
  const worldSetHitEventThreshold = wrap(
    "world_set_hit_event_threshold",
    null,
    ["number", "number"],
  );
  const worldExplode = wrap("world_explode", null, [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const jointConfigure = wrap("joint_configure", null, [
    "number",
    "number",
    "number",
    "number",
  ]);

  const createParticleSystem = wrap("create_particle_system", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const destroyParticleSystem = wrap("destroy_particle_system", null, []);
  const createParticleBox = wrap("create_particle_box", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createParticleGroupBox = wrap("create_particle_group_box", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const createParticleGroupCircle = wrap("create_particle_group_circle", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  const destroyParticleGroup = wrap("destroy_particle_group", null, [
    "number",
  ]);
  const setParticleSubSteps = wrap("set_particle_sub_steps", null, [
    "number",
  ]);
  const getParticleCount = wrap("get_particle_count", "number", []);
  const getParticleCapacity = wrap("get_particle_capacity", "number", []);
  const getParticleRadius = wrap("get_particle_radius", "number", []);
  const getParticleCountByteOffset = wrap("get_particle_count_byte_offset", "number", []);
  const getParticlePosByteOffset = wrap("get_particle_pos_byte_offset", "number", []);
  const getParticleVelByteOffset = wrap("get_particle_vel_byte_offset", "number", []);
  const getParticleFlagsByteOffset = wrap("get_particle_flags_byte_offset", "number", []);

  const DEFAULT_MATERIAL = Object.freeze({
    density: 1.0,
    friction: 0.3,
    restitution: 0.0,
    linearDamping: 0.0,
    angularDamping: 0.0,
    gravityScale: 1.0,
    vx: 0.0,
    vy: 0.0,
    angularVelocity: 0.0,
    isSensor: false,
    enableHitEvents: false,
    categoryBits: 1,
    maskBits: DEFAULT_FILTER_MASK,
  });

  function filterArgs(filter = {}) {
    return {
      categoryBits: filter.categoryBits ?? 1,
      maskBits: filter.maskBits ?? DEFAULT_FILTER_MASK,
    };
  }

  function assertHeapInt32View(view, name = "out") {
    if (!view || view.BYTES_PER_ELEMENT !== 4) {
      throw new TypeError(`${name} must be Int32Array`);
    }
    if (view.buffer !== Module.HEAPF32.buffer) {
      throw new TypeError(
        `${name} must be a view on Module.HEAP32.buffer (use world._querySlots or createOverlapBuffer)`,
      );
    }
  }

  function bindQueryViews(world) {
    const sab = Module.HEAPF32.buffer;
    const queryCapacity = getQueryCapacity();
    const rayHitCapacity = getRayHitCapacity();
    const queryHitStride = getQueryHitFloatStride();
    const contactEventCapacity = getContactEventCapacity();
    const sensorEventCapacity = getSensorEventCapacity();
    const contactHitCapacity = getContactHitCapacity();
    const moverPlaneCapacity = getMoverPlaneCapacity();
    const moverPlaneStride = getMoverPlaneFloatStride();
    const contactPairStride = getContactPairIntStride();
    const eventHeaderCount = getEventHeaderIntCount();

    world._querySlots = new Int32Array(
      sab,
      getQuerySlotsByteOffset(),
      queryCapacity,
    );
    world._queryHits = new Float32Array(
      sab,
      getQueryHitsByteOffset(),
      rayHitCapacity * queryHitStride,
    );
    world._eventHeader = new Int32Array(
      sab,
      getEventHeaderByteOffset(),
      eventHeaderCount,
    );
    world._contactBegin = new Int32Array(
      sab,
      getContactBeginByteOffset(),
      contactEventCapacity * contactPairStride,
    );
    world._contactEnd = new Int32Array(
      sab,
      getContactEndByteOffset(),
      contactEventCapacity * contactPairStride,
    );
    world._contactHit = new Float32Array(
      sab,
      getContactHitByteOffset(),
      contactHitCapacity * queryHitStride,
    );
    world._sensorBegin = new Int32Array(
      sab,
      getSensorBeginByteOffset(),
      sensorEventCapacity * contactPairStride,
    );
    world._sensorEnd = new Int32Array(
      sab,
      getSensorEndByteOffset(),
      sensorEventCapacity * contactPairStride,
    );
    world._moverPlanes = new Float32Array(
      sab,
      getMoverPlanesByteOffset(),
      moverPlaneCapacity * moverPlaneStride,
    );
    const bodyMoveCapacity = getBodyMoveCapacity();
    world._bodyMoved = new Int32Array(
      sab,
      getBodyMoveByteOffset(),
      bodyMoveCapacity,
    );
    world._bodyFellAsleep = new Uint8Array(
      sab,
      getBodyFellAsleepByteOffset(),
      bodyMoveCapacity,
    );
    world._getBodyMoveCount = getBodyMoveCount;
    world._getAwakeBodyCount = getAwakeBodyCount;
    const profileFloats = getProfileFloatCount();
    world._profile = new Float32Array(
      sab,
      getProfileByteOffset(),
      profileFloats,
    );
    const counterInts = getCountersIntCount();
    world._counters = new Int32Array(
      sab,
      getCountersByteOffset(),
      counterInts,
    );
    // Stashed so callers can decode world._contactHit records without re-querying WASM.
    world._contactHitStride = queryHitStride;
    world._jointEvents = new Int32Array(
      sab,
      getJointEventsByteOffset(),
      getJointEventCapacity(),
    );
  }

  class JointHandle {
    constructor(world, handle) {
      this._world = world;
      this.handle = handle;
    }

    destroy() {
      this._world.destroyJoint(this.handle);
    }

    /**
     * Wire break thresholds + weed joint index (read back from joint events after step).
     * @param {number} userDataInt - weed Joint pool index
     * @param {number} [forceThreshold=Infinity]
     * @param {number} [torqueThreshold=Infinity]
     */
    configure(userDataInt, forceThreshold = Infinity, torqueThreshold = Infinity) {
      jointConfigure(this.handle, userDataInt, forceThreshold, torqueThreshold);
    }
  }

  class BodyHandle {
    constructor(world, slot) {
      this._world = world;
      this.slot = slot;
    }

    destroy() {
      this._world.destroyBody(this.slot);
    }

    setTransform(x, y, rotC = 1, rotS = 0) {
      bodySetTransform(this.slot, x, y, rotC, rotS);
    }

    setLinearVelocity(vx, vy) {
      bodySetLinearVelocity(this.slot, vx, vy);
    }

    setAngularVelocity(angularVelocity) {
      bodySetAngularVelocity(this.slot, angularVelocity);
    }

    setFixedRotation(locked = true) {
      bodySetFixedRotation(this.slot, locked ? 1 : 0);
    }

    applyForce(fx, fy, px, py, wake = true) {
      bodyApplyForce(this.slot, fx, fy, px, py, wake ? 1 : 0);
    }

    applyForceCenter(fx, fy, wake = true) {
      bodyApplyForceCenter(this.slot, fx, fy, wake ? 1 : 0);
    }

    applyLinearImpulse(ix, iy, px, py, wake = true) {
      bodyApplyLinearImpulse(this.slot, ix, iy, px, py, wake ? 1 : 0);
    }

    applyLinearImpulseCenter(ix, iy, wake = true) {
      bodyApplyLinearImpulseCenter(this.slot, ix, iy, wake ? 1 : 0);
    }

    applyAngularImpulse(impulse, wake = true) {
      bodyApplyAngularImpulse(this.slot, impulse, wake ? 1 : 0);
    }

    applyTorque(torque, wake = true) {
      bodyApplyTorque(this.slot, torque, wake ? 1 : 0);
    }

    setAwake(awake = true) {
      bodySetAwake(this.slot, awake ? 1 : 0);
    }

    setFilter(categoryBits, maskBits = DEFAULT_FILTER_MASK, groupIndex = 0) {
      bodySetFilter(this.slot, categoryBits, maskBits, groupIndex);
    }

    setLinearDamping(damping) {
      bodySetLinearDamping(this.slot, damping);
    }

    setAngularDamping(damping) {
      bodySetAngularDamping(this.slot, damping);
    }

    setGravityScale(scale) {
      bodySetGravityScale(this.slot, scale);
    }

    setRestitution(value) {
      bodySetRestitution(this.slot, value);
    }

    setSleepThreshold(value) {
      bodySetSleepThreshold(this.slot, value);
    }
  }

  class PhysicsWorld {
    static BODY_TYPE = typeof Box2dBodyType !== 'undefined' ? Box2dBodyType : BODY_TYPE;
    static Box2dBodyType = typeof Box2dBodyType !== 'undefined' ? Box2dBodyType : BODY_TYPE;
    static ShapeType = ShapeType;
    static DEFAULT_MATERIAL = DEFAULT_MATERIAL;
    static EVENT_HEADER = EVENT_HEADER;

    constructor(gravityX = 0.0, gravityY = -9.8, options = {}) {
      const o = options || {};
      this.worldId = createWorld(
        gravityX,
        gravityY,
        o.lengthUnitsPerMeter ?? 1,
        o.contactHertz ?? 30,
        o.contactDampingRatio ?? 10,
        o.contactSpeed ?? 3,
        o.maximumLinearSpeed ?? 400,
        o.box2dWorkerCount ?? 4,
      );
      this._buffersBound = false;
    }

    enableSleeping(enable = true) {
      worldEnableSleeping(this.worldId, enable ? 1 : 0);
    }

    bindBuffers(maxBodies) {
      const maxSlots = getMaxBodySlots();
      if (maxBodies <= 0 || maxBodies > maxSlots) {
        throw new Error(
          `bindBuffers failed: maxBodies ${maxBodies} out of range (1..${maxSlots})`,
        );
      }
      this._buffersBound = bindGameBuffers(maxBodies) === 1;
      if (!this._buffersBound) {
        throw new Error(
          `bindBuffers failed: WASM malloc for ${maxBodies} bodies (rebuild box2d_wasm after source changes)`,
        );
      }
      bindQueryViews(this);
      return this;
    }

    getMaxBodySlots() {
      return getMaxBodySlots();
    }

    createBox(options = {}) {
      const o = { ...DEFAULT_MATERIAL, ...options };
      const slot = createBodyBox(
        this.worldId,
        o.type ?? BODY_TYPE.DYNAMIC,
        o.x ?? 0,
        o.y ?? 0,
        o.angle ?? 0,
        o.hx ?? 0.5,
        o.hy ?? 0.5,
        o.offsetX ?? 0,
        o.offsetY ?? 0,
        o.density,
        o.friction,
        o.restitution,
        o.linearDamping,
        o.angularDamping,
        o.gravityScale,
        o.vx,
        o.vy,
        o.angularVelocity,
        o.isSensor ? 1 : 0,
        o.enableHitEvents ? 1 : 0,
        o.categoryBits,
        o.maskBits,
        o.groupIndex ?? 0,
        o.fixedRotation ? 1 : 0,
        o.entity ?? o.entityIndex ?? -1,
      );
      if (slot < 0) {
        throw new Error("createBox failed");
      }
      return new BodyHandle(this, slot);
    }

    createCircle(options = {}) {
      const o = { ...DEFAULT_MATERIAL, ...options };
      const slot = createBodyCircle(
        this.worldId,
        o.type ?? BODY_TYPE.DYNAMIC,
        o.x ?? 0,
        o.y ?? 0,
        o.angle ?? 0,
        o.radius ?? 0.5,
        o.offsetX ?? 0,
        o.offsetY ?? 0,
        o.density,
        o.friction,
        o.restitution,
        o.linearDamping,
        o.angularDamping,
        o.gravityScale,
        o.vx,
        o.vy,
        o.angularVelocity,
        o.isSensor ? 1 : 0,
        o.enableHitEvents ? 1 : 0,
        o.categoryBits,
        o.maskBits,
        o.groupIndex ?? 0,
        o.fixedRotation ? 1 : 0,
        o.entity ?? o.entityIndex ?? -1,
      );
      if (slot < 0) {
        throw new Error("createCircle failed");
      }
      return new BodyHandle(this, slot);
    }

    createPolygon(options = {}) {
      const o = { ...DEFAULT_MATERIAL, ...options };
      const verts = o.verts ?? o.vertices;
      if (!Array.isArray(verts) || verts.length < 6 || verts.length % 2 !== 0) {
        throw new Error("createPolygon requires verts as [x0,y0,x1,y1,...] length >= 6");
      }
      const vertCount = verts.length / 2;
      const bytes = vertCount * 2 * 4;
      const ptr = Module._malloc(bytes);
      Module.HEAPF32.set(verts, ptr >> 2);
      const slot = createBodyPolygon(
        this.worldId,
        o.type ?? BODY_TYPE.DYNAMIC,
        o.x ?? 0,
        o.y ?? 0,
        o.angle ?? 0,
        ptr,
        vertCount,
        o.offsetX ?? 0,
        o.offsetY ?? 0,
        o.density,
        o.friction,
        o.restitution,
        o.linearDamping,
        o.angularDamping,
        o.gravityScale,
        o.vx,
        o.vy,
        o.angularVelocity,
        o.isSensor ? 1 : 0,
        o.enableHitEvents ? 1 : 0,
        o.categoryBits,
        o.maskBits,
        o.groupIndex ?? 0,
        o.fixedRotation ? 1 : 0,
        o.entity ?? o.entityIndex ?? -1,
      );
      Module._free(ptr);
      if (slot < 0) {
        throw new Error("createPolygon failed");
      }
      return new BodyHandle(this, slot);
    }

    destroyBody(slot) {
      destroyBody(slot);
    }

    overlapAABB(x0, y0, x1, y1, out, filter = {}) {
      assertHeapInt32View(out);
      const f = filterArgs(filter);
      return overlapAabbIntoFn(
        this.worldId,
        x0,
        y0,
        x1,
        y1,
        f.categoryBits,
        f.maskBits,
        out.byteOffset,
        out.length,
      );
    }

    createOverlapBuffer(capacity = getQueryCapacity()) {
      const ptr = Module._malloc(capacity * 4);
      return {
        view: Module.HEAP32.subarray(ptr >> 2, (ptr >> 2) + capacity),
        free: () => Module._free(ptr),
      };
    }

    overlapCircle(cx, cy, radius, filter = {}) {
      const f = filterArgs(filter);
      return overlapCircleFn(
        this.worldId,
        cx,
        cy,
        radius,
        f.categoryBits,
        f.maskBits,
      );
    }

    overlapBox(cx, cy, hx, hy, angle, filter = {}) {
      const f = filterArgs(filter);
      return overlapBoxFn(
        this.worldId,
        cx,
        cy,
        hx,
        hy,
        angle,
        f.categoryBits,
        f.maskBits,
      );
    }

    castRayClosest(ox, oy, dx, dy, filter = {}) {
      const f = filterArgs(filter);
      return castRayClosestFn(
        this.worldId,
        ox,
        oy,
        dx,
        dy,
        f.categoryBits,
        f.maskBits,
      );
    }

    castRayAll(ox, oy, dx, dy, filter = {}) {
      const f = filterArgs(filter);
      return castRayAllFn(
        this.worldId,
        ox,
        oy,
        dx,
        dy,
        f.categoryBits,
        f.maskBits,
      );
    }

    castMover(cx, cy, halfHeight, radius, dx, dy, filter = {}) {
      const f = filterArgs(filter);
      return castMoverFn(
        this.worldId,
        cx,
        cy,
        halfHeight,
        radius,
        dx,
        dy,
        f.categoryBits,
        f.maskBits,
      );
    }

    collideMover(cx, cy, halfHeight, radius, filter = {}) {
      const f = filterArgs(filter);
      return collideMoverFn(
        this.worldId,
        cx,
        cy,
        halfHeight,
        radius,
        f.categoryBits,
        f.maskBits,
      );
    }

    createRevoluteJoint(options = {}) {
      const slotA = options.bodyA?.slot;
      const slotB = options.bodyB?.slot;
      if (slotA === undefined || slotB === undefined) {
        throw new Error("createRevoluteJoint requires bodyA and bodyB");
      }

      const handle = createRevoluteJoint(
        this.worldId,
        slotA,
        slotB,
        options.anchorX ?? 0,
        options.anchorY ?? 0,
        options.enableLimit ? 1 : 0,
        options.lowerAngle ?? 0,
        options.upperAngle ?? 0,
        options.enableMotor ? 1 : 0,
        options.motorSpeed ?? 0,
        options.maxMotorTorque ?? 0,
      );
      if (handle < 0) {
        throw new Error("createRevoluteJoint failed");
      }
      return new JointHandle(this, handle);
    }

    createDistanceJoint(options = {}) {
      const slotA = options.bodyA?.slot;
      const slotB = options.bodyB?.slot;
      if (slotA === undefined || slotB === undefined) {
        throw new Error("createDistanceJoint requires bodyA and bodyB");
      }

      const handle = createDistanceJoint(
        this.worldId,
        slotA,
        slotB,
        options.anchorX ?? 0,
        options.anchorY ?? 0,
        options.length ?? 1,
        options.enableSpring ? 1 : 0,
        options.hertz ?? 1,
        options.dampingRatio ?? 0.7,
      );
      if (handle < 0) {
        throw new Error("createDistanceJoint failed");
      }
      return new JointHandle(this, handle);
    }

    createPrismaticJoint(options = {}) {
      const slotA = options.bodyA?.slot;
      const slotB = options.bodyB?.slot;
      if (slotA === undefined || slotB === undefined) {
        throw new Error("createPrismaticJoint requires bodyA and bodyB");
      }

      const handle = createPrismaticJoint(
        this.worldId,
        slotA,
        slotB,
        options.anchorX ?? 0,
        options.anchorY ?? 0,
        options.axisAngle ?? 0,
        options.enableLimit ? 1 : 0,
        options.lowerTranslation ?? 0,
        options.upperTranslation ?? 0,
        options.enableMotor ? 1 : 0,
        options.motorSpeed ?? 0,
        options.maxMotorForce ?? 0,
      );
      if (handle < 0) {
        throw new Error("createPrismaticJoint failed");
      }
      return new JointHandle(this, handle);
    }

    createWeldJoint(options = {}) {
      const slotA = options.bodyA?.slot;
      const slotB = options.bodyB?.slot;
      if (slotA === undefined || slotB === undefined) {
        throw new Error("createWeldJoint requires bodyA and bodyB");
      }

      const handle = createWeldJoint(
        this.worldId,
        slotA,
        slotB,
        options.anchorX ?? 0,
        options.anchorY ?? 0,
        options.linearHertz ?? 0,
        options.angularHertz ?? 0,
        options.linearDampingRatio ?? 1,
        options.angularDampingRatio ?? 1,
      );
      if (handle < 0) {
        throw new Error("createWeldJoint failed");
      }
      return new JointHandle(this, handle);
    }

    createDistanceJointLocal(options = {}) {
      const slotA = options.bodyA?.slot;
      const slotB = options.bodyB?.slot;
      if (slotA === undefined || slotB === undefined) {
        throw new Error("createDistanceJointLocal requires bodyA and bodyB");
      }

      let length = options.length ?? 1;
      if (!(length > 0) || length !== length) length = 1;
      const handle = createDistanceJointLocal(
        this.worldId,
        slotA,
        slotB,
        options.localAnchorAX ?? 0,
        options.localAnchorAY ?? 0,
        options.localAnchorBX ?? 0,
        options.localAnchorBY ?? 0,
        length,
        options.enableSpring ? 1 : 0,
        options.hertz ?? 1,
        options.dampingRatio ?? 0.7,
      );
      if (handle < 0) {
        throw new Error(
          handle === -2
            ? "createDistanceJointLocal failed (WASM joint table full)"
            : "createDistanceJointLocal failed (null body or Box2D reject)",
        );
      }
      return new JointHandle(this, handle);
    }

    createRevoluteJointLocal(options = {}) {
      const slotA = options.bodyA?.slot;
      const slotB = options.bodyB?.slot;
      if (slotA === undefined || slotB === undefined) {
        throw new Error("createRevoluteJointLocal requires bodyA and bodyB");
      }

      const handle = createRevoluteJointLocal(
        this.worldId,
        slotA,
        slotB,
        options.localAnchorAX ?? 0,
        options.localAnchorAY ?? 0,
        options.localAnchorBX ?? 0,
        options.localAnchorBY ?? 0,
        options.enableLimit ? 1 : 0,
        options.lowerAngle ?? 0,
        options.upperAngle ?? 0,
        options.enableMotor ? 1 : 0,
        options.motorSpeed ?? 0,
        options.maxMotorTorque ?? 0,
      );
      if (handle < 0) {
        throw new Error("createRevoluteJointLocal failed");
      }
      return new JointHandle(this, handle);
    }

    createWeldJointLocal(options = {}) {
      const slotA = options.bodyA?.slot;
      const slotB = options.bodyB?.slot;
      if (slotA === undefined || slotB === undefined) {
        throw new Error("createWeldJointLocal requires bodyA and bodyB");
      }

      const handle = createWeldJointLocal(
        this.worldId,
        slotA,
        slotB,
        options.localAnchorAX ?? 0,
        options.localAnchorAY ?? 0,
        options.localAnchorBX ?? 0,
        options.localAnchorBY ?? 0,
        options.linearHertz ?? 0,
        options.angularHertz ?? 0,
        options.linearDampingRatio ?? 1,
        options.angularDampingRatio ?? 1,
      );
      if (handle < 0) {
        throw new Error("createWeldJointLocal failed");
      }
      return new JointHandle(this, handle);
    }

    destroyJoint(handle) {
      destroyJoint(handle);
    }

    getJointCount() {
      return getJointCount();
    }

    getSlotCount() {
      return getSlotCount();
    }

    setHitEventThreshold(value) {
      worldSetHitEventThreshold(this.worldId, value);
    }

    explode(x, y, radius, falloff, impulsePerLength, maskBits = DEFAULT_FILTER_MASK) {
      worldExplode(
        this.worldId,
        x,
        y,
        radius,
        falloff,
        impulsePerLength,
        maskBits >>> 0,
        0,
      );
    }

    configureJoint(handle, userDataInt, forceThreshold, torqueThreshold) {
      jointConfigure(handle, userDataInt, forceThreshold, torqueThreshold);
    }

    step(dt, subSteps = 2) {
      stepWorld(this.worldId, dt, subSteps);
    }

    getSharedBuffer() {
      return Module.HEAPF32.buffer;
    }

    getReadyPayload() {
      const stateByteOffset = getStateByteOffset();
      const metaByteOffset = getMetaByteOffset();
      const stateBaseIndex = stateByteOffset >> 2;
      const channelCount = typeof STATE_CHANNEL_COUNT === "number" ? STATE_CHANNEL_COUNT : 8;
      const channelOffsets = [];
      for (let channel = 0; channel < channelCount; channel++) {
        channelOffsets.push(
          stateBaseIndex + getStateChannelOffset(channel),
        );
      }

      return {
        sab: Module.HEAPF32.buffer,
        bodyCount: getSlotCount(),
        bodyCapacity: getBodyCapacity(),
        channelOffsets,
        sleepingByteOffset: getSleepingByteOffset(),
        metaBaseIndex: metaByteOffset >> 2,
        metaStride: getMetaFloatStride(),
        stateByteOffset,
        stateRegionBytes: getStateRegionBytes(),
        metaRegionBytes: getMetaRegionBytes(),
        jointCount: getJointCount(),
        jointBaseIndex: getJointByteOffset() >> 2,
        jointStride: getJointFloatStride(),
        jointCapacity: getJointCapacity(),
        jointRegionBytes: getJointRegionBytes(),
        querySlotsBaseIndex: getQuerySlotsByteOffset() >> 2,
        queryHitsBaseIndex: getQueryHitsByteOffset() >> 2,
        eventHeaderBaseIndex: getEventHeaderByteOffset() >> 2,
        contactBeginBaseIndex: getContactBeginByteOffset() >> 2,
        contactEndBaseIndex: getContactEndByteOffset() >> 2,
        contactHitBaseIndex: getContactHitByteOffset() >> 2,
        sensorBeginBaseIndex: getSensorBeginByteOffset() >> 2,
        sensorEndBaseIndex: getSensorEndByteOffset() >> 2,
        moverPlanesBaseIndex: getMoverPlanesByteOffset() >> 2,
        queryCapacity: getQueryCapacity(),
        rayHitCapacity: getRayHitCapacity(),
        queryHitStride: getQueryHitFloatStride(),
        contactEventCapacity: getContactEventCapacity(),
        sensorEventCapacity: getSensorEventCapacity(),
        contactHitCapacity: getContactHitCapacity(),
        moverPlaneCapacity: getMoverPlaneCapacity(),
        moverPlaneStride: getMoverPlaneFloatStride(),
        eventHeaderIntCount: getEventHeaderIntCount(),
        contactPairIntStride: getContactPairIntStride(),
        bodyMoveBaseIndex: getBodyMoveByteOffset() >> 2,
        bodyFellAsleepByteOffset: getBodyFellAsleepByteOffset(),
        bodyMoveCapacity: getBodyMoveCapacity(),
        jointEventsBaseIndex: getJointEventsByteOffset() >> 2,
        jointEventCapacity: getJointEventCapacity(),
      };
    }

    createParticleSystem(radius = 10, maxCount = 10000, density = 1.0, subSteps = 1, strictContactCheck = false) {
      this._particleSystem = createParticleSystem(this.worldId, radius, density, maxCount, strictContactCheck ? 1 : 0);
      if (subSteps > 0) setParticleSubSteps(subSteps);
      return this._particleSystem;
    }

    destroyParticleSystem() {
      destroyParticleSystem();
      this._particleSystem = null;
    }

    createParticleBox(posX, posY, halfWidth, halfHeight, spacing = 0, flags = 0) {
      if (!this._particleSystem) this.createParticleSystem();
      return createParticleBox(
        posX - halfWidth,
        posY - halfHeight,
        posX + halfWidth,
        posY + halfHeight,
        spacing,
        flags >>> 0,
      );
    }

    createParticleGroupBox(posX, posY, halfWidth, halfHeight, spacing = 0, flags = 0, strength = 0.5) {
      if (!this._particleSystem) this.createParticleSystem();
      return createParticleGroupBox(
        posX - halfWidth,
        posY - halfHeight,
        posX + halfWidth,
        posY + halfHeight,
        spacing,
        flags >>> 0,
        strength,
      );
    }

    createParticleGroupCircle(posX, posY, radius, spacing = 0, flags = 0, strength = 0.5) {
      if (!this._particleSystem) this.createParticleSystem();
      return createParticleGroupCircle(posX, posY, radius, spacing, flags >>> 0, strength);
    }

    destroyParticleGroup(groupId) {
      destroyParticleGroup(groupId);
    }

    setParticleSubSteps(steps) {
      setParticleSubSteps(steps);
    }

    getParticleCount() {
      return getParticleCount();
    }

    getParticleCapacity() {
      return getParticleCapacity();
    }

    getParticleRadius() {
      return getParticleRadius();
    }

    getParticlePosByteOffset() {
      return getParticlePosByteOffset();
    }

    getParticleVelByteOffset() {
      return getParticleVelByteOffset();
    }

    getParticleFlagsByteOffset() {
      return getParticleFlagsByteOffset();
    }
  }

  return { PhysicsWorld, BodyHandle, JointHandle };
}
