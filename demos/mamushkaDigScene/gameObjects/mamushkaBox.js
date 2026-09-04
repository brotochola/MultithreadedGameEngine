// MamushkaBox — packed roots static; split kids may go dynamic; leaf → LiquidFun sand.

import WEED from '/src/index.js';
import {
  MamushkaComponent,
  MATERIAL_DIRT,
  MATERIAL_TINT,
  maxHpFor,
} from '../components/mamushkaComponent.js';

const {
  GameObject,
  RigidBody,
  Collider,
  SpriteRenderer,
  JointBreakListener,
  Joint,
  Transform,
  LightOccluder,
  Layer,
  LiquidFun,
  LIQUIDFUN_FLAGS,
  enums
} = WEED;
const { ShapeType } = enums;

/** Leaf edge in world px (level 0). Shatter only. Packed finest is level 1. */
export const LEAF_SIZE = 32;
/** Prototype cellSizePx = orderSize(1). */
export const ORDER1_CELL = LEAF_SIZE * 2;
/** Split kids at this level or below become dynamic. Packed roots stay static. */
export const DYNAMIC_MAX_LEVEL = 2;
/** Prototype MATERIALS[*].tileScale — world px per full rocky tile. */
export const ROCK_TILE_SCALE = 0.25;
/** Outset sprite vs collider so packed faces bleed (hides AABB seams in contour RT). */
export const ROCK_FILL_OVERLAP_PX = 2;
const ROCK_TEX_FALLBACK = 512;

const WELD_FORCE = 20e8;
const WELD_TORQUE = 10e9;

const AWAKE_R = 2200;
const AWAKE_R2 = AWAKE_R * AWAKE_R;
const WAKE_R2 = (AWAKE_R * 0.85) * (AWAKE_R * 0.85);

const _kids = [];
const _weldQ = new Int32Array(256);
let _weldN = 0;

function sizeForLevel(level) {
  return LEAF_SIZE << (level | 0);
}

function sandLayerId() {
  const id = Layer.getId('sand');
  return id >= 0 ? id : 0;
}

function emitSand(opts) {
  LiquidFun.emit({
    flags: LIQUIDFUN_FLAGS.POWDER,
    lifespan: 1000,
    fadeToAlpha0: true,
    layerId: sandLayerId(),
    ...opts,
  });
}

function weldPair(aIdx, bIdx, ax, ay) {
  if (aIdx < 0 || bIdx < 0 || aIdx === bIdx) return;
  let a = aIdx;
  let b = bIdx;
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  Joint.addWeld({
    entityA: a,
    entityB: b,
    worldAnchorX: ax,
    worldAnchorY: ay,
    forceThreshold: WELD_FORCE,
    torqueThreshold: WELD_TORQUE,
  });
}

