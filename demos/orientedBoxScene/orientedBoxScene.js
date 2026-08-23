// OrientedBoxScene - Validate OBB colliders + angular dynamics (spin, stack, toss)

import { OrientedBox } from './gameObjects/orientedBox.js';
import { Floor } from '/demos/ballsScene/gameObjects/floor.js';
import { Ball } from '/demos/ballsScene/gameObjects/ball.js';
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
            subStepCount: 5,
            noLimitFPS: false,
            gravity: { x: 0, y: 1980 },
            sleeping: false,
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
            ball: '/demos/img/bola.png',
        },
    };

    static entities = [
        [OrientedBox, 10000],
        [Ball, 1000],
        [Floor, 16],
    ];

    constructor(game) {
        super(game);
        this.numberOfBoxes = 1040;
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
            const width = 10 + this.rng() * 10
            const height = 100 + this.rng() * 100
            OrientedBox.spawn({
                x: 500 + this.rng() * (this.config.worldWidth - 1000),
                y: 150 + this.rng() * (this.config.worldHeight * 0.45),
                width: width,
                height: height,
                rotation: this.rng() * Math.PI * 2,
                angularVelocity: (this.rng() - 0.5) * 0.15,
            });
        }

        const cx = this.config.worldWidth / 2;
        const cy = this.config.worldHeight / 2;
        Camera.setFree(true, { panSpeed: 10 });
        Camera.setFreeTarget(cx, cy);
        Camera.centerOn(cx, cy);
    }

    update(_time, _delta) {
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
        // Rough spin from off-center grab
        const rx = (mx + this._dragOffX) - Transform.x[this._dragIdx];
        const ry = (my + this._dragOffY) - Transform.y[this._dragIdx];
        this._tossOmega = (rx * this._tossVy - ry * this._tossVx) * 0.00005 / 60;
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
