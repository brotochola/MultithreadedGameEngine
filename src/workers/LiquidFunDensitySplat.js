/**
 * Procedural LiquidFun density splat: instanced unit quads with soft falloff.
 * Drawn ADD into a layer density RT (no atlas). Look pass stays on the layer frag.
 */

import {
  Geometry,
  Mesh,
  Shader,
  GlProgram,
  Buffer,
  BufferUsage,
  State,
} from '../lib/pixi_8.16_.min.js';

export const LF_SPLAT_FLOATS = 7;
export const LF_SPLAT_STRIDE = LF_SPLAT_FLOATS * 4;

const VERTEX_SRC = `
in vec2 aQuad;
in vec2 aInstXY;
in float aInstRadius;
in vec4 aInstColor;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vLocal;
out vec4 vColor;

void main() {
  vec2 world = aInstXY + aQuad * aInstRadius;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  vec3 clip = mvp * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vLocal = aQuad;
  vColor = aInstColor;
}
`;

const FRAGMENT_SRC = `
precision highp float;
in vec2 vLocal;
in vec4 vColor;

void main() {
  float d2 = dot(vLocal, vLocal);
  float a = max(0.0, 1.0 - d2) * vColor.a;
  if (a < 0.001) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;

export class LiquidFunDensitySplat {
  /**
   * @param {object} opts
   * @param {number} opts.capacity
   * @param {string} [opts.label]
   * @param {string} [opts.blendMode='add']
   */
  constructor({ capacity, label, blendMode = 'add' }) {
    this.capacity = Math.max(1, capacity | 0);
    this.data = new Float32Array(this.capacity * LF_SPLAT_FLOATS);
    this.buffer = new Buffer({
      data: this.data,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      label: label || 'lf-density-splat',
    });

    // Centered unit quad in [-1, 1]
    const quad = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    const stride = LF_SPLAT_STRIDE;
    const buf = this.buffer;

    this.geometry = new Geometry({
      attributes: {
        aQuad: { buffer: quad, format: 'float32x2' },
        aInstXY: { buffer: buf, format: 'float32x2', stride, offset: 0, instance: true },
        aInstRadius: { buffer: buf, format: 'float32', stride, offset: 8, instance: true },
        aInstColor: { buffer: buf, format: 'float32x4', stride, offset: 12, instance: true },
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    this.geometry.instanceCount = 0;

    const glProgram = GlProgram.from({
      vertex: VERTEX_SRC,
      fragment: FRAGMENT_SRC,
      name: label || 'lf-density-splat',
    });

    this.shader = new Shader({ glProgram, resources: {} });

    const state = new State();
    state.blend = true;
    state.blendMode = blendMode || 'add';
    state.depthTest = false;
    state.depthMask = false;
    state.culling = false;

    this.mesh = new Mesh({
      geometry: this.geometry,
      shader: this.shader,
      state,
    });
    this.mesh.label = label || 'lf-density-splat';
    this.mesh.blendMode = blendMode || 'add';
    this.mesh.visible = false;
  }

  /**
   * Pack LiquidFun pose into instance buffer (screen-space for RT).
   * @param {object} views - LiquidFun.getViews()
   * @param {object} opts
   * @param {number} opts.layerId
   * @param {number} opts.zoom
   * @param {number} opts.cameraX
   * @param {number} opts.cameraY
   * @param {number} [opts.resolution=1]
   * @param {number} opts.radius - world-space kernel radius
   * @param {number} [opts.intensity=1]
   * @param {boolean} [opts.useParticleTint=true]
   * @param {number} [opts.canvasW]
   * @param {number} [opts.canvasH]
   */
  upload(views, opts = {}) {
    if (!views?.count || !views.x || !views.y) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return 0;
    }

    const count = views.count[0] | 0;
    if (count <= 0) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return 0;
    }

    const zoom = opts.zoom ?? 1;
    const cameraX = opts.cameraX ?? 0;
    const cameraY = opts.cameraY ?? 0;
    const resolution = opts.resolution ?? 1;
    const screenScale = zoom * resolution;
    const worldRadius = opts.radius > 0 ? opts.radius : 48;
    const screenRadius = worldRadius * screenScale;
    const intensity = opts.intensity ?? 1;
    const useTint = opts.useParticleTint !== false;
    const layerId = opts.layerId | 0;
    const xArr = views.x;
    const yArr = views.y;
    const tintArr = views.tint;
    const baseAlpha = views.baseAlpha;
    const alphaArr = views.alpha;
    const layerArr = views.layerId;
    const canvasW = opts.canvasW > 0 ? opts.canvasW : 0;
    const canvasH = opts.canvasH > 0 ? opts.canvasH : 0;
    const cull = canvasW > 0 && canvasH > 0;
    const pad = screenRadius;
    const data = this.data;

    let out = 0;
    let base = 0;
    const maxOut = this.capacity;
    const n = count > views.maxCount ? views.maxCount : count;

    for (let i = 0; i < n; i++) {
      if (layerArr && (layerArr[i] | 0) !== layerId) continue;

      const sx = (xArr[i] - cameraX) * screenScale;
      const sy = (yArr[i] - cameraY) * screenScale;
      if (cull) {
        if (sx < -pad || sy < -pad || sx > canvasW * resolution + pad || sy > canvasH * resolution + pad) {
          continue;
        }
      }
      if (out >= maxOut) break;

      let r = 1;
      let g = 1;
      let b = 1;
      if (useTint && tintArr) {
        const tint = tintArr[i] >>> 0;
        if (tint) {
          r = ((tint >> 16) & 0xff) / 255;
          g = ((tint >> 8) & 0xff) / 255;
          b = (tint & 0xff) / 255;
        }
      }

      let a = intensity;
      if (baseAlpha) a *= baseAlpha[i];
      if (alphaArr) a *= alphaArr[i];

      data[base] = sx;
      data[base + 1] = sy;
      data[base + 2] = screenRadius;
      data[base + 3] = r;
      data[base + 4] = g;
      data[base + 5] = b;
      data[base + 6] = a;
      base += LF_SPLAT_FLOATS;
      out++;
    }

    if (out <= 0) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return 0;
    }

    this.buffer.update(this.data.subarray(0, out * LF_SPLAT_FLOATS));
    this.geometry.instanceCount = out;
    this.mesh.visible = true;
    return out;
  }

  destroy() {
    this.mesh?.destroy({ children: true });
    this.geometry = null;
    this.shader = null;
    this.mesh = null;
    this.buffer = null;
    this.data = null;
  }
}
