// PlayerCar.js - Player-controlled car extending the base Car class
// WASD/Arrows → desired speed + turn input (Phaser drive-to-speed)

import WEED from '/src/index.js';
import { Car } from './car.js';
import { CarComponent } from '../components/carComponent.js';
import { dot2 } from '/src/core/utils.js';

const { Keyboard, SpriteRenderer, RigidBody, Collider, CollisionListener, Camera, Transform } = WEED;

const ZOOM_AT_MIN_SPEED = 1.0;
const ZOOM_AT_MAX_SPEED = 0.25;
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
            shadow.baseRotation = this.carComponent.angle;
        }
        this._updateCamera(dtRatio);
        this._handleInput(dtRatio);
    }

    _updateCamera(dtRatio) {
        const player = this.index;
        if (player === null) return;
        if (!Transform.active[player]) return;

        const centerX = Transform.x[player];
        const centerY = Transform.y[player];
        const vx = CarComponent.vx[player];
        const vy = CarComponent.vy[player];

        Camera.follow(
            centerX + vx * LOOK_AHEAD_SEC,
            centerY + vy * LOOK_AHEAD_SEC,
            CAMERA_FOLLOW_SMOOTH,
            dtRatio
        );

        const speed = Math.hypot(vx, vy);
        const speedT = Math.min(
            1,
            Math.max(0, (speed - SPEED_FOR_MIN_ZOOM) / (SPEED_FOR_MAX_ZOOM - SPEED_FOR_MIN_ZOOM))
        );
        Camera.setZoom(ZOOM_AT_MIN_SPEED + speedT * (ZOOM_AT_MAX_SPEED - ZOOM_AT_MIN_SPEED));
    }

    /**
     * W/S → desired forward/back speed; A/D → turn [-1, 1]
     */
    _handleInput(dtRatio) {
        const forward = Keyboard.w || Keyboard.arrowup;
        const reverse = Keyboard.s || Keyboard.arrowdown;

        let desiredSpeed = 0;
        if (forward && !reverse) {
            desiredSpeed = this.carComponent.maxForwardSpeed;
        } else if (reverse && !forward) {
            // Phaser: reverse desired speed also brakes while moving forward
            desiredSpeed = this.carComponent.maxBackwardSpeed;
        }

        let turnInput = 0;
        if (Keyboard.d || Keyboard.arrowright) turnInput += 1;
        if (Keyboard.a || Keyboard.arrowleft) turnInput -= 1;

        if (desiredSpeed !== 0 || turnInput !== 0) {
            this.applyForces(desiredSpeed, turnInput, dtRatio);
        }
    }

    _getForwardSpeed() {
        const angle = this.carComponent.angle;
        return dot2(
            RigidBody.vx[this.index],
            RigidBody.vy[this.index],
            Math.cos(angle),
            Math.sin(angle)
        );
    }
}
