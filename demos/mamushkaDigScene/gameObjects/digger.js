// Digger — A/D walk, W/up jetpack, LMB laser from body to mouse (not a separate entity).

import WEED from '/src/index.js';
import { flushMamushkaDeferred, MamushkaBox } from './mamushkaBox.js';

const {
  GameObject,
  AdobeAnimComponent,
  AdobeAnimRegistry,
  RigidBody,
  Collider,
  Keyboard,
  CollisionListener,
  Mouse,
  Ray,
  ParticleEmitter,
  Layer,
  Transform,
} = WEED;

const MOVE_ACCEL = 1800;
const AIR_CONTROL = 0.35;
const JETPACK_ACCEL = -3600;
const SCALE = 0.35;
const BODY_RADIUS = 30;
const LASER_COOLDOWN_MS = 50;
const LASER_RANGE = 2500;
const LASER_DAMAGE = 1;
const LASER_STEPS = 60;
const ASSET = 'blue_character';
const CLIPS = Object.freeze({
  idle: 'idle',
  running: 'running',
  jumping: 'jumping',
});

export class Digger extends GameObject {
  static scriptUrl = import.meta.url;
  static components = [
    AdobeAnimComponent,
    RigidBody,
    Collider,
    CollisionListener,
  ];

  setup() {
    this.rigidBody.static = 0;
    this.rigidBody.linearDamping = 0.12;
    this.collider.radius = BODY_RADIUS;
    this.collider.visualRange = 160;
    this.setFixedRotation(1);
    this._grounded = 0;
    this._lastFireAt = 0;
    this._laserArmed = 0;
  }

  onSpawned(spawnConfig = {}) {
    this._grounded = 0;
    this._lastFireAt = 0;
    this._laserArmed = Mouse.isButton0Down ? 0 : 1;
    this.x = spawnConfig.x ?? 100;
    this.y = spawnConfig.y ?? 100;
    this.setVelocity(0, 0);

    const clip = this._resolveClip(CLIPS.idle, CLIPS.running);
    this.adobeAnimComponent.setAsset(ASSET, clip, {
      loop: true,
      scaleX: spawnConfig.scaleX ?? SCALE,
      scaleY: spawnConfig.scaleY ?? SCALE,
      anchorX: 0.5,
      anchorY: 0.73,
      alpha: 1,
      tint: 0xffffff,
    });
  }

  onCollisionEnter(other) {
    if (Transform.y[other] > this.y) this._grounded = 1;
  }

  onCollisionStay(other) {
    if (Transform.y[other] > this.y) this._grounded = 1;
  }

  onCollisionExit(_other) {
    this._grounded = 0;
  }

  _resolveClip(...candidates) {
    const assetId = AdobeAnimRegistry.getAssetId(ASSET);
    if (!assetId) return candidates[0] || null;
    for (let i = 0; i < candidates.length; i++) {
      const name = candidates[i];
      if (!name) continue;
      if (AdobeAnimRegistry.getClipId(assetId, name) !== 0) return name;
    }
    return candidates[0] || null;
  }

  _faceAndAnim(jetting) {
    const vx = this.rigidBody.vx || 0;
    const moving = Math.abs(vx) > 6;
    if (jetting) {
      if (this.adobeAnimComponent.clipName !== CLIPS.jumping) {
        this.adobeAnimComponent.play(CLIPS.jumping, true);
      }
      this.adobeAnimComponent.playbackRate = 0.15;
    } else if (moving) {
      if (this.adobeAnimComponent.clipName !== CLIPS.running) {
        this.adobeAnimComponent.play(CLIPS.running, true);
      }
      this.adobeAnimComponent.playbackRate = Math.abs(vx) / 300 + 0.2;
    } else if (this.adobeAnimComponent.clipName !== CLIPS.idle) {
      this.adobeAnimComponent.play(CLIPS.idle, true);
      this.adobeAnimComponent.playbackRate = 0.2;
    }
    this.adobeAnimComponent.scaleX = vx >= 0 ? SCALE : -SCALE;
    this.adobeAnimComponent.scaleY = SCALE;
  }