function weldSiblings(kids) {
  if (kids.length < 4) return;
  const a = kids[0];
  const b = kids[1];
  const c = kids[2];
  const d = kids[3];
  if (!a || !b || !c || !d) return;
  if (!a.active || !b.active || !c.active || !d.active) return;
  weldPair(a.index, b.index, (a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
  weldPair(c.index, d.index, (c.x + d.x) * 0.5, (c.y + d.y) * 0.5);
  weldPair(a.index, c.index, (a.x + c.x) * 0.5, (a.y + c.y) * 0.5);
  weldPair(b.index, d.index, (b.x + d.x) * 0.5, (b.y + d.y) * 0.5);
}

function queueWeldGroup(kids) {
  if (kids.length < 4 || _weldN + 4 > _weldQ.length) return;
  _weldQ[_weldN++] = kids[0].index;
  _weldQ[_weldN++] = kids[1].index;
  _weldQ[_weldN++] = kids[2].index;
  _weldQ[_weldN++] = kids[3].index;
}

/** Sibling welds queued last frame. Call from Digger.tick. */
export function flushMamushkaDeferred() {
  if (!_weldN) return;
  const group = _kids;
  for (let i = 0; i < _weldN; i += 4) {
    group.length = 0;
    group.push(
      GameObject.get(_weldQ[i]),
      GameObject.get(_weldQ[i + 1]),
      GameObject.get(_weldQ[i + 2]),
      GameObject.get(_weldQ[i + 3]),
    );
    weldSiblings(group);
  }
  _weldN = 0;
}

/** Sleep dynamic boxes far from the player. Statics stay cheap without this. */
export function sleepFarMamushkaBoxes(px, py) {
  const start = MamushkaBox.startIndex | 0;
  const end = start + (MamushkaBox.poolSize | 0);
  const active = Transform.active;
  const xs = Transform.x;
  const ys = Transform.y;
  const isStatic = RigidBody.static;
  const sleeping = RigidBody.sleeping;
  for (let i = start; i < end; i++) {
    if (!active[i] || isStatic[i]) continue;
    const dx = xs[i] - px;
    const dy = ys[i] - py;
    const d2 = dx * dx + dy * dy;
    if (d2 > AWAKE_R2) {
      if (!sleeping[i]) {
        const go = GameObject.get(i);
        if (go) go.setAwake(false);
      }
    } else if (d2 < WAKE_R2) {
      if (sleeping[i]) {
        const go = GameObject.get(i);
        if (go) go.setAwake(true);
      }
    }
  }
}

export class MamushkaBox extends GameObject {
  static scriptUrl = import.meta.url;

  static components = [
    RigidBody,
    Collider,
    SpriteRenderer,
    JointBreakListener,
    MamushkaComponent,
  ];

  setup() {
    this.setAnchor(0.5, 0.5);
  }

  onSpawned(spawnConfig = {}) {
    const level = spawnConfig.level != null ? spawnConfig.level | 0 : 0;
    const material =
      spawnConfig.material != null ? spawnConfig.material | 0 : MATERIAL_DIRT;
    const size = spawnConfig.size != null ? spawnConfig.size : sizeForLevel(level);
    const isDynamic = spawnConfig.dynamic ? 1 : 0;

    this.mamushkaComponent.level = level;
    this.mamushkaComponent.material = material;
    this.mamushkaComponent.size = size;
    this.mamushkaComponent.hp =
      spawnConfig.hp != null ? spawnConfig.hp | 0 : maxHpFor(level, material);

    this.collider.shapeType = ShapeType.Box;
    this.collider.width = size;
    this.collider.height = size;
    this.collider.radius = 0;
    this.collider.isTrigger = 0;
    this.collider.friction = 0.85;
    this.collider.restitution = 0;
    this.collider.visualRange = size * 0.707 + 200;

    this.rigidBody.static = isDynamic ? 0 : 1;
    this.rigidBody.linearDamping = 0.05;
    this.rigidBody.angularDamping = 0.08;
    this.rigidBody.angularVelocity = spawnConfig.angularVelocity ?? 0;
    this.rigidBody.sleeping = 0;
    if (spawnConfig.vx != null) this.rigidBody.vx = spawnConfig.vx;
    if (spawnConfig.vy != null) this.rigidBody.vy = spawnConfig.vy;
    this.rigidBody.syncMassFromCollider();

    this.rotation = spawnConfig.rotation ?? 0;
    this.setAnchor(0.5, 0.5);
    this.setLayer('terrain');

    this.setSprite(spawnConfig.sprite || 'rocky');
    const texW = this.spriteRenderer.originalWidth || ROCK_TEX_FALLBACK;
    const texH = this.spriteRenderer.originalHeight || ROCK_TEX_FALLBACK;
    const vis = size + ROCK_FILL_OVERLAP_PX;
    this.setScale(vis / texW, vis / texH);
    const period = Math.max(1, (texW * ROCK_TILE_SCALE) | 0);
    this.spriteRenderer.repeatX = period;
    this.spriteRenderer.repeatY = period;
    this.setTint(MATERIAL_TINT[material] ?? 0xffffff);
  }

  onDespawned() {
    Joint.removeAllForEntity(this.index);
  }

  /**
   * Laser / blast damage. Splits or shatters when hp hits 0.
   * @param {number} damage
   * @returns {boolean}
   */
  takeHit(damage = 1) {
    if (!this.active) return false;
    const dmg = Math.max(0, damage * 10 | 0);
    if (dmg <= 0) return false;
    const hp = (this.mamushkaComponent.hp | 0) - dmg;
    this.mamushkaComponent.hp = hp < 0 ? 0 : hp;
    if (hp > 0) return false;

    if ((this.mamushkaComponent.level | 0) <= 0) {
      this._shatterToSand();
      return true;
    }
    this._split();
    return true;
  }

  _shatterToSand() {
    const x = this.x;
    const y = this.y;
    const size = this.mamushkaComponent.size || LEAF_SIZE;
    const material = this.mamushkaComponent.material | 0;
    const tint = MATERIAL_TINT[material] ?? 0xc4a574;
    Joint.removeAllForEntity(this.index);
    emitSand({
      shape: 'box',
      posX: x,
      posY: y,
      halfWidth: size * 0.5,
      halfHeight: size * 0.5,
      tint,
    });
    this.despawn();
  }

  _split() {
    const level = this.mamushkaComponent.level | 0;
    const material = this.mamushkaComponent.material | 0;
    const size = this.mamushkaComponent.size || sizeForLevel(level);
    const childLevel = level - 1;
    const childSize = size * 0.5;
    const cx = this.x;
    const cy = this.y;
    const rot = this.rotation;
    const vx = this.rigidBody.vx || 0;
    const vy = this.rigidBody.vy || 0;
    const omega = this.rigidBody.angularVelocity || 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const q = childSize * 0.5;

    const locals = [
      [-q, -q],
      [q, -q],
      [-q, q],
      [q, q],
    ];

    Joint.removeAllForEntity(this.index);

    const wantWeld = childLevel <= DYNAMIC_MAX_LEVEL;
    const childDynamic = childLevel <= DYNAMIC_MAX_LEVEL;
    _kids.length = 0;
    for (let i = 0; i < 4; i++) {
      const lx = locals[i][0];
      const ly = locals[i][1];
      const wx = cx + lx * cos - ly * sin;
      const wy = cy + lx * sin + ly * cos;
      const kid = MamushkaBox.spawn({
        x: wx,
        y: wy,
        level: childLevel,
        size: childSize,
        material,
        rotation: rot,
        vx,
        vy,
        angularVelocity: omega,
        dynamic: childDynamic,
      });
      if (kid) _kids.push(kid);
      else console.warn('[MamushkaBox] pool exhausted during split');
    }

    this.despawn();
    if (wantWeld) queueWeldGroup(_kids);
  }

  onJointBreak(_jointIndex, entityA, entityB) {
    if (this.index !== entityA) return;
    const x = (Transform.x[entityA] + Transform.x[entityB]) * 0.5;
    const y = (Transform.y[entityA] + Transform.y[entityB]) * 0.5;
    const material = this.mamushkaComponent.material | 0;
    emitSand({
      shape: 'circle',
      posX: x,
      posY: y,
      radius: 10,
      tint: MATERIAL_TINT[material] ?? 0xbba888,
    });
  }
}
