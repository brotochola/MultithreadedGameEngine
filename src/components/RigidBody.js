// RigidBody.js - Physics component for entity motion and dynamics
// Handles velocity, acceleration, mass, and physics properties
// Position and rotation are stored in Transform component

import { Component } from '../core/Component.js';
import { Collider } from './Collider.js';
import { updateMassFromCircle, updateMassFromBox } from '../core/utils.js';

export class RigidBody extends Component {
  // Array schema - defines all physics properties
  static ARRAY_SCHEMA = {
    active: Uint8Array, // 0 = entity doesn't have this component, 1 = active
    static: Uint8Array, // 0 = dynamic, 1 = static

    // Linear motion
    vx: Float32Array,
    vy: Float32Array,
    ax: Float32Array,
    ay: Float32Array,

    // Verlet integration (for alternative physics mode)
    px: Float32Array, // Previous X position
    py: Float32Array, // Previous Y position

    // Angular motion
    angularVelocity: Float32Array,
    angularAccel: Float32Array,

    // Mass properties
    mass: Float32Array,
    invMass: Float32Array,
    inertia: Float32Array,
    invInertia: Float32Array,

    // Damping
    drag: Float32Array,
    angularDrag: Float32Array,

    // Constraints
    maxVel: Float32Array,
    minSpeed: Float32Array,
    friction: Float32Array,

    // Computed values
    velocityAngle: Float32Array,
    speed: Float32Array,
    collisionCount: Uint8Array, // Number of collisions this frame

    // Sleeping optimization (gated by physics.sleeping config)
    sleeping: Uint8Array, // 0 = awake, 1 = sleeping (physics skips Verlet integrate when sleep enabled)
    stillnessTime: Float32Array, // Consecutive still frames (particle ticks), not seconds
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM GETTERS/SETTERS
  // These override the auto-generated accessors from Component._createInstanceProperties()
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Recompute mass and inverse mass from the entity's Collider.
   *
   * Dynamic bodies with invalid or missing collider geometry become unit-mass
   * bodies once here. Static bodies keep `invMass = 0` even if their collider
   * dimensions change later.
   *
   * @param {number} index - Entity index
   * @returns {boolean} True when collider geometry supplied mass, false when unit mass was used
   */
  static syncMassFromCollider(index) {
    if (!RigidBody.active || !RigidBody.active[index]) return false;

    const isStatic = RigidBody.static[index] !== 0;
    let massInitialized = false;
    let shapeType = -1;

    if (Collider.active && Collider.active[index]) {
      shapeType = Collider.shapeType[index];
      if (shapeType === 0) {
        const radius = Collider.radius[index];
        if (radius > 0) {
          if (isStatic) {
            RigidBody.mass[index] = Math.PI * radius * radius;
            RigidBody.invMass[index] = 0;
          } else {
            updateMassFromCircle(index, radius, RigidBody);
          }
          massInitialized = true;
        }
      } else if (shapeType === 1 || shapeType === 2) {
        // Box (AABB) and OrientedBox share rectangle area mass
        const width = Collider.width[index];
        const height = Collider.height[index];
        if (width > 0 && height > 0) {
          if (isStatic) {
            RigidBody.mass[index] = width * height;
            RigidBody.invMass[index] = 0;
          } else {
            updateMassFromBox(index, width, height, RigidBody);
          }
          massInitialized = true;
        }
      }
    }

    if (!massInitialized) {
      const currentMass = RigidBody.mass[index];
      if (isStatic) {
        if (!(currentMass > 0)) RigidBody.mass[index] = 0;
        RigidBody.invMass[index] = 0;
      } else if (currentMass > 0) {
        RigidBody.invMass[index] = 1 / currentMass;
      } else {
        RigidBody.mass[index] = 1;
        RigidBody.invMass[index] = 1;
      }
    }

    RigidBody.syncInertiaFromCollider(index, shapeType, isStatic);
    return massInitialized;
  }

  /**
   * Recompute rotational inertia from collider geometry and mass.
   * Circle: I = 0.5 * m * r²; rectangle (Box/OrientedBox): I = m * (w² + h²) / 12.
   * Static bodies always get invInertia = 0.
   */
  static syncInertiaFromCollider(index, shapeType = -1, isStatic = null) {
    if (!RigidBody.active || !RigidBody.active[index]) return;

    if (isStatic === null) isStatic = RigidBody.static[index] !== 0;
    if (shapeType < 0 && Collider.active && Collider.active[index]) {
      shapeType = Collider.shapeType[index];
    }

    const mass = RigidBody.mass[index];
    let inertia = 0;

    if (shapeType === 0) {
      const r = Collider.radius[index];
      if (r > 0 && mass > 0) inertia = 0.5 * mass * r * r;
    } else if (shapeType === 1 || shapeType === 2) {
      const w = Collider.width[index];
      const h = Collider.height[index];
      if (w > 0 && h > 0 && mass > 0) inertia = (mass * (w * w + h * h)) / 12;
    }

    RigidBody.inertia[index] = inertia;
    RigidBody.invInertia[index] = isStatic || !(inertia > 0) ? 0 : 1 / inertia;
  }

  /**
   * Instance convenience wrapper for custom setup/onSpawned code.
   * @returns {boolean}
   */
  syncMassFromCollider() {
    return RigidBody.syncMassFromCollider(this.index);
  }

  /**
   * Static property - custom setter that sets invMass = 0 for static entities
   * Static entities have infinite mass (invMass = 0) and don't move
   *
   * Example:
   *   this.rigidBody.static = 1;  // Sets invMass = 0 (infinite mass)
   */
  get static() {
    return RigidBody.static[this.index];
  }
  set static(value) {
    // 1. Store the static value
    RigidBody.static[this.index] = value ? 1 : 0;

    // 2. Re-sync from collider geometry; static bodies preserve invMass = 0.
    RigidBody.syncMassFromCollider(this.index);
  }

  /**
   * Mass — keeps invMass + rotational inertia in sync when set at runtime.
   */
  get mass() {
    return RigidBody.mass[this.index];
  }
  set mass(value) {
    const m = value > 0 ? value : 0;
    RigidBody.mass[this.index] = m;
    const isStatic = RigidBody.static[this.index] !== 0;
    RigidBody.invMass[this.index] = isStatic || !(m > 0) ? 0 : 1 / m;
    RigidBody.syncInertiaFromCollider(this.index, -1, isStatic);
  }

}
