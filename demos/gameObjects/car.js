// Car.js - Single ShapeType.Box chassis with Phaser-style top-down forces
// Lateral cancel via dot projection (capped skid), drive-to-speed, torque steer.

import WEED from '/src/index.js';
import { CarComponent, CAR_DEFAULTS } from '../components/carComponent.js';
import { dot2 } from '/src/core/utils.js';

const {
    GameObject,
    RigidBody,
    Collider,
    CollisionListener,
    SpriteRenderer,
    SpriteSheetRegistry,
    Transform,
    ParticleEmitter,
    enums,
} = WEED;
const { ShapeType } = enums;

const TWO_PI = Math.PI * 2;

export class Car extends GameObject {
    static scriptUrl = import.meta.url;

    static components = [RigidBody, Collider, CollisionListener, SpriteRenderer, CarComponent];

    setup() {
        this.spriteRenderer.anchorX = 0.5;
        this.spriteRenderer.anchorY = 0.5;
    }

    onSpawned(spawnConfig = {}) {
        const x = spawnConfig.x || 0;
        const y = spawnConfig.y || 0;
        const sprite = spawnConfig.sprite || 'car';

        this.carComponent.maxForwardSpeed = spawnConfig.maxForwardSpeed ?? CAR_DEFAULTS.maxForwardSpeed;
        this.carComponent.maxBackwardSpeed = spawnConfig.maxBackwardSpeed ?? CAR_DEFAULTS.maxBackwardSpeed;
        this.carComponent.maxDriveForce = spawnConfig.maxDriveForce ?? CAR_DEFAULTS.maxDriveForce;
        this.carComponent.maxLateralImpulse = spawnConfig.maxLateralImpulse ?? CAR_DEFAULTS.maxLateralImpulse;
        this.carComponent.turnTorque = spawnConfig.turnTorque ?? CAR_DEFAULTS.turnTorque;
        this.carComponent.angularFriction = spawnConfig.angularFriction ?? CAR_DEFAULTS.angularFriction;
        this.carComponent.forwardDrag = spawnConfig.forwardDrag ?? CAR_DEFAULTS.forwardDrag;
        this.carComponent.minSteerSpeed = spawnConfig.minSteerSpeed ?? CAR_DEFAULTS.minSteerSpeed;
        this.carComponent.minSteerFactor = spawnConfig.minSteerFactor ?? CAR_DEFAULTS.minSteerFactor;
        this.carComponent.maxSteerSpeed = spawnConfig.maxSteerSpeed ?? CAR_DEFAULTS.maxSteerSpeed;
        this.carComponent.spriteScale = spawnConfig.scale ?? spawnConfig.spriteScale ?? CAR_DEFAULTS.spriteScale;

        const scale = this.carComponent.spriteScale;
        this.setSpritesheet(sprite);
        this.setAnimation('0');
        this.setScale(scale, scale);

        const carLength = this.spriteRenderer.originalWidth * scale * 0.9;
        const carHeight = this.spriteRenderer.originalHeight * scale * 0.75;

        this.collider.shapeType = ShapeType.Box;
        this.collider.width = carLength;
        this.collider.height = carHeight;
        this.collider.radius = 0;
        this.collider.isTrigger = 0;
        this.collider.friction = 0.3;
        this.collider.visualRange = Math.hypot(carLength, carHeight) * 0.5 + 200;

        this.rigidBody.static = 0;
        this.rigidBody.linearDamping = 0.05;
        this.rigidBody.angularDamping = 0.5;
        this.rigidBody.sleeping = 0;
        // Box follows Transform.rotation; sprite uses pre-baked frames (draw rot = 0)
        this.setFixedRotation(0);
        this.spriteRenderer.inheritTransformRotation = 0;
        this.spriteRenderer.spriteRotation = 0;

        this.x = x;
        this.y = y;
        const heading = spawnConfig.rotation ?? 0;
        this.rotation = heading;

        this.carComponent.active = 1;
        this.carComponent.vx = 0;
        this.carComponent.vy = 0;
        this.carComponent.angle = heading;
        this._updateSpriteFrame();
    }

    onDespawned() {
        this.carComponent.active = 0;
        this.carComponent.vx = 0;
        this.carComponent.vy = 0;
        this.carComponent.angle = 0;
    }

