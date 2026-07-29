// CarComponent.js - Data for single-body car entities (Phaser-style top-down)

import { Component } from '/src/core/Component.js';

// Tuning: drive-to-speed + capped lateral cancel + torque steer
export const CAR_DEFAULTS = {
    maxForwardSpeed: 900, // px/s
    maxBackwardSpeed: -350, // px/s
    maxDriveForce: 1200, // px/s² along forward (WEED ax/ay)
    maxLateralImpulse: 400, // max |Δv| lateral cancel per logic step (px/s); lower = more skid
    turnTorque: 4, // desired yaw alpha rad/s² (converted to angularAccel via I/m)
    angularFriction: 6, // yaw damp: alpha += -ω * this
    forwardDrag: 0.6, // forward accel drag scale (~Phaser -2*|v| feel, mass-independent)
    minSteerSpeed: 40, // px/s — no turn when nearly stopped
    minSteerFactor: 0.5, // steer strength at low speed
    maxSteerSpeed: 240, // px/s — full steer at/above this forward speed
    spriteScale: 1.5,
};

export class CarComponent extends Component {
    static ARRAY_SCHEMA = {
        active: Uint8Array,

        maxForwardSpeed: Float32Array,
        maxBackwardSpeed: Float32Array,
        maxDriveForce: Float32Array,
        maxLateralImpulse: Float32Array,
        turnTorque: Float32Array,
        angularFriction: Float32Array,
        forwardDrag: Float32Array,
        minSteerSpeed: Float32Array,
        minSteerFactor: Float32Array,
        maxSteerSpeed: Float32Array,
        spriteScale: Float32Array,

        vx: Float32Array,
        vy: Float32Array,
        angle: Float32Array, // heading radians, synced from Transform.rotation
    };
}
