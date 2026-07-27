// Collider.js - Collision component for entity collision detection
// Supports circles, AABB boxes, and convex polygons (Box2D-style, max 8 verts)
//
// CUSTOM SETTERS FOR MASS AUTO-COMPUTATION:
// This component defines custom setters for radius, width, and height that
// automatically compute mass and invMass in the RigidBody component.
//
// Mass formulas:
// - Circle: mass = π * radius²  (area)
// - Box:    mass = width * height (area)
// - Polygon: mass = polygon area (shoelace)

import { Component } from '../core/Component.js';
import { RigidBody } from './RigidBody.js';
import { MAX_POLYGON_VERTICES, ShapeType } from '../core/ConfigDefaults.js';

class Collider extends Component {
  // Array schema - defines all collision properties
  static ARRAY_SCHEMA = {
    active: Uint8Array, // 0 = entity doesn't have this component, 1 = active

    // Shape type
    shapeType: Uint8Array, // 0=Circle, 1=Box (AABB), 2=Polygon

    // Offset from entity position
    offsetX: Float32Array,
    offsetY: Float32Array,

    // Circle shape (also polygon skin radius; 0 = sharp)
    radius: Float32Array,

    // Box shape (AABB); also filled by makeBox for debug/picking convenience
    width: Float32Array,
    height: Float32Array,

    // Trigger mode
    isTrigger: Uint8Array, // trigger=only events, no physical response

    // Collision filtering (32 layers max; layer is index 0-31, mask is bitmask)
    // collisionGroupIndex: Box2D-style group (0 = ignore; same negative = never; same positive = always)
    collisionLayer: Uint8Array,
    collisionMask: Uint32Array,
    collisionGroupIndex: Int32Array,

    // Contact grip (vs RigidBody.friction air drag). Pair μ = min(μi, μj); 0 = off
    contactFriction: Float32Array,

    // Perception (for spatial queries)
    visualRange: Float32Array,

    // Convex polygon (local space) — appended so Circle/AABB field offsets stay stable
    polyCount: Uint8Array, // 0 or 3..MAX_POLYGON_VERTICES
    polyCentroidX: Float32Array,
    polyCentroidY: Float32Array,
    // Strided: index = entity * MAX_POLYGON_VERTICES + vert
    polyVertexX: { type: Float32Array, length: MAX_POLYGON_VERTICES },
    polyVertexY: { type: Float32Array, length: MAX_POLYGON_VERTICES },
    polyNormalX: { type: Float32Array, length: MAX_POLYGON_VERTICES },
    polyNormalY: { type: Float32Array, length: MAX_POLYGON_VERTICES },
  };

  /** @type {number} */
  static MAX_POLYGON_VERTICES = MAX_POLYGON_VERTICES;

  /**
   * Stride base for polygon vert/normal arrays.
   * @param {number} index
   * @returns {number}
   */
  static polyBase(index) {
    return index * MAX_POLYGON_VERTICES;
  }

  /**
   * Box2D b2MakeBox — axis-aligned rectangle in local space (±halfW, ±halfH).
   * Sets shapeType Polygon, polyCount=4, centroid 0, and width/height for convenience.
   * @param {number} index
   * @param {number} halfW
   * @param {number} halfH
   * @returns {boolean}
   */
  static makeBox(index, halfW, halfH) {
    if (!(halfW > 0) || !(halfH > 0)) return false;
    const base = Collider.polyBase(index);
    const vx = Collider.polyVertexX;
    const vy = Collider.polyVertexY;
    const nx = Collider.polyNormalX;
    const ny = Collider.polyNormalY;

    // CCW verts, interior left of each edge (y-down screens still store CCW in local math)
    vx[base] = -halfW; vy[base] = -halfH;
    vx[base + 1] = halfW; vy[base + 1] = -halfH;
    vx[base + 2] = halfW; vy[base + 2] = halfH;
    vx[base + 3] = -halfW; vy[base + 3] = halfH;

    // Outward normals
    nx[base] = 0; ny[base] = -1;
    nx[base + 1] = 1; ny[base + 1] = 0;
    nx[base + 2] = 0; ny[base + 2] = 1;
    nx[base + 3] = -1; ny[base + 3] = 0;

    Collider.polyCount[index] = 4;
    Collider.polyCentroidX[index] = 0;
    Collider.polyCentroidY[index] = 0;
    Collider.width[index] = halfW * 2;
    Collider.height[index] = halfH * 2;
    Collider.shapeType[index] = ShapeType.Polygon;

    RigidBody.syncMassFromCollider(index);
    return true;
  }

  /**
   * Convex polygon from local CCW points (3..MAX_POLYGON_VERTICES).
   * Computes outward normals + centroid. Rejects degenerate / wrong-count input.
   * @param {number} index
   * @param {ArrayLike<{x:number,y:number}|number>|number[]} points - [{x,y},...] or flat [x0,y0,...]
   * @returns {boolean}
   */
  static makePolygon(index, points) {
    const flat = [];
    if (points && typeof points[0] === 'number') {
      for (let i = 0; i + 1 < points.length; i += 2) {
        flat.push(points[i], points[i + 1]);
      }
    } else if (points && points.length) {
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        flat.push(p.x, p.y);
      }
    }
    const count = (flat.length / 2) | 0;
    if (count < 3 || count > MAX_POLYGON_VERTICES) return false;

