// Transform.js - Entity state SoA + HEAP-bound pose views
// SoA: active / entityType / isItOnScreen
// Pose (x/y/rotation): placeholders until box2dReady, then WASM HEAP via bindBox2dHotFields

import { Component } from '../core/Component.js';

export class Transform extends Component {
  static ARRAY_SCHEMA = {
    active: Uint8Array, // 0 = inactive, 1 = active
    entityType: Uint8Array, // Entity type ID (auto-assigned during registration)
    isItOnScreen: Uint8Array, // Canonical entity screen visibility, published by pre_render_worker
  };

  static initializeArrays(buffer, count) {
    super.initializeArrays(buffer, count);
    // Pre-HEAP placeholders so GameObject.setup() can write this.x during worker init
    Transform.x = new Float32Array(count);
    Transform.y = new Float32Array(count);
    Transform.rotation = new Float32Array(count);
  }

  static clearArrays() {
    super.clearArrays();
    Transform.x = null;
    Transform.y = null;
    Transform.rotation = null;
  }

  // HEAP-bound (not in ARRAY_SCHEMA) — instance accessors for entity.transform.x etc.
  get x() {
    return Transform.x[this.index];
  }
  set x(value) {
    Transform.x[this.index] = value;
  }
  get y() {
    return Transform.y[this.index];
  }
  set y(value) {
    Transform.y[this.index] = value;
  }
  get rotation() {
    return Transform.rotation[this.index];
  }
  set rotation(value) {
    Transform.rotation[this.index] = value;
  }
}
