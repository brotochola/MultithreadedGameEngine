// liquidFunDemoScene.js - LiquidFun Particle Physics Demo Scene in WeedJS
// WASD pans. Q/E/R/F/G/T pick a liquid; LMB sprays at the cursor.

import { Floor } from '/demos/ballsScene/gameObjects/floor.js';
import { Camera } from '/src/core/Camera.js';
import WEED from '/src/index.js';

const { Mouse, Keyboard, ParticleEmitter, LIQUIDFUN_MATERIALS } = WEED;

// Keys avoid WASD. Jelly is elastic (a group per burst) so it sprays slower.
const LIQUID_TOOLS = [
  { key: 'q', material: 'water', shape: 'circle', radius: 130 },
  { key: 'e', material: 'oil', shape: 'circle', radius: 130 },
  { key: 'r', material: 'cream', shape: 'circle', radius: 130 },
  { key: 'f', material: 'dulceDeLeche', shape: 'circle', radius: 110 },
  { key: 'g', material: 'jelly', shape: 'circle', radius: 70, grouped: true },
  { key: 't', material: 'sand', shape: 'box', halfWidth: 80, halfHeight: 80 },
];

export class LiquidFunDemoScene extends WEED.Scene {
  // ========================================
  // STATIC SCENE CONFIGURATION
  // ========================================

  static config = {
    worldWidth: 5000,
    worldHeight: 5000,

    spatial: {
      cellSize: 128,
      maxNeighbors: 900,
      noLimitFPS: false,
    },

    logic: {
      noLimitFPS: false,
    },

    particle: {
      noLimitFPS: false,
      maxParticles: 0,
      decals: false,
    },

    physics: {
      subStepCount: 1,
      noLimitFPS: false,
      gravity: { x: 0, y: 980 },
      sleeping: false,
      liquidFun: { enabled: true, radius: 8, maxCount: 65534, subSteps: 1 },
    },

    renderer: {
      noLimitFPS: false,
      maxVisibleRenderables: 120000,
    },

    lighting: {
      enabled: false,
    },
  };

  // ========================================
  // STATIC ASSETS CONFIGURATION
  // ========================================

  static assets = {
    textures: {
      box: '/demos/img/box_100_100.png',
      ball: '/demos/img/bola.png',
    },
  };

  // ========================================
  // STATIC ENTITY REGISTRATION
  // ========================================

  static entities = [
    [Floor, 50],
  ];

  // ========================================
  // INSTANCE LIFECYCLE HOOKS
  // ========================================

  constructor(game) {
    super(game);
    this.spawnTimer = 0;
    this.liquidTool = 0;
    this._mouse0WasDown = false;
    this._hud = null;
  }

  create() {
    this.createEnvironment();
    this.spawnParticleGroups();
    this._createHud();
    this._refreshHud();

    Camera.setFree(true, { panSpeed: 15, zoomSensitivity: 0.001, maxZoom: 3 });
    Camera.setFreeTarget(2000, 1200);
    Camera.centerOn(2000, 1200);
    Camera.zoom = 0.3;
    Camera.setZoom(0.3);
    // Allow zooming out past world-fit min (~0.48 for 4k×3k world).
    Camera.setWorldBounds(Infinity, Infinity);
  }

  async destroy() {
    this._removeHud();
    await super.destroy();
  }

  createEnvironment() {
    const floorX = 2000;
    const floorY = 2200;
    const floorW = 2400;
    const floorH = 260;
    const wallW = 260;
    const wallX0 = 800;
    const wallX1 = 3200;
    // Walls must sit in the floor, not punch through it. A wall that continues
    // below the floor is a vertical shaft: corner overlap + point CCD slides
    // particles down inside the wall under the tank.
    const floorTop = floorY - floorH / 2;
    const wallTop = 400;
    const wallBottom = floorY;
    const wallH = wallBottom - wallTop;
    const wallY = (wallTop + wallBottom) / 2;

    this.spawnEntity(Floor, { x: floorX, y: floorY, width: floorW, height: floorH, tint: 0x444455 });
    this.spawnEntity(Floor, { x: wallX0, y: wallY, width: wallW, height: wallH, tint: 0x444455 });
    this.spawnEntity(Floor, { x: wallX1, y: wallY, width: wallW, height: wallH, tint: 0x444455 });

    this.spawnEntity(Floor, { x: 1400, y: 900, width: 800, height: 240, rotation: 0.4, tint: 0x667799 });
    this.spawnEntity(Floor, { x: 2600, y: 900, width: 800, height: 240, rotation: -0.4, tint: 0x667799 });

    this.spawnEntity(Floor, { x: 1800, y: 1300, width: 120, height: 240, rotation: -0.2, tint: 0x99aa88 });
    this.spawnEntity(Floor, { x: 2200, y: 1500, width: 120, height: 240, rotation: 0.2, tint: 0x99aa88 });
    this.spawnEntity(Floor, { x: 2000, y: 1750, width: 200, height: 240, rotation: 0, tint: 0xaa8899 });
  }