    _getHeadingAxes() {
        // Heading in carComponent.angle; synced to Transform.rotation for the box
        const angle = this.carComponent.angle;
        const frontX = Math.cos(angle);
        const frontY = Math.sin(angle);
        const rightX = frontY;
        const rightY = -frontX;
        return { angle, frontX, frontY, rightX, rightY };
    }

    /**
     * Phaser updateFriction: capped lateral cancel + forward drag.
     * Lateral cancel as impulse J=-m*v_lat → ax = Δv/dt (WEED force channel).
     */
    _updateFriction(dtRatio) {
        const i = this.index;
        const dt = Math.max(dtRatio / 60, 1e-6);
        const vx = RigidBody.vx[i];
        const vy = RigidBody.vy[i];
        const { frontX, frontY, rightX, rightY } = this._getHeadingAxes();

        const latSpeed = dot2(vx, vy, rightX, rightY);
        let dVx = -rightX * latSpeed;
        let dVy = -rightY * latSpeed;
        const dLen = Math.hypot(dVx, dVy);
        const maxDv = this.carComponent.maxLateralImpulse;
        if (dLen > maxDv && dLen > 1e-6) {
            const s = maxDv / dLen;
            dVx *= s;
            dVy *= s;
        }
        RigidBody.ax[i] += dVx / dt;
        RigidBody.ay[i] += dVy / dt;

        const fwdSpeed = dot2(vx, vy, frontX, frontY);
        if (Math.abs(fwdSpeed) > 1e-3) {
            const drag = -this.carComponent.forwardDrag * Math.abs(fwdSpeed);
            const inv = 1 / Math.abs(fwdSpeed);
            RigidBody.ax[i] += frontX * fwdSpeed * inv * drag;
            RigidBody.ay[i] += frontY * fwdSpeed * inv * drag;
        }
    }

    /**
     * Phaser updateDrive + updateTurn.
     * Turn integrates carComponent.angle; tick syncs Transform.rotation for the box.
     * @param {number} desiredSpeed - target forward speed px/s (0 = coast)
     * @param {number} turnInput - steer in [-1, 1]
     */
    applyForces(desiredSpeed, turnInput = 0, dtRatio = 1) {
        const i = this.index;
        if (!Transform.active[i]) return;

        const vx = RigidBody.vx[i];
        const vy = RigidBody.vy[i];
        const { frontX, frontY } = this._getHeadingAxes();
        const currentSpeed = dot2(vx, vy, frontX, frontY);

        if (desiredSpeed !== 0) {
            const maxForce = this.carComponent.maxDriveForce;
            let force = 0;
            if (desiredSpeed > currentSpeed) force = maxForce;
            else if (desiredSpeed < currentSpeed) force = -maxForce;
            if (force !== 0) {
                RigidBody.ax[i] += frontX * force;
                RigidBody.ay[i] += frontY * force;
            }
        }

        if (turnInput !== 0) {
            const absFwd = Math.abs(currentSpeed);
            const minSteer = this.carComponent.minSteerSpeed;
            if (absFwd >= minSteer) {
                const maxSteer = this.carComponent.maxSteerSpeed;
                const minFactor = this.carComponent.minSteerFactor;
                const speedFactor = Math.min(absFwd / maxSteer, 1);
                const steerFactor = minFactor + (1 - minFactor) * speedFactor;
                const steerDirection = currentSpeed >= 0 ? 1 : -1;
                const dt = Math.max(dtRatio / 60, 1e-6);
                this.carComponent.angle +=
                    turnInput * this.carComponent.turnTorque * steerFactor * steerDirection * dt;
            }
        }

        if (desiredSpeed !== 0 || turnInput !== 0) {
            RigidBody.sleeping[i] = 0;
        }
    }

    tick(dtRatio) {
        const i = this.index;
        if (!Transform.active[i]) return;

        this.carComponent.vx = RigidBody.vx[i];
        this.carComponent.vy = RigidBody.vy[i];
        // Drive Box2D body angle via command ring (raw Transform.rotation poke gets
        // overwritten by physics step → collider flicker). Kill ω so collisions
        // don't spin the box away from arcade heading.
        this.rotation = this.carComponent.angle;
        this.angularVelocity = 0;

        this._updateFriction(dtRatio);
        this._emitDust();
        this._updateSpriteFrame();
    }

