// liquidFunDemoScene.js - LiquidFun Particle Physics Demo Scene in WeedJS
// Capability showcase: one emit per material at create, click appends ungrouped water.

import { Floor } from '/demos/ballsScene/gameObjects/floor.js';
import { Camera } from '/src/core/Camera.js';
import WEED from '/src/index.js';

const { Mouse, ParticleEmitter } = WEED;

export class LiquidFunDemoScene extends WEED.Scene {
  // ========================================
  // STATIC SCENE CONFIGURATION
  // ========================================

  static config = {
    worldWidth: 4000,
    worldHeight: 3000,

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
      liquidFun: { enabled: true, radius: 8, maxCount: 65534, subSteps: 2 },
    },

    renderer: {
      noLimitFPS: false,
      maxVisibleRenderables: 20000,
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
  }

  create() {
    console.log('🌊 LiquidFunDemoScene: Initializing LiquidFun Physics...');

    this.createEnvironment();
    this.spawnParticleGroups();

    Camera.setPosition(2000, 1200);
    Camera.setZoom(0.3);
  }

  createEnvironment() {
    this.spawnEntity(Floor, { x: 2000, y: 2200, width: 2400, height: 60, tint: 0x444455 });

    this.spawnEntity(Floor, { x: 800, y: 1500, width: 60, height: 1400, tint: 0x444455 });
    this.spawnEntity(Floor, { x: 3200, y: 1500, width: 60, height: 1400, tint: 0x444455 });

    this.spawnEntity(Floor, { x: 1400, y: 900, width: 800, height: 40, rotation: 0.4, tint: 0x667799 });
    this.spawnEntity(Floor, { x: 2600, y: 900, width: 800, height: 40, rotation: -0.4, tint: 0x667799 });

    this.spawnEntity(Floor, { x: 1800, y: 1300, width: 120, height: 40, rotation: -0.2, tint: 0x99aa88 });
    this.spawnEntity(Floor, { x: 2200, y: 1500, width: 120, height: 40, rotation: 0.2, tint: 0x99aa88 });
    this.spawnEntity(Floor, { x: 2000, y: 1750, width: 200, height: 40, rotation: 0, tint: 0xaa8899 });
  }

  spawnParticleGroups() {
    ParticleEmitter.emitLiquidFunParticles({
      material: 'water',
      shape: 'circle',
      posX: 1300,
      posY: 400,
      radius: 90,
      texture: '_whiteCircle',
    });
    ParticleEmitter.emitLiquidFunParticles({
      material: 'oil',
      shape: 'circle',
      posX: 1600,
      posY: 400,
      radius: 90,
      texture: '_whiteCircle',
    });
    ParticleEmitter.emitLiquidFunParticles({
      material: 'cream',
      shape: 'circle',
      posX: 1900,
      posY: 400,
      radius: 170,
      texture: '_whiteCircle',
    });
    ParticleEmitter.emitLiquidFunParticles({
      material: 'dulceDeLeche',
      shape: 'circle',
      posX: 2200,
      posY: 400,
      radius: 70,
      texture: '_whiteCircle',
    });
    ParticleEmitter.emitLiquidFunParticles({
      material: 'jelly',
      shape: 'circle',
      posX: 2500,
      posY: 350,
      radius: 70,
      texture: '_whiteCircle',
    });
    ParticleEmitter.emitLiquidFunParticles({
      material: 'sand',
      shape: 'box',
      posX: 2000,
      posY: 100,
      halfWidth: 50,
      halfHeight: 50,
      texture: '_whiteCircle',
    });
  }

  update(deltaTime) {
    super.update(deltaTime);

    const panSpeed = 15 / Camera.zoom;
    const kb = this.keyboard;
    if (kb) {
      if (kb.w || kb.arrowup) Camera.setPosition(Camera.x, Camera.y - panSpeed);
      if (kb.s || kb.arrowdown) Camera.setPosition(Camera.x, Camera.y + panSpeed);
      if (kb.a || kb.arrowleft) Camera.setPosition(Camera.x - panSpeed, Camera.y);
      if (kb.d || kb.arrowright) Camera.setPosition(Camera.x + panSpeed, Camera.y);
    }

    if (Mouse.wheel && Mouse.wheel !== 0) {
      Camera.setZoom(Math.max(0.1, Math.min(3.0, Camera.zoom * (1 - Mouse.wheel * 0.001))));
    }

    // Click appends ungrouped water. Do not create a new group per burst.
    if (Mouse.isButton0Down) {
      this.spawnTimer += deltaTime;
      if (this.spawnTimer >= 0.05) {
        this.spawnTimer = 0;
        ParticleEmitter.emitLiquidFunParticles({
          material: 'water',
          shape: 'circle',
          posX: Mouse.x,
          posY: Mouse.y,
          radius: 130,
          texture: '_whiteCircle',
          tint: 0x00e5ff,
        });
      }
    }
  }
}
