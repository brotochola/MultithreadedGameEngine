// Car.js - Single ShapeType.Box chassis, Box2D-first drive
// Constant accel while W/S held, linearDamping top speed, soft lateral, torque on A/D only.

import WEED from '/src/index.js';
import { CarComponent, CAR_DEFAULTS } from '../components/carComponent.js';
import { dot2 } from '/src/core/utils.js';
import { randomUnitCS } from '/src/core/utils.js';

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

// Reused by applyForces / friction (zero alloc)
const _heading = { angle: 0, frontX: 0, frontY: 0, rightX: 0, rightY: 0 };

/** Cached numeric anim keys per spritesheet name — avoid rebuild/sort every tick. */
const _angleKeysBySheet = new Map();
const _randCS = { c: 1, s: 0 };

function getAngleKeys(spritesheet) {
    let keys = _angleKeysBySheet.get(spritesheet);
    if (keys) return keys;
    const animNames = SpriteSheetRegistry.getAnimationNames(spritesheet);
    keys = animNames
        .map(k => ({ num: parseFloat(k), key: k }))
        .filter(p => !isNaN(p.num))
        .sort((a, b) => a.num - b.num);
    _angleKeysBySheet.set(spritesheet, keys);
    return keys;
}

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

        this.carComponent.driveForce = spawnConfig.driveForce ?? CAR_DEFAULTS.driveForce;
        this.carComponent.lateralFriction = spawnConfig.lateralFriction ?? CAR_DEFAULTS.lateralFriction;
        this.carComponent.turnTorque = spawnConfig.turnTorque ?? CAR_DEFAULTS.turnTorque;
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
        // Box2D sets terminal speed with driveForce; yaw settle without per-frame torque damp
        this.rigidBody.linearDamping = 1.0;
        this.rigidBody.angularDamping = 3;
        this.rigidBody.sleeping = 0;
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

    /** Host applies torque = angularAccel * mass; map desired alpha → angularAccel via I/m. */
    _alphaToAngularAccel(alpha) {
        const i = this.index;
        const mass = RigidBody.mass[i];
        const inertia = RigidBody.inertia[i];
        if (!(mass > 0) || !(inertia > 0)) return alpha;
        return (alpha * inertia) / mass;
    }

    /** Soft lateral tire friction only — forward coast/top-speed is linearDamping. */
    _updateFriction() {
        const i = this.index;
        GameObject.getHeadingAxes(i, _heading);
        const latSpeed = dot2(RigidBody.vx[i], RigidBody.vy[i], _heading.rightX, _heading.rightY);
        const k = this.carComponent.lateralFriction;
        RigidBody.ax[i] -= _heading.rightX * latSpeed * k;
        RigidBody.ay[i] -= _heading.rightY * latSpeed * k;
    }

    /**
     * @param {number} forwardInput - -1|0|1 (or scaled); constant accel while held
     * @param {number} turnInput - steer in [-1, 1]
     */
    applyForces(forwardInput = 0, turnInput = 0) {
        const i = this.index;
        if (!Transform.active[i]) return;

        GameObject.getHeadingAxes(i, _heading);
        const { frontX, frontY } = _heading;
        const currentSpeed = dot2(RigidBody.vx[i], RigidBody.vy[i], frontX, frontY);

        if (forwardInput !== 0) {
            const force = this.carComponent.driveForce * forwardInput;
            RigidBody.ax[i] += frontX * force;
            RigidBody.ay[i] += frontY * force;
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
                const alpha =
                    turnInput * this.carComponent.turnTorque * steerFactor * steerDirection;
                RigidBody.angularAccel[i] += this._alphaToAngularAccel(alpha);
            }
        }

        if (forwardInput !== 0 || turnInput !== 0) {
            RigidBody.sleeping[i] = 0;
        }
    }

    tick(_dtRatio) {
        const i = this.index;
        if (!Transform.active[i]) return;

        this.carComponent.vx = RigidBody.vx[i];
        this.carComponent.vy = RigidBody.vy[i];

        this._updateFriction();
        this._emitDust();
        this._updateSpriteFrame();
    }

    _updateSpriteFrame() {
        const i = this.index;
        const spritesheetId = this.spriteRenderer.spritesheetId;
        if (!spritesheetId) return;
        const spritesheet = SpriteSheetRegistry.getSpritesheetName(spritesheetId);
        if (!spritesheet) return;

        const angleKeys = getAngleKeys(spritesheet);
        if (angleKeys.length === 0) return;

        // atan2 only for discrete frame sector (cached keys; no rebuild/sort)
        let angle = Math.atan2(
            Transform.rotS ? Transform.rotS[i] : 0,
            Transform.rotC ? Transform.rotC[i] : 1,
        );
        this.carComponent.angle = angle;
        if (angle < 0) angle += TWO_PI;
        const degreesNorm = (((angle * 180) / Math.PI) % 360 + 360) % 360;
        const index = Math.round((degreesNorm / 360) * angleKeys.length) % angleKeys.length;
        const key = angleKeys[index].key;
        if (this._lastAnimKey !== key) {
            this._lastAnimKey = key;
            this.setAnimation(key);
        }
    }

    _emitDust() {
        const i = this.index;
        const speed = RigidBody.speed[i];
        if (speed < 90 || Math.random() > 0.35) return;

        const c = Transform.rotC ? Transform.rotC[i] : 1;
        const s = Transform.rotS ? Transform.rotS[i] : 0;
        const backOff = this.collider.width * 0.35;
        const backX = Transform.x[i] - c * backOff;
        const backY = Transform.y[i] - s * backOff;

        // Rear cone ±20°: rotate (-c,-s) by random spread (no atan2→cos/sin of body angle)
        const spread = (Math.random() * 40 - 20) * (Math.PI / 180);
        const sc = Math.cos(spread);
        const ss = Math.sin(spread);
        const dirX = -c * sc + s * ss;
        const dirY = -c * ss - s * sc;
        const spd = 0.2 + Math.random() * 1.0;

        randomUnitCS(_randCS);
        ParticleEmitter.emit({
            count: Math.floor(Math.random() * 2) + 1,
            x: backX + (Math.random() - 0.5) * 8,
            y: backY + (Math.random() - 0.5) * 8,
            z: -5 - Math.random() * 10,
            vx: dirX * spd,
            vy: dirY * spd,
            vz: -Math.random() * 0.5,
            gravity: 0,
            rotC: _randCS.c,
            rotS: _randCS.s,
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
