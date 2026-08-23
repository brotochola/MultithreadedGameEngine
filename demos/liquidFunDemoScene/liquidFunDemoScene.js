// liquidFunDemoScene.js - LiquidFun Particle Physics Demo Scene in WeedJS
// Demonstrates fluid, elastic, viscous, and powder particle systems colliding with static rigid bodies.

import { Floor } from '/demos/ballsScene/gameObjects/floor.js';
import { Camera } from '/src/core/Camera.js';
import WEED from '/src/index.js';

const { Mouse, LiquidFunSystem, LIQUIDFUN_FLAGS, ParticleEmitter } = WEED;

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
      maxParticles: 10000,
      decals: false,
    },

    physics: {
      subStepCount: 4,
      noLimitFPS: false,
      // boundaryElasticity: 0.2,
      // collisionResponseStrength: 0.5,
      gravity: { x: 0, y: 980 },
      sleeping: false,
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

    // Initialize LiquidFun particle system in Box2D physics thread
    LiquidFunSystem.createSystem({
      radius: 10,
      maxCount: 6000,
      subSteps: 5,
    });

    // Spawn static obstacles, funnels, and ground containers
    this.createEnvironment();

    // Spawn initial particle groups (Water, Elastic, Viscous, Powder) using default '_whiteCircle' texture
    this.spawnParticleGroups();

    // Center camera on the physics demo area
    Camera.setPosition(2000, 1200);
    Camera.setZoom(0.8);
  }

  createEnvironment() {
    // Floor
    this.spawnEntity(Floor, { x: 2000, y: 2200, width: 2400, height: 60, tint: 0x444455 });

    // Container Side Walls
    this.spawnEntity(Floor, { x: 800, y: 1500, width: 60, height: 1400, tint: 0x444455 });
    this.spawnEntity(Floor, { x: 3200, y: 1500, width: 60, height: 1400, tint: 0x444455 });

    // Funnel Ramps (Angled)
    this.spawnEntity(Floor, { x: 1400, y: 900, width: 800, height: 40, rotation: 0.4, tint: 0x667799 });
    this.spawnEntity(Floor, { x: 2600, y: 900, width: 800, height: 40, rotation: -0.4, tint: 0x667799 });

    // Obstacle Pegs
    this.spawnEntity(Floor, { x: 1800, y: 1300, width: 120, height: 40, rotation: -0.2, tint: 0x99aa88 });
    this.spawnEntity(Floor, { x: 2200, y: 1500, width: 120, height: 40, rotation: 0.2, tint: 0x99aa88 });
    this.spawnEntity(Floor, { x: 2000, y: 1750, width: 200, height: 40, rotation: 0, tint: 0xaa8899 });
  }

  spawnParticleGroups() {
    // 1. Water Fluid (Blue)
    ParticleEmitter.emitLiquidFunParticles({
      shape: 'circle',
      posX: 1600,
      posY: 400,
      radius: 90,
      flags: LIQUIDFUN_FLAGS.WATER,
      texture: '_whiteCircle',
      tint: 0x3399ff,
    });

    // 2. Elastic Jelly (Green)
    ParticleEmitter.emitLiquidFunParticles({
      shape: 'circle',
      posX: 2000,
      posY: 350,
      radius: 80,
      flags: LIQUIDFUN_FLAGS.ELASTIC,
      texture: '_whiteCircle',
      tint: 0x33ff66,
    });

    // 3. Viscous Slime (Purple)
    ParticleEmitter.emitLiquidFunParticles({
      shape: 'circle',
      posX: 2400,
      posY: 400,
      radius: 85,
      flags: LIQUIDFUN_FLAGS.VISCOUS,
      texture: '_whiteCircle',
      tint: 0xcc33ff,
    });

    // 4. Powder Sand Box (Gold)
    ParticleEmitter.emitLiquidFunParticles({
      shape: 'box',
      posX: 2000,
      posY: 100,
      halfWidth: 60,
      halfHeight: 60,
      flags: LIQUIDFUN_FLAGS.POWDER,
      texture: '_whiteCircle',
      tint: 0xffcc00,
    });
  }

  update(deltaTime) {
    super.update(deltaTime);

    // WASD / Arrow camera panning
    const panSpeed = 15 / Camera.zoom;
    const kb = this.keyboard;
    if (kb) {
      if (kb.w || kb.arrowup) Camera.setPosition(Camera.x, Camera.y - panSpeed);
      if (kb.s || kb.arrowdown) Camera.setPosition(Camera.x, Camera.y + panSpeed);
      if (kb.a || kb.arrowleft) Camera.setPosition(Camera.x - panSpeed, Camera.y);
      if (kb.d || kb.arrowright) Camera.setPosition(Camera.x + panSpeed, Camera.y);
    }

    // Mouse wheel zoom
    if (Mouse.wheel && Mouse.wheel !== 0) {
      Camera.setZoom(Math.max(0.2, Math.min(3.0, Camera.zoom * (1 - Mouse.wheel * 0.001))));
    }

    // Mouse click interactivity: stream fresh water particles at mouse position
    if (Mouse.isButton0Down) {
      this.spawnTimer += deltaTime;
      if (this.spawnTimer >= 0.05) {
        this.spawnTimer = 0;
        const mouseWorldX = Mouse.x;
        const mouseWorldY = Mouse.y;

        ParticleEmitter.emitLiquidFunParticles({
          shape: 'circle',
          posX: mouseWorldX,
          posY: mouseWorldY,
          radius: 30,
          flags: LIQUIDFUN_FLAGS.WATER,
          texture: '_whiteCircle',
          tint: 0x00e5ff,
        });
      }
    }
  }
}