    // Signed area (shoelace); require positive CCW area
    let twiceArea = 0;
    for (let i = 0; i < count; i++) {
      const j = i + 1 < count ? i + 1 : 0;
      twiceArea += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1];
    }
    if (!(twiceArea > 1e-8)) return false;

    const base = Collider.polyBase(index);
    const vx = Collider.polyVertexX;
    const vy = Collider.polyVertexY;
    const nx = Collider.polyNormalX;
    const ny = Collider.polyNormalY;

    let cx = 0;
    let cy = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < count; i++) {
      const x = flat[i * 2];
      const y = flat[i * 2 + 1];
      vx[base + i] = x;
      vy[base + i] = y;
      const j = i + 1 < count ? i + 1 : 0;
      const w = x * flat[j * 2 + 1] - flat[j * 2] * y;
      cx += (x + flat[j * 2]) * w;
      cy += (y + flat[j * 2 + 1]) * w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const inv6A = 1 / (3 * twiceArea);
    cx *= inv6A;
    cy *= inv6A;

    for (let i = 0; i < count; i++) {
      const j = i + 1 < count ? i + 1 : 0;
      const ex = vx[base + j] - vx[base + i];
      const ey = vy[base + j] - vy[base + i];
      // Outward normal (right of edge for CCW winding)
      let nnx = ey;
      let nny = -ex;
      const len = Math.sqrt(nnx * nnx + nny * nny);
      if (!(len > 1e-12)) return false;
      const inv = 1 / len;
      nx[base + i] = nnx * inv;
      ny[base + i] = nny * inv;
    }

    Collider.polyCount[index] = count;
    Collider.polyCentroidX[index] = cx;
    Collider.polyCentroidY[index] = cy;
    Collider.width[index] = maxX - minX;
    Collider.height[index] = maxY - minY;
    Collider.shapeType[index] = ShapeType.Polygon;

    RigidBody.syncMassFromCollider(index);
    return true;
  }

  /**
   * Polygon area via shoelace (local verts). 0 if count < 3.
   * @param {number} index
   * @returns {number}
   */
  static polygonArea(index) {
    const count = Collider.polyCount[index];
    if (count < 3) return 0;
    const base = Collider.polyBase(index);
    const vx = Collider.polyVertexX;
    const vy = Collider.polyVertexY;
    let twice = 0;
    for (let i = 0; i < count; i++) {
      const j = i + 1 < count ? i + 1 : 0;
      twice += vx[base + i] * vy[base + j] - vx[base + j] * vy[base + i];
    }
    return twice * 0.5;
  }

  /**
   * Rotational inertia about centroid for unit density, then scaled by mass/area.
   * Matches Box2D b2ComputePolygonMass style (about centroid).
   * @param {number} index
   * @param {number} mass
   * @returns {number}
   */
  static polygonInertia(index, mass) {
    const count = Collider.polyCount[index];
    if (count < 3 || !(mass > 0)) return 0;
    const area = Collider.polygonArea(index);
    if (!(area > 1e-12)) return 0;

    const base = Collider.polyBase(index);
    const vx = Collider.polyVertexX;
    const vy = Collider.polyVertexY;
    const cx = Collider.polyCentroidX[index];
    const cy = Collider.polyCentroidY[index];

    let I = 0;
    for (let i = 0; i < count; i++) {
      const j = i + 1 < count ? i + 1 : 0;
      const ax = vx[base + i] - cx;
      const ay = vy[base + i] - cy;
      const bx = vx[base + j] - cx;
      const by = vy[base + j] - cy;
      const cross = ax * by - ay * bx;
      I += cross * (ax * ax + ay * ay + ax * bx + ay * by + bx * bx + by * by);
    }
    // Unit-density inertia about centroid; scale to actual mass
    const unitI = I / 12;
    return (mass / area) * unitI;
  }

  makeBox(halfW, halfH) {
    return Collider.makeBox(this.index, halfW, halfH);
  }

  makePolygon(points) {
    return Collider.makePolygon(this.index, points);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM GETTERS/SETTERS
  // ═══════════════════════════════════════════════════════════════════════════

  get radius() {
    return Collider.radius[this.index];
  }
  set radius(value) {
    Collider.radius[this.index] = value;
    RigidBody.syncMassFromCollider(this.index);
  }

  get width() {
    return Collider.width[this.index];
  }
  set width(value) {
    Collider.width[this.index] = value;
    RigidBody.syncMassFromCollider(this.index);
  }

  get height() {
    return Collider.height[this.index];
  }
  set height(value) {
    Collider.height[this.index] = value;
    RigidBody.syncMassFromCollider(this.index);
  }

  get collisionLayer() {
    return Collider.collisionLayer[this.index];
  }
  set collisionLayer(value) {
    Collider.collisionLayer[this.index] = value & 31;
  }

  get collisionMask() {
    return Collider.collisionMask[this.index];
  }
  set collisionMask(value) {
    Collider.collisionMask[this.index] = value;
  }

  get collisionGroupIndex() {
    return Collider.collisionGroupIndex[this.index];
  }
  set collisionGroupIndex(value) {
    Collider.collisionGroupIndex[this.index] = value | 0;
  }

  addLayerToMask(layer) {
    Collider.collisionMask[this.index] |= (1 << (layer & 31));
  }

  removeLayerFromMask(layer) {
    Collider.collisionMask[this.index] &= ~(1 << (layer & 31));
  }

  collidesWithLayer(layer) {
    return !!(Collider.collisionMask[this.index] & (1 << (layer & 31)));
  }
}

// ES6 module export
export { Collider };
