import WEED from '/src/index.js';

const { GameObject, ParticleEmitter } = WEED;

const EMIT_PER_TICK = 128;
const POSITION_SLOTS = 2048;
const WORLD_W = 4000;
const WORLD_H = 3000;
const MARGIN = 64;

/**
 * Fires a fixed-rate emitFlat burst every tick at seeded, cycling positions.
 * Short lifespan keeps the pool recycling continuously so emit stays the
 * bottleneck (not pool exhaustion).
 */
export class ParticleEmitDriver extends GameObject {
  static scriptUrl = import.meta.url;
  static components = [];

  onSpawned({ seed = 0xc0de1234 } = {}) {
    this.x = -10000;
    this.y = -10000;
    this._seed = seed >>> 0;
    this._cursor = 0;
    this._sink = 0;
    this._positions = new Float32Array(POSITION_SLOTS * 2);
    const rng = this._mulberry32(this._seed);
    for (let i = 0; i < this._positions.length; i += 2) {
      this._positions[i] = MARGIN + rng() * (WORLD_W - 2 * MARGIN);
      this._positions[i + 1] = MARGIN + rng() * (WORLD_H - 2 * MARGIN);
    }
  }

  _mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  tick() {
    const positions = this._positions;
    const cursor = this._cursor;
    const k = (cursor % POSITION_SLOTS) * 2;
    const cx = positions[k];
    const cy = positions[k + 1];

    this._sink += ParticleEmitter.emitFlat({
      count: EMIT_PER_TICK,
      x: { min: cx - 40, max: cx + 40 },
      y: { min: cy - 40, max: cy + 40 },
      vx: { min: -30, max: 30 },
      vy: { min: -30, max: 30 },
      lifespan: { min: 150, max: 400 },
      scale: { min: 0.4, max: 1 },
    });

    this._cursor = cursor + 1;
  }
}
