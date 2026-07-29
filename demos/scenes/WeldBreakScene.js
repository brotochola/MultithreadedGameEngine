// WeldBreakScene — welded box columns that snap under load; sparks on JointBreakListener

import { WeldBreakBox } from '/demos/gameObjects/weldBreakBox.js';
import { Floor } from '/demos/gameObjects/floor.js';
import { Camera } from '/src/core/Camera.js';
import { BLEND_MODES } from '/src/core/ConfigDefaults.js';
import WEED from '/src/index.js';

const { Mouse, Transform, RigidBody, Collider, Joint } = WEED;

/** Tuned so stacks hold under self-weight; heavy drop / mouse toss can snap welds. */
const WELD_FORCE_THRESHOLD = 50e8;
const WELD_TORQUE_THRESHOLD = 25e9;
const BOX_SIZE = 80;
/** Vertical boxes per leg (includes top corner). */
const LEG_HEIGHT = 10;
/** Horizontal boxes on top bar (includes both corners). */
const TOP_WIDTH = 12;
const HEAVY_SIZE = 160;
const HEAVY_MASS = 200000;

export class WeldBreakScene extends WEED.Scene {
  static config = {
    worldWidth: 3000,
    worldHeight: 2500,

    spatial: {
      cellSize: 100,
      maxNeighbors: 512,
      noLimitFPS: false,
    },

    logic: {
      noLimitFPS: false,
    },

    particle: {
      noLimitFPS: false,
      maxParticles: 4000,
      decals: false,
    },

    physics: {
      subStepCount: 5,
      noLimitFPS: false,
      maxJoints: 512,
      gravity: { x: 0, y: 1980 },
      sleeping: false,
    },

    renderer: {
      noLimitFPS: false,
    },

    lighting: {
      enabled: false,
    },

    // Sparks on top of ENTITIES (zIndex 3); below LIGHTING (4) if enabled later
    layers: {
      sparks: {
        zIndex: 3.5,
        blendMode: BLEND_MODES.NORMAL,
        maxItems: 2000,
        ySorting: false,
      },
    },
  };

  static assets = {
    textures: {
      box: '/demos/img/box_100_100.png',
    },
  };

  static entities = [
    [WeldBreakBox, 128],
    [Floor, 16],
  ];

  constructor(game) {
    super(game);
    this.cameraPanSpeed = 10;
    this.cameraFollowX = 0;
    this.cameraFollowY = 0;
    this._dragIdx = null;
    this._dragOffX = 0;
    this._dragOffY = 0;
    this._prevMouseX = 0;
    this._prevMouseY = 0;
    this._tossVx = 0;
    this._tossVy = 0;
    this._tossOmega = 0;
  }

  create() {
    this.spawnFloorAndWalls();
    this._spawnWeldedU();
    // this._spawnHeavyDroppers();

    this.cameraFollowX = this.config.worldWidth / 2;
    this.cameraFollowY = this.config.worldHeight * 0.55;
    Camera.centerOn(this.cameraFollowX, this.cameraFollowY);
  }

  update(_time, _delta) {
    const panSpeed = this.cameraPanSpeed / Camera.zoom;
    const kb = this.keyboard;

    if (kb.w || kb.arrowup) this.cameraFollowY -= panSpeed;
    if (kb.s || kb.arrowdown) this.cameraFollowY += panSpeed;
    if (kb.a || kb.arrowleft) this.cameraFollowX -= panSpeed;
    if (kb.d || kb.arrowright) this.cameraFollowX += panSpeed;

    this.cameraFollowX = Math.max(0, Math.min(this.cameraFollowX, this.config.worldWidth));
    this.cameraFollowY = Math.max(0, Math.min(this.cameraFollowY, this.config.worldHeight));

    Camera.follow(this.cameraFollowX, this.cameraFollowY, 0.15);
    Camera.setZoom(Camera.zoom * (1 - Mouse.wheel * 0.1));

    this._handleDrag();
  }

  _weld(a, b, ax, ay) {
    if (a < 0 || b < 0) return;
    Joint.addWeld({
      entityA: a,
      entityB: b,
      worldAnchorX: ax,
      worldAnchorY: ay,
      forceThreshold: WELD_FORCE_THRESHOLD,
      torqueThreshold: WELD_TORQUE_THRESHOLD,
    });
  }

