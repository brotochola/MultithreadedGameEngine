import WEED from '/src/index.js';

const { GameObject, Collider, SpriteRenderer } = WEED;

/**
 * Deterministic bouncing probe for neighbor-reuse correctness tests.
 * Speed is capped so per-frame displacement ≪ Verlet skin (0.25 * visualRange).
 */
export class NeighborReuseProbe extends GameObject {
  static scriptUrl = import.meta.url;
  static components = [Collider, SpriteRenderer];

  onSpawned({
    x = 0,
    y = 0,
    radius = 10,
    visualRange = 120,
    vx = 40,
    vy = 30,
    minX = 80,
    maxX = 1920,
    minY = 80,
    maxY = 1080,
  } = {}) {
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this._vx = vx;
    this._vy = vy;
    this._minX = minX;
    this._maxX = maxX;
    this._minY = minY;
    this._maxY = maxY;

    this.collider.radius = radius;
    this.collider.visualRange = visualRange;
    this.setSprite('ball');
    this.setScale((radius * 2) / 14);
    this.setAnchor(0.5, 0.5);
    this.setAlpha(0.9);
  }

  tick(_dtRatio, deltaTime) {
    // deltaTime in ms; fixedFps:60 ⇒ ~16.67ms. Cap integrates speed in px/s.
    const dt = (deltaTime > 0 ? deltaTime : 16.67) / 1000;
    let x = this.x + this._vx * dt;
    let y = this.y + this._vy * dt;

    if (x < this._minX) {
      x = this._minX;
      this._vx = Math.abs(this._vx);
    } else if (x > this._maxX) {
      x = this._maxX;
      this._vx = -Math.abs(this._vx);
    }
    if (y < this._minY) {
      y = this._minY;
      this._vy = Math.abs(this._vy);
    } else if (y > this._maxY) {
      y = this._maxY;
      this._vy = -Math.abs(this._vy);
    }

    this.x = x;
    this.y = y;
  }
}