  spawnParticleGroups() {
    // ParticleEmitter.emitLiquidFunParticles({
    //   material: 'water',
    //   shape: 'circle',
    //   posX: 1300,
    //   posY: 400,
    //   radius: 90,
    //   texture: '_whiteCircle',
    // });
    // ParticleEmitter.emitLiquidFunParticles({
    //   material: 'oil',
    //   shape: 'circle',
    //   posX: 1600,
    //   posY: 400,
    //   radius: 90,
    //   texture: '_whiteCircle',
    // });
    // ParticleEmitter.emitLiquidFunParticles({
    //   material: 'cream',
    //   shape: 'circle',
    //   posX: 1900,
    //   posY: 400,
    //   radius: 170,
    //   texture: '_whiteCircle',
    // });
    // ParticleEmitter.emitLiquidFunParticles({
    //   material: 'dulceDeLeche',
    //   shape: 'circle',
    //   posX: 2200,
    //   posY: 400,
    //   radius: 70,
    //   texture: '_whiteCircle',
    // });
    // ParticleEmitter.emitLiquidFunParticles({
    //   material: 'jelly',
    //   shape: 'circle',
    //   posX: 2500,
    //   posY: 350,
    //   radius: 70,
    //   texture: '_whiteCircle',
    // });
    // ParticleEmitter.emitLiquidFunParticles({
    //   material: 'sand',
    //   shape: 'box',
    //   posX: 2000,
    //   posY: 100,
    //   halfWidth: 50,
    //   halfHeight: 50,
    //   texture: '_whiteCircle',
    // });
  }

  update(dtRatio, deltaTime) {
    for (let i = 0; i < LIQUID_TOOLS.length; i++) {
      if (Keyboard.isPressed(LIQUID_TOOLS[i].key)) {
        this.liquidTool = i;
        this._refreshHud();
      }
    }

    const tool = LIQUID_TOOLS[this.liquidTool];
    const down = Mouse.isButton0Down;
    const justDown = down && !this._mouse0WasDown;
    this._mouse0WasDown = down;
    if (!down) {
      this.spawnTimer = 0;
      return;
    }

    const interval = tool.grouped ? 0.25 : 0.05;
    this.spawnTimer += deltaTime;
    if (!justDown && this.spawnTimer < interval) return;
    this.spawnTimer = 0;

    const emit = {
      material: tool.material,
      shape: tool.shape,
      posX: Mouse.x,
      posY: Mouse.y,
      texture: '_whiteCircle',
    };
    if (tool.shape === 'box') {
      emit.halfWidth = tool.halfWidth;
      emit.halfHeight = tool.halfHeight;
    } else {
      emit.radius = tool.radius;
    }
    ParticleEmitter.emitLiquidFunParticles(emit);
  }

  _createHud() {
    const el = document.createElement('div');
    el.id = 'liquidfun-demo-hud';
    el.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:900;color:#fff;font:13px/1.45 sans-serif;' +
      'background:rgba(0,0,0,0.65);padding:10px 12px;border-radius:6px;pointer-events:none;white-space:pre;';
    document.body.appendChild(el);
    this._hud = el;
  }

  _refreshHud() {
    if (!this._hud) return;
    const lines = LIQUID_TOOLS.map((t, i) => {
      const mark = i === this.liquidTool ? '>' : ' ';
      return `${mark} ${t.key.toUpperCase()}  ${t.material}`;
    });
    const tint = LIQUIDFUN_MATERIALS[LIQUID_TOOLS[this.liquidTool].material]?.tint;
    this._hud.textContent =
      `LiquidFun  |  ${LIQUID_TOOLS[this.liquidTool].material}` +
      (tint != null ? `  #${tint.toString(16).padStart(6, '0')}` : '') +
      `\n${lines.join('\n')}\nLMB spray  WASD pan  wheel zoom`;
  }

  _removeHud() {
    if (this._hud && this._hud.parentNode) this._hud.parentNode.removeChild(this._hud);
    this._hud = null;
  }
}
