// Appended to box2d_wasm.js via --post-js. Worker entry must be box2d_wasm.js
// so Emscripten pthread pool spawns box2d_wasm.js (not physics.worker.js).
// Pthread pool workers (name "em-pthread") must NOT run this app glue.

(function () {
  if (self.name === "em-pthread") {
    console.log("[physics] pthread worker — skip app glue");
    return;
  }

  console.log("[physics] post-js start, worker url:", self.location.href);

importScripts("game-constants.js", "physics-api.js");
console.log("[physics] game-constants + physics-api loaded");

Module.monitorRunDependencies = function (left) {
  console.log("[physics] wasm runDependencies left:", left);
};
Module.onAbort = function (what) {
  console.error("[physics] wasm ABORT:", what);
};

self.onerror = function (e) {
  console.error(
    "[physics] worker onerror:",
    e.message,
    e.filename,
    e.lineno,
  );
};

const noLimitFPS = false;
const BODY_COUNT = 5000;
const SUBSTEPS = 2;
const MAX_DT = 1 / 20;
const ARENA_SLOT_COUNT = 3;

const UI_BOX_HX = 0.25;
const UI_BOX_HY = 0.25;
const UI_CIRCLE_R = 0.2;

const MATERIAL = {
  density: 1.0,
  friction: 0.3,
  restitution: 0.0,
  linearDamping: 0.0,
  angularDamping: 0.0,
  gravityScale: 1.0,
};

let world = null;
const pendingMessages = [];

function flushPendingMessages() {
  while (pendingMessages.length > 0) {
    handlePhysicsMessage(pendingMessages.shift());
  }
}

function spawnArena(w) {
  w.createBox({
    type: BODY_TYPE.STATIC,
    x: 0,
    y: -1,
    hx: 14,
    hy: 1,
    ...MATERIAL,
  });
  w.createBox({
    type: BODY_TYPE.STATIC,
    x: -13,
    y: 12,
    hx: 1,
    hy: 14,
    ...MATERIAL,
  });
  w.createBox({
    type: BODY_TYPE.STATIC,
    x: 13,
    y: 12,
    hx: 1,
    hy: 14,
    ...MATERIAL,
  });
}

function clearScene(w) {
  const jointCount = w.getJointCount();
  for (let h = 0; h < jointCount; h++) {
    w.destroyJoint(h);
  }
  const slotCount = w.getSlotCount();
  for (let slot = ARENA_SLOT_COUNT; slot < slotCount; slot++) {
    w.destroyBody(slot);
  }
}

function runQuerySelfCheck(w) {
  const probe = w.createBox({
    type: BODY_TYPE.DYNAMIC,
    x: 0,
    y: 10,
    hx: 0.5,
    hy: 0.5,
    ...MATERIAL,
  });
  const overlapCount = w.overlapAABB(-1, 9, 1, 11, w._querySlots);
  if (overlapCount <= 0) {
    throw new Error("query self-check: overlapAABB expected probe hit");
  }
  probe.destroy();

  const rayHit = w.castRayClosest(0, 30, 0, -40);
  if (rayHit !== 1) {
    throw new Error("query self-check: castRayClosest expected floor hit");
  }
  const hitFraction = w._queryHits[1];
  if (hitFraction <= 0 || hitFraction > 1) {
    throw new Error("query self-check: ray fraction out of range");
  }
}

function handlePhysicsMessage(data) {
  if (!data || !data.type) {
    return;
  }

  if (!world) {
    console.log("[physics] queue message (world not ready):", data.type);
    pendingMessages.push(data);
    return;
  }

  try {
    switch (data.type) {
      case "CREATE_BOX": {
        const handle = world.createBox({
          type: BODY_TYPE.DYNAMIC,
          x: data.x,
          y: data.y,
          hx: data.hx ?? UI_BOX_HX,
          hy: data.hy ?? UI_BOX_HY,
          ...MATERIAL,
        });
        postMessage({
          type: "BODY_CREATED",
          slot: handle.slot,
          shapeType: SHAPE_TYPE.BOX,
        });
        break;
      }
      case "CREATE_CIRCLE": {
        const handle = world.createCircle({
          type: BODY_TYPE.DYNAMIC,
          x: data.x,
          y: data.y,
          radius: data.radius ?? UI_CIRCLE_R,
          ...MATERIAL,
        });
        postMessage({
          type: "BODY_CREATED",
          slot: handle.slot,
          shapeType: SHAPE_TYPE.CIRCLE,
        });
        break;
      }
      case "CLEAR_SCENE": {
        clearScene(world);
        postMessage({
          type: "SCENE_CLEARED",
          bodyCount: world.getSlotCount(),
          jointCount: world.getJointCount(),
        });
        break;
      }
      case "CAST_RAY": {
        const { ox, oy, dx, dy, requestId } = data;
        const hit = world.castRayClosest(ox, oy, dx, dy) === 1;
        const result = {
          type: "RAY_RESULT",
          requestId,
          hit,
          ox,
          oy,
          dx,
          dy,
        };
        if (hit) {
          const hits = world._queryHits;
          result.fraction = hits[1];
          result.slot = hits[0];
          result.px = hits[2];
          result.py = hits[3];
          result.nx = hits[4];
          result.ny = hits[5];
        }
        postMessage(result);
        break;
      }
      default:
        postMessage({
          type: "ERROR",
          message: `Unknown message type: ${data.type}`,
        });
    }
  } catch (err) {
    console.error("[physics] handlePhysicsMessage error:", err);
    postMessage({
      type: "ERROR",
      message: err?.message ?? String(err),
    });
  }
}

self.onmessage = function (event) {
  handlePhysicsMessage(event.data);
};

Module.onRuntimeInitialized = function () {
  console.log("[physics] onRuntimeInitialized");
  try {
    const { PhysicsWorld } = createPhysicsApi(Module);
    console.log("[physics] bindBuffers", BODY_COUNT);
    world = new PhysicsWorld(0.0, -9.8, {
      lengthUnitsPerMeter: 1,
      contactHertz: 30,
      contactDampingRatio: 10,
      contactSpeed: 3,
      maximumLinearSpeed: 400,
      box2dWorkerCount: 4,
    });
    world.bindBuffers(BODY_COUNT);

    spawnArena(world);
    console.log("[physics] arena spawned");
    runQuerySelfCheck(world);
    console.log("[physics] self-check ok");

    const ready = world.getReadyPayload();

    postMessage({
      type: "READY",
      ...ready,
    });
    console.log("[physics] READY posted, bodyCount:", ready.bodyCount);

    flushPendingMessages();
  } catch (err) {
    console.error("[physics] init failed:", err);
    postMessage({
      type: "ERROR",
      message: err?.message ?? String(err),
    });
    return;
  }

  let physicsFrames = 0;
  let physicsFpsLast = performance.now();
  let lastStepTime = performance.now();

  function reportPhysicsFps() {
    physicsFrames++;
    const now = performance.now();
    const elapsed = now - physicsFpsLast;
    if (elapsed >= 500) {
      postMessage({
        type: "FPS",
        worker: "physics",
        fps: Math.round((physicsFrames * 1000) / elapsed),
      });
      physicsFrames = 0;
      physicsFpsLast = now;
    }
  }

  function loop() {
    const now = performance.now();
    let dt = (now - lastStepTime) / 1000;
    lastStepTime = now;
    if (dt > MAX_DT) {
      dt = MAX_DT;
    }

    world.step(dt, SUBSTEPS);
    reportPhysicsFps();
    if (noLimitFPS) {
      setTimeout(loop, 2);
    } else {
      requestAnimationFrame(loop);
    }
  }
  requestAnimationFrame(loop);
};

console.log("[physics] post-js end, onRuntimeInitialized registered");
})();
