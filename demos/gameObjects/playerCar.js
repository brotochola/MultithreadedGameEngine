// PlayerCar.js - Player-controlled car
// WASD/Arrows → forwardInput (-1|0|1) + turn [-1, 1]

import WEED from '/src/index.js';
import { Car } from './car.js';
import { CarComponent } from '../components/carComponent.js';
import { dot2 } from '/src/core/utils.js';

const { Keyboard, SpriteRenderer, RigidBody, Collider, CollisionListener, Camera, Transform } = WEED;

const ZOOM_AT_MIN_SPEED = 1.0;
const ZOOM_AT_MAX_SPEED = 0.5;
const SPEED_FOR_MIN_ZOOM = 0;
const SPEED_FOR_MAX_ZOOM = 1200; // px/s
const LOOK_AHEAD_SEC = 0.25;
const CAMERA_FOLLOW_SMOOTH = 0.05;

export class PlayerCar extends Car {
    static scriptUrl = import.meta.url;

    static components = [RigidBody, Collider, CollisionListener, SpriteRenderer, CarComponent];

    tick(dtRatio) {
        super.tick(dtRatio);
        const shadow = this.getAttachedDecoration(0);
        if (shadow) {
            const i = this.index;
            shadow.setBaseRotCS(
                Transform.rotC ? Transform.rotC[i] : 1,
                Transform.rotS ? Transform.rotS[i] : 0,
            );
        }
        this._updateCamera(dtRatio);
        this._handleInput();
    }

    _updateCamera(dtRatio) {
        const player = this.index;
        if (player === null) return;
        if (!Transform.active[player]) return;

        const centerX = Transform.x[player];
        const centerY = Transform.y[player];
        const vx = RigidBody.vx[player];
        const vy = RigidBody.vy[player];

        Camera.follow(
            centerX + vx * LOOK_AHEAD_SEC,
            centerY + vy * LOOK_AHEAD_SEC,
            CAMERA_FOLLOW_SMOOTH,
            dtRatio
        );

        const speed = RigidBody.speed[player];
        const speedT = Math.min(
            1,
            Math.max(0, (speed - SPEED_FOR_MIN_ZOOM) / (SPEED_FOR_MAX_ZOOM - SPEED_FOR_MIN_ZOOM))
        );
        Camera.setZoom(ZOOM_AT_MIN_SPEED + speedT * (ZOOM_AT_MAX_SPEED - ZOOM_AT_MIN_SPEED));
    }

    /** W/S → forwardInput; A/D → turn */
    _handleInput() {
        const forward = Keyboard.w || Keyboard.arrowup;
        const reverse = Keyboard.s || Keyboard.arrowdown;

        let forwardInput = 0;
        if (forward && !reverse) forwardInput = 1;
        else if (reverse && !forward) forwardInput = -1;

        let turnInput = 0;
        if (Keyboard.d || Keyboard.arrowright) turnInput += 1;
        if (Keyboard.a || Keyboard.arrowleft) turnInput -= 1;

        if (forwardInput !== 0 || turnInput !== 0) {
            this.applyForces(forwardInput, turnInput);
        }
    }

    _getForwardSpeed() {
        return dot2(RigidBody.vx[this.index], RigidBody.vy[this.index], this.forwardX, this.forwardY);
    }
}
