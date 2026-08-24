// liquidFunDemoScene.js - LiquidFun Particle Physics Demo Scene in WeedJS
// WASD pans. Q/E/R/F/G/T pick a liquid; LMB sprays at the cursor.

import { Floor } from '/demos/ballsScene/gameObjects/floor.js';
import { Camera } from '/src/core/Camera.js';
import { BLEND_MODES } from '/src/core/ConfigDefaults.js';
import WEED from '/src/index.js';

const { Mouse, Keyboard, ParticleEmitter, LIQUIDFUN_FLAGS, Layer } = WEED;

const F = LIQUIDFUN_FLAGS;

// Keys avoid WASD. Jelly is elastic (a group per burst) so it sprays slower.
const LIQUID_TOOLS = [
  { key: 'q', name: 'water', shape: 'circle', radius: 100, flags: F.WATER | F.TENSILE, viscousScale: 1, tint: 0x3399ff },
  { key: 'e', name: 'oil', shape: 'circle', radius: 130, flags: F.VISCOUS, viscousScale: 1, tint: 0x6b3a1f },
  { key: 'r', name: 'cream', shape: 'circle', radius: 130, flags: F.VISCOUS | F.TENSILE, viscousScale: 2, tint: 0xf5f0e1 },
  { key: 'f', name: 'dulceDeLeche', shape: 'circle', radius: 110, flags: F.VISCOUS | F.TENSILE, viscousScale: 10, tint: 0xc6862a },
  { key: 'g', name: 'jelly', shape: 'circle', radius: 70, flags: F.ELASTIC, strength: 0.55, viscousScale: 1, tint: 0x33ff66, grouped: true },
  { key: 't', name: 'sand', shape: 'box', halfWidth: 80, halfHeight: 80, flags: F.POWDER, viscousScale: 1, tint: 0xffcc00 },
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
      // fixedFps: 20,
      subStepCount: 1,
      noLimitFPS: false,
      gravity: { x: 0, y: 980 },
      sleeping: false,
      liquidFun: {
        enabled: true,
        radius: 16,
        maxCount: 65534,
        subSteps: 1,
        viscousStrength: 0.25,
      },
    },

    renderer: {
      noLimitFPS: false,
      maxVisibleRenderables: 120000,
    },

    preRender: {
      interpolation: {
        mode: 'interpolate', // 'off' | 'interpolate'
      },
    },

    lighting: {
      enabled: false,
    },

    // Additive density RT + threshold shader (tips4devs cartoon water).
    layers: {
      water: {
        zIndex: 4,
        blendMode: BLEND_MODES.NORMAL,
        resolution: 0.5,
        maxItems: 65534,
        ySorting: false,
        shader: {
          fragment: 'liquid',
          containerBlend: BLEND_MODES.ADD,
          uniforms: {
            uCutoff: { value: 0.3, type: 'f32' },
            uFoam: { value: 0.42, type: 'f32' },
            uDepth: { value: 0.35, type: 'f32' },
            uBodyAlpha: { value: 0.1, type: 'f32' },
            uEdgeAlpha: { value: 0.45, type: 'f32' },
          },
        },
      },
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
    shaders: {
      liquid: '/demos/shaders/liquid.frag',
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
    this._meltGroupId = -1;
    this._meltScale = 8;
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
    const sprite = { texture: '_lightGradient', layerId: Layer.getId('water'), scale: 5, alpha: 0.25 };
    // Side-by-side oil (thin, viscousScale 1) vs dulce (thick, viscousScale 10).
    // Dulce auto-keeps a bookkeeping group for melt (M key).
    ParticleEmitter.emitLiquidFunParticles({
      flags: F.VISCOUS,
      viscousScale: 1,
      tint: 0x6b3a1f,
      shape: 'circle',
      posX: 1600,
      posY: 500,
      radius: 120,
      ...sprite,
    });
    ParticleEmitter.emitLiquidFunParticles({
      flags: F.VISCOUS | F.TENSILE,
      viscousScale: 10,
      tint: 0xc6862a,
      shape: 'circle',
      posX: 2400,
      posY: 500,
      radius: 400,
      trackGroup: true,
      ...sprite,
    });
  }

  update(dtRatio, deltaTime) {
    for (let i = 0; i < LIQUID_TOOLS.length; i++) {
      if (Keyboard.isPressed(LIQUID_TOOLS[i].key)) {
        this.liquidTool = i;
        this._refreshHud();
      }
    }

    // M = melt tracked dulce groups (lower viscousScale toward 1).
    if (Keyboard.isPressed('m')) {
      const groups = ParticleEmitter.getLiquidFunParticleGroups();
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        if (g.viscousScale > 1.05) {
          const next = Math.max(1, g.viscousScale - deltaTime * 3);
          ParticleEmitter.setLiquidFunGroupViscousScale(g.id, next);
          this._meltGroupId = g.id;
          this._meltScale = next;
        }
      }
      this._refreshHud();
    }

    if (Keyboard.isPressed('n')) {
      const groups = ParticleEmitter.getLiquidFunParticleGroups();
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        // if (g.viscousScale > 1.05) {
        const next = g.viscousScale * 1.1
        ParticleEmitter.setLiquidFunGroupViscousScale(g.id, next);
        this._meltGroupId = g.id;
        this._meltScale = next;
        // }
      }
      this._refreshHud();
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
      flags: tool.flags,
      viscousScale: tool.viscousScale,
      strength: tool.strength,
      tint: tool.tint,
      shape: tool.shape,
      posX: Mouse.x,
      posY: Mouse.y,
      texture: '_lightGradient',
      layerId: Layer.getId('water'),
      scale: 5,
      alpha: 0.25,
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
      const vs = t.viscousScale != null ? t.viscousScale : 1;
      return `${mark} ${t.key.toUpperCase()}  ${t.name}  vScale=${vs}`;
    });
    const tint = LIQUID_TOOLS[this.liquidTool].tint;
    const groups = ParticleEmitter.getLiquidFunParticleGroups();
    this._hud.textContent =
      `LiquidFun  |  ${LIQUID_TOOLS[this.liquidTool].name}` +
      (tint != null ? `  #${tint.toString(16).padStart(6, '0')}` : '') +
      `\n${lines.join('\n')}` +
      `\ngroups=${groups.length}` +
      (this._meltGroupId >= 0 ? `  melt#${this._meltGroupId}=${this._meltScale.toFixed(2)}` : '') +
      `\nLMB spray  M melt dulce  WASD pan  wheel zoom`;
  }

  _removeHud() {
    if (this._hud && this._hud.parentNode) this._hud.parentNode.removeChild(this._hud);
    this._hud = null;
  }
}