    /** Pick pre-baked angle animation from carComponent.angle (old jointed-car visual). */
    _updateSpriteFrame() {
        const spritesheetId = this.spriteRenderer.spritesheetId;
        if (!spritesheetId) return;
        const spritesheet = SpriteSheetRegistry.getSpritesheetName(spritesheetId);
        if (!spritesheet) return;

        const animNames = SpriteSheetRegistry.getAnimationNames(spritesheet);
        const angleKeys = animNames
            .map(k => ({ num: parseFloat(k), key: k }))
            .filter(p => !isNaN(p.num))
            .sort((a, b) => a.num - b.num);
        if (angleKeys.length === 0) return;

        let angle = this.carComponent.angle;
        if (angle == null || isNaN(angle)) return;
        if (angle < 0) angle += TWO_PI;
        const degrees = (angle * 180) / Math.PI;
        const degreesNorm = ((degrees % 360) + 360) % 360;

        const index = Math.round((degreesNorm / 360) * angleKeys.length) % angleKeys.length;
        this.setAnimation(angleKeys[index].key);
    }

    _emitDust() {
        const i = this.index;
        const speed = RigidBody.speed[i];
        if (speed < 90 || Math.random() > 0.35) return;

        const angle = this.carComponent.angle;
        const angleDeg = (angle * 180) / Math.PI;
        const backX = Transform.x[i] - Math.cos(angle) * (this.collider.width * 0.35);
        const backY = Transform.y[i] - Math.sin(angle) * (this.collider.width * 0.35);

        ParticleEmitter.emit({
            count: Math.floor(Math.random() * 2) + 1,
            x: backX + (Math.random() - 0.5) * 8,
            y: backY + (Math.random() - 0.5) * 8,
            z: -5 - Math.random() * 10,
            angleXY: { min: angleDeg + 160, max: angleDeg + 200 },
            speed: { min: 0.2, max: 1.2 },
            vz: -Math.random() * 0.5,
            gravity: 0,
            rotation: { min: 0, max: 360 },
            flipX: Math.random() > 0.5,
            flipY: Math.random() > 0.5,
            lifespan: { min: 300, max: 1800 },
            scale: { min: 0.4, max: 1.5 },
            texture: 'smoke',
            tint: { min: 0x999999, max: 0xbbbbbb },
            alpha: { min: 0.05, max: 0.1 },
            tweenToAlpha0: true,
        });
    }

    onCollisionEnter(otherEntityIndex) {
        this.rigidBody.ax *= 0.3;
        this.rigidBody.ay *= 0.3;

        const hitX = (this.x + Transform.x[otherEntityIndex]) / 2;
        const hitY = (this.y + Transform.y[otherEntityIndex]) / 2;
        const halfDiag = Math.hypot(this.collider.width, this.collider.height) * 0.5;
        const speed = RigidBody.speed[this.index];

        const relSpeed =
            Math.abs(RigidBody.vx[otherEntityIndex] - RigidBody.vx[this.index]) +
            Math.abs(RigidBody.vy[otherEntityIndex] - RigidBody.vy[this.index]);
        const numSparks = Math.min(24, Math.max(1, Math.floor(relSpeed / 60)));

        if (speed > 180) {
            ParticleEmitter.emit({
                count: numSparks,
                x: hitX,
                y: hitY,
                z: -Math.random() * halfDiag * 0.25,
                angleXY: { min: 0, max: 360 },
                speed: { min: halfDiag * 0.08, max: halfDiag * 0.18 },
                rotation: { min: 0, max: 360 },
                vz: -Math.random() * 4 - 2,
                gravity: 0.6,
                lifespan: { min: 200, max: 1200 },
                scale: { min: 0.3, max: 0.66 },
                texture: '_whiteCircle',
                tint: { min: 0xffff00, max: 0xffbb00 },
                alpha: { min: 0.8, max: 1 },
                stayOnTheFloor: false,
                despawnOnGroundContact: true,
            });

            ParticleEmitter.emit({
                count: numSparks,
                x: hitX,
                y: hitY + Math.random() * 8,
                z: -5 - Math.random() * 10,
                angleXY: 0,
                speed: { min: 0.2, max: 1.2 },
                vz: -Math.random() * 1.5,
                gravity: 0,
                rotation: { min: 0, max: 360 },
                flipX: Math.random() > 0.5,
                flipY: Math.random() > 0.5,
                lifespan: { min: 300, max: 1800 },
                scale: { min: 0.4, max: 1.5 },
                texture: 'smoke',
                tint: { min: 0x999999, max: 0xbbbbbb },
                alpha: { min: 0.05, max: 0.1 },
                tweenToAlpha0: true,
            });
        }
    }
}