  _emitJetpack() {
    ParticleEmitter.emitFlat({
      count: { min: 4, max: 10 },
      x: this.x,
      y: this.y + BODY_RADIUS * 0.7,
      dirX: 0,
      dirY: 1,
      spread: 0.18,
      speed: { min: 18, max: 50 },
      gravity: 0.4,
      lifespan: { min: 160, max: 420 },
      scale: { min: 0.5, max: 1.2 },
      texture: '_whiteCircle',
      tint: { min: 0xffee66, max: 0xff6600 },
      alpha: { min: 0.65, max: 1 },
    });
    ParticleEmitter.emitFlat({
      count: { min: 1, max: 3 },
      x: this.x,
      y: this.y + BODY_RADIUS * 0.85,
      spread: { min: 80, max: 280 },
      speed: { min: 1, max: 6 },
      gravity: -0.2,
      lifespan: { min: 280, max: 700 },
      scale: { min: 0.8, max: 1.8 },
      texture: '_whiteCircle',
      tint: { min: 0x666666, max: 0xbbbbbb },
      alpha: { from: { min: 0.12, max: 0.28 }, to: 0 },
    });
  }

  _fireLaser(accumulatedTime) {
    if (!this._laserArmed) {
      if (!Mouse.isButton0Down) this._laserArmed = 1;
      return;
    }
    if (!Mouse.isButton0Down) return;
    const now = accumulatedTime || 0;
    if (now - this._lastFireAt < LASER_COOLDOWN_MS) return;
    this._lastFireAt = now;

    const px = this.x;
    const py = this.y;
    const tx = Mouse.x;
    const ty = Mouse.y;
    const dx = tx - px;
    const dy = ty - py;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const nx = dx / len;
    const ny = dy / len;
    const ox = px + nx * (BODY_RADIUS + 2);
    const oy = py + ny * (BODY_RADIUS + 2);

    const info = Ray.castWithInfo(ox, oy, tx, ty, LASER_RANGE);
    const endX = info.hit ? info.hitX : ox + nx * LASER_RANGE;
    const endY = info.hit ? info.hitY : oy + ny * LASER_RANGE;
    this._emitBeam(ox, oy, endX, endY);

    if (!info.hit || info.entityIndex < 0) return;
    if (Transform.entityType[info.entityIndex] !== MamushkaBox.entityType) return;
    const box = GameObject.get(info.entityIndex);
    if (box && box.active) box.takeHit(LASER_DAMAGE);
  }

  _emitBeam(x0, y0, x1, y1) {
    const layerId = Layer.getId('dust');
    const dx = x1 - x0;
    const dy = y1 - y0;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    for (let i = 1; i <= LASER_STEPS; i++) {
      setTimeout(() => {
        const t = i / (LASER_STEPS + 1);
        ParticleEmitter.emitFlat({
          count: 1,
          x: x0 + dx * t,
          y: y0 + dy * t,
          angleXY: 0,
          speed: 0,
          gravity: -0.1,
          lifespan: { min: 40, max: 90 },
          scale: { start: 1, end: { min: 2, max: 4 } },
          texture: '_whiteCircle',
          tint: { min: 0xff6622, max: 0xffcc44 },
          alpha: { from: { min: 0.5, max: 0.9 }, to: 0 },
          layerId,
        });
      }, i * 0.5);
    }
    ParticleEmitter.emitFlat({
      count: 4,
      x: x1,
      y: y1,
      angleXY: { min: 0, max: 360 },
      speed: { min: 0.5, max: 2.5 },
      gravity: 0.2,
      lifespan: { min: 70, max: 150 },
      scale: { min: 1, max: 2 },
      texture: '_whiteCircle',
      tint: { min: 0xffaa33, max: 0xffffaa },
      alpha: { from: { min: 0.5, max: 0.9 }, to: 0 },
      layerId,
    });
  }

  tick(_dtRatio, _deltaTime, accumulatedTime) {
    flushMamushkaDeferred();

    const left = Keyboard.isDown('a') || Keyboard.isDown('arrowleft');
    const right = Keyboard.isDown('d') || Keyboard.isDown('arrowright');
    const jet = Keyboard.isDown('w') || Keyboard.isDown('arrowup');
    const side = this._grounded ? 1 : AIR_CONTROL;

    if (left) this.addAcceleration(-MOVE_ACCEL * side, 0);
    if (right) this.addAcceleration(MOVE_ACCEL * side, 0);
    if (jet) {
      this.addAcceleration(0, JETPACK_ACCEL);
      this._emitJetpack();
    }

    this._faceAndAnim(jet);
    this._fireLaser(accumulatedTime);
    this._grounded = 0;
  }
}
