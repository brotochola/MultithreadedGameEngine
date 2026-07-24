// OrientedBoxScene - Validate OBB colliders + angular dynamics (spin, stack, toss)

import { OrientedBox } from '/demos/gameObjects/orientedBox.js';
import { Floor } from '/demos/gameObjects/floor.js';
import { Camera } from '/src/core/Camera.js';
import WEED from '/src/index.js';

const { Mouse, Transform, RigidBody, Collider } = WEED;

export class OrientedBoxScene extends WEED.Scene {
    static config = {
        worldWidth: 5000,
        worldHeight: 6000,

        spatial: {
            cellSize: 100,
            maxNeighbors: 512,
            noLimitFPS: true,
        },

        logic: {
            noLimitFPS: false,
        },

        particle: {
            noLimitFPS: true,
            maxParticles: 0,
            decals: false,
        },

        physics: {
            subStepCount: 5,
            noLimitFPS: true,
            maxCollisionPairs: 100000,
            verletDamping: 0.999,
            boundaryElasticity: 0.3,
            collisionResponseStrength: 0.5,
            sleepThreshold: 0.005,
            wakeUpThreshold: 0.2,
            sleepDuration: 4,
            gravity: { x: 0, y: 0.55 },
        },

        renderer: {
            noLimitFPS: false,
        },

        lighting: {
            enabled: false,
        },
    };

    static assets = {
        textures: {
            box: '/demos/img/box_100_100.png',
        },
    };

    static entities = [
        [OrientedBox, 10000],
        [Floor, 16],
    ];

    constructor(game) {
        super(game);
        this.numberOfBoxes = 1040;
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

        for (let i = 0; i < this.numberOfBoxes; i++) {
            const size = 50 + this.rng() * 70;
            OrientedBox.spawn({
                x: 500 + this.rng() * (this.config.worldWidth - 1000),
                y: 150 + this.rng() * (this.config.worldHeight * 0.45),
                width: size,
                height: size * (0.6 + this.rng() * 0.8),
                rotation: this.rng() * Math.PI * 2,
                angularVelocity: (this.rng() - 0.5) * 0.15,
            });
        }

        this.cameraFollowX = this.config.worldWidth / 2;
        this.cameraFollowY = this.config.worldHeight / 2;
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

    _handleDrag() {
        if (Mouse.isButton0Down && this._dragIdx == null) {
            let bestDist = Infinity;
            let bestIdx = null;
            for (const idx of OrientedBox.getAllActive()) {
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
            const i = this._dragIdx;
            RigidBody.px[i] = Transform.x[i] - this._tossVx;
            RigidBody.py[i] = Transform.y[i] - this._tossVy;
            RigidBody.vx[i] = this._tossVx;
            RigidBody.vy[i] = this._tossVy;
            RigidBody.angularVelocity[i] = this._tossOmega;
            RigidBody.sleeping[i] = 0;
            this._dragIdx = null;
            return;
        }

        const mx = Mouse.x;
        const my = Mouse.y;
        this._tossVx = mx - this._prevMouseX;
        this._tossVy = my - this._prevMouseY;
        // Rough spin from off-center grab
        const rx = (mx + this._dragOffX) - Transform.x[this._dragIdx];
        const ry = (my + this._dragOffY) - Transform.y[this._dragIdx];
        this._tossOmega = (rx * this._tossVy - ry * this._tossVx) * 0.00005;
        this._prevMouseX = mx;
        this._prevMouseY = my;

        const targetX = mx + this._dragOffX;
        const targetY = my + this._dragOffY;
        Transform.x[this._dragIdx] = targetX;
        Transform.y[this._dragIdx] = targetY;
        RigidBody.px[this._dragIdx] = targetX;
        RigidBody.py[this._dragIdx] = targetY;
        RigidBody.vx[this._dragIdx] = 0;
        RigidBody.vy[this._dragIdx] = 0;
        RigidBody.angularVelocity[this._dragIdx] = 0;
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
            x: worldWidth / 2,
            y: wallThickness / 2,
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
