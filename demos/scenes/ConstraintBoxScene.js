// ConstraintBoxScene - Car-style square boxes (parts + distance constraints)

import { BoxPart } from '/demos/gameObjects/boxPart.js';
import { ConstraintBox } from '/demos/gameObjects/constraintBox.js';
import {
    ConstraintBoxComponent,
    PART_KEYS,
} from '/demos/components/constraintBoxComponent.js';
import { Floor } from '/demos/gameObjects/floor.js';
import { Camera } from '/src/core/Camera.js';
import WEED from '/src/index.js';
const { Mouse, Transform, RigidBody } = WEED;

export class ConstraintBoxScene extends WEED.Scene {
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
            maxJoints: 4096,
            sleeping: false,
            gravity: { x: 0, y: 1800 },
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
        [BoxPart, 3000], // 500 boxes × 5 parts
        [ConstraintBox, 600],
        [Floor, 16],
    ];

    constructor(game) {
        super(game);
        this.numberOfBoxes = 500;
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

        this.forceToTossBodies = 0.1;
    }

    create() {
        this.spawnFloorAndWalls();

        for (let i = 0; i < this.numberOfBoxes; i++) {
            const size = 60 + this.rng() * 80;
            ConstraintBox.spawn({
                x: 400 + this.rng() * (this.config.worldWidth - 800),
                y: 200 + this.rng() * (this.config.worldHeight * 0.5),
                size,
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

    _forEachPart(boxIdx, fn) {
        for (let i = 0; i < PART_KEYS.length; i++) {
            const partIdx = ConstraintBoxComponent[PART_KEYS[i]][boxIdx];
            if (partIdx > 0 && Transform.active[partIdx]) fn(partIdx);
        }
    }

    _handleDrag() {
        if (Mouse.isButton0Down && this._dragIdx == null) {
            let bestDist = Infinity;
            let bestIdx = null;
            for (const idx of ConstraintBox.getAllActive()) {
                const half = ConstraintBoxComponent.size[idx] * 0.5;
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
            }
        }

        if (this._dragIdx == null) return;

        if (!Mouse.isButton0Down || !Transform.active[this._dragIdx]) {
            const tossVx = this._tossVx;
            const tossVy = this._tossVy;
            this._forEachPart(this._dragIdx, (partIdx) => {
                const part = this.getEntityView(partIdx, { cache: true });
                part.setVelocity(tossVx, tossVy);
                RigidBody.sleeping[partIdx] = 0;
            });
            this._dragIdx = null;
            return;
        }

        this._tossVx = (Mouse.x - this._prevMouseX) * this.forceToTossBodies * 60;
        this._tossVy = (Mouse.y - this._prevMouseY) * this.forceToTossBodies * 60;
        this._prevMouseX = Mouse.x;
        this._prevMouseY = Mouse.y;

        const targetX = Mouse.x + this._dragOffX;
        const targetY = Mouse.y + this._dragOffY;
        const dx = targetX - Transform.x[this._dragIdx];
        const dy = targetY - Transform.y[this._dragIdx];

        this._forEachPart(this._dragIdx, (partIdx) => {
            const part = this.getEntityView(partIdx, { cache: true });
            part.setPosition(Transform.x[partIdx] + dx, Transform.y[partIdx] + dy);
            part.setVelocity(0, 0);
            RigidBody.sleeping[partIdx] = 0;
        });

        Transform.x[this._dragIdx] = targetX;
        Transform.y[this._dragIdx] = targetY;
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