  /** Upside-down U: left leg up, top bar across, right leg down. */
  _spawnWeldedU() {
    const floorY = this.config.worldHeight - 150;
    const baseY = floorY - BOX_SIZE / 2 - 8;
    const leftX = this.config.worldWidth / 2 - ((TOP_WIDTH - 1) * BOX_SIZE) / 2;
    const rightX = leftX + (TOP_WIDTH - 1) * BOX_SIZE;
    const topY = baseY - (LEG_HEIGHT - 1) * BOX_SIZE;
    const tint = 0xc8a06a;

    const spawnAt = (x, y) => {
      const box = WeldBreakBox.spawn({ x, y, size: BOX_SIZE, tint });
      return box ? box.index : -1;
    };

    // Left leg (floor → top, includes top-left corner)
    let prev = -1;
    let prevY = 0;
    for (let i = 0; i < LEG_HEIGHT; i++) {
      const y = baseY - i * BOX_SIZE;
      const idx = spawnAt(leftX, y);
      this._weld(prev, idx, leftX, (prevY + y) * 0.5);
      prev = idx;
      prevY = y;
    }

    // Top bar (skip corner already placed; left → right)
    let prevX = leftX;
    for (let i = 1; i < TOP_WIDTH; i++) {
      const x = leftX + i * BOX_SIZE;
      const idx = spawnAt(x, topY);
      this._weld(prev, idx, (prevX + x) * 0.5, topY);
      prev = idx;
      prevX = x;
    }

    // Right leg (skip top-right corner; top → floor)
    prevY = topY;
    for (let i = LEG_HEIGHT - 2; i >= 0; i--) {
      const y = baseY - i * BOX_SIZE;
      const idx = spawnAt(rightX, y);
      this._weld(prev, idx, rightX, (prevY + y) * 0.5);
      prev = idx;
      prevY = y;
    }
  }

  _spawnHeavyDroppers() {
    const leftX = this.config.worldWidth / 2 - ((TOP_WIDTH - 1) * BOX_SIZE) / 2;
    const rightX = leftX + (TOP_WIDTH - 1) * BOX_SIZE;
    const midX = (leftX + rightX) * 0.5;
    const dropY = this.config.worldHeight * 0.22;

    for (const x of [leftX, midX, rightX]) {
      WeldBreakBox.spawn({
        x,
        y: dropY,
        size: HEAVY_SIZE,
        mass: HEAVY_MASS,
        tint: 0x556677,
      });
    }
  }

  _handleDrag() {
    if (Mouse.isButton0Down && this._dragIdx == null) {
      let bestDist = Infinity;
      let bestIdx = null;
      for (const idx of WeldBreakBox.getAllActive()) {
        const half = Math.max(Collider.width[idx], Collider.height[idx]) * 0.5;
        const pickR2 = half * half;
        const dx = Transform.x[idx] - Mouse.x;
        const dy = Transform.y[idx] - Mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < pickR2 && d2 < bestDist) {
          bestDist = d2;
          bestIdx = idx;
        }
      }
      if (bestIdx != null) {
        this._dragIdx = bestIdx;
        this._dragOffX = Transform.x[bestIdx] - Mouse.x;
        this._dragOffY = Transform.y[bestIdx] - Mouse.y;
        this._prevMouseX = Mouse.x;
        this._prevMouseY = Mouse.y;
        this._tossVx = 0;
        this._tossVy = 0;
        this._tossOmega = 0;
      }
    }

    if (this._dragIdx == null) return;

    if (!Mouse.isButton0Down || !Transform.active[this._dragIdx]) {
      const box = this.getEntityView(this._dragIdx, { cache: true });
      box.setVelocity(this._tossVx, this._tossVy);
      box.angularVelocity = this._tossOmega;
      RigidBody.sleeping[this._dragIdx] = 0;
      this._dragIdx = null;
      return;
    }

    const mx = Mouse.x;
    const my = Mouse.y;
    this._tossVx = (mx - this._prevMouseX) * 60;
    this._tossVy = (my - this._prevMouseY) * 60;
    const rx = mx + this._dragOffX - Transform.x[this._dragIdx];
    const ry = my + this._dragOffY - Transform.y[this._dragIdx];
    this._tossOmega = ((rx * this._tossVy - ry * this._tossVx) * 0.00005) / 60;
    this._prevMouseX = mx;
    this._prevMouseY = my;

    const box = this.getEntityView(this._dragIdx, { cache: true });
    box.setPosition(mx + this._dragOffX, my + this._dragOffY);
    box.setVelocity(0, 0);
    box.angularVelocity = 0;
    RigidBody.sleeping[this._dragIdx] = 0;
  }

  spawnFloorAndWalls() {
    const wallThickness = 150;
    const worldWidth = this.config.worldWidth;
    const worldHeight = this.config.worldHeight;

    Floor.spawn({
      x: worldWidth / 2,
      y: worldHeight - wallThickness / 2,
      width: worldWidth,
      height: wallThickness,
    });
    Floor.spawn({
      x: wallThickness / 2,
      y: worldHeight / 2,
      width: wallThickness,
      height: worldHeight,
    });
    Floor.spawn({
      x: worldWidth - wallThickness / 2,
      y: worldHeight / 2,
      width: wallThickness,
      height: worldHeight,
    });
  }
}
