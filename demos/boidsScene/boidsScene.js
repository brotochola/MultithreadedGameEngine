// BoidsScene.js - 10k flocking showcase
// Bare demo: squares + classic boids rules, no tilemap/lights

import { Boid } from '/demos/predatorScene/gameObjects/boid.js';
import WEED from '/src/index.js';

const { Scene, Camera, Mouse } = WEED;

export class BoidsScene extends Scene {
  static config = {
    worldWidth: 4000,
    worldHeight: 4000,
    seed: 123456,

    spatial: {
      cellSize: 20,
      maxNeighbors: 128,
      maxEntitiesPerCell: 20,
      numberOfSpatialWorkers: 2,
      noLimitFPS: false,
      neighborReuseSkin: 0.01,
      neighborReuseMaxFrames: 30,
      neighborTickInterval: 15,
    },

    logic: {
      noLimitFPS: false,
      numberOfLogicWorkers: 4,
      staggeredUpdates: true, // required for Boid.tickInterval
    },

    particle: {
      noLimitFPS: false,
      maxParticles: 0,
      decals: false,
    },

    physics: {
      subStepCount: 0,
      noLimitFPS: false,
      sleeping: false,
      gravity: { x: 0, y: 0 },
    },

    renderer: {
      noLimitFPS: false,
      maxVisibleRenderables: 11000,
      ySorting: false,
    },

    lighting: {
      enabled: false,
    },
  };

  static assets = {
    textures: {
      square: '/demos/img/10_10_square.png',
    },
  };

  static entities = [
    [Boid, 50000],
  ];

  constructor(game) {
    super(game);
    this.cameraPanSpeed = 10;
    this.cameraFollowX = 0;
    this.cameraFollowY = 0;
  }

  create() {
    this.cameraFollowX = this.config.worldWidth / 2;
    this.cameraFollowY = this.config.worldHeight / 2;
    Camera.centerOn(this.cameraFollowX, this.cameraFollowY);
  }

  createNewGame() {
    this.spawnBoids(10000);
  }

  update(dtRatio, deltaTime, accumulatedTime, frameNumber) {
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
  }

  spawnBoids(count) {
    for (let i = 0; i < count; i++) {
      this.spawnEntity(Boid, {
        x: this.rng() * this.config.worldWidth,
        y: this.rng() * this.config.worldHeight,
        vx: (this.rng() - 0.5) * 800,
        vy: (this.rng() - 0.5) * 800,
        sprite: 'square',
      });
    }
  }
}
