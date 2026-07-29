// AICar.js - AI-controlled car that follows a static flowfield (or the player as fallback)

import WEED from '/src/index.js';
import { Car } from './car.js';
import { PlayerCar } from './playerCar.js';
import { NavGrid } from '../../src/core/NavGrid.js';
import { CarComponent } from '../components/carComponent.js';
import { dot2 } from '/src/core/utils.js';

const { SpriteRenderer, RigidBody, Collider, CollisionListener } = WEED;

const _navVec = { x: 0, y: 0 };

export class AICar extends Car {
    static scriptUrl = import.meta.url;

    static components = [RigidBody, Collider, CollisionListener, SpriteRenderer, CarComponent];

    static aiTurnStrength = 0.8;
    static aiForwardStrength = 0.9;
    static aiForwardAlignmentThreshold = 0.15;
    static aiBrakeForwardSpeedThreshold = 60; // px/s
    static flowfieldName = 'roads';

    tick(dtRatio) {
        super.tick(dtRatio);

        NavGrid.requestVectorFromStaticFlowfield(this.constructor.flowfieldName, this.x, this.y, _navVec);

        if (_navVec.x === 0 && _navVec.y === 0) {
            const player = PlayerCar.getFirstActiveInstance();
            if (player) {
                _navVec.x = player.x - this.x;
                _navVec.y = player.y - this.y;
            }
        }

        const lenSq = _navVec.x * _navVec.x + _navVec.y * _navVec.y;
        if (lenSq < 0.01) return;

        const currentAngle = this.carComponent.angle;
        const desiredAngle = Math.atan2(_navVec.y, _navVec.x);

        let angleDiff = desiredAngle - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        const turnInput = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff) * 2, 1) * this.constructor.aiTurnStrength;

        const alignment = Math.cos(angleDiff);
        const forwardSpeed = dot2(
            this.carComponent.vx,
            this.carComponent.vy,
            Math.cos(currentAngle),
            Math.sin(currentAngle)
        );

        let desiredSpeed = 0;
        if (alignment > this.constructor.aiForwardAlignmentThreshold) {
            desiredSpeed = this.carComponent.maxForwardSpeed * this.constructor.aiForwardStrength;
        } else if (forwardSpeed > this.constructor.aiBrakeForwardSpeedThreshold) {
            desiredSpeed = 0; // coast / let friction kill speed while turning
        }

        this.applyForces(desiredSpeed, turnInput, dtRatio);
    }
}
