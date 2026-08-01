/**
 * Shared SoA → one instanced Mesh upload for ENTITIES / cast shadows / custom layers.
 * Pixi v8 Geometry + Shader + Mesh.
 * Atlas is PMA-on-upload (Pixi ImageSource default); fragment must NOT rgb*a again —
 * that double-premultiplies and turns soft white fades (bullet trails) dark/gray.
 * blendMode 'normal' expects PMA (ONE, ONE_MINUS_SRC_ALPHA).
 */

import {
  Geometry,
  Mesh,
  Shader,
  GlProgram,
  Buffer,
  BufferUsage,
  State,
  Texture,
} from '../lib/pixi_8.16_.min.js';

import { DECORATION_Y_SORT_SCALE, ENTITY_GLOW_SORT_BIAS } from '../core/ConfigDefaults.js';

export const INSTANCED_SPRITE_FLOATS = 22;
export const INSTANCED_SPRITE_STRIDE = INSTANCED_SPRITE_FLOATS * 4;

const Y_SORT_K = DECORATION_Y_SORT_SCALE;
const GLOW_BIAS = ENTITY_GLOW_SORT_BIAS;

const VERTEX_SRC = `
in vec2 aQuad;
in vec2 aInstXY;
in vec2 aInstScale;
in vec2 aInstSize;
in vec2 aInstAnchor;
in float aInstRot;
in float aInstDepth;
in vec4 aInstUV;
in vec4 aInstColor;
in vec4 aInstTrim;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vUV;
out vec4 vColor;

void main() {
  vec2 content = aInstTrim.xy + aQuad * aInstTrim.zw;
  vec2 local = (content - aInstAnchor * aInstSize) * aInstScale;
  float c = cos(aInstRot);
  float s = sin(aInstRot);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 world = rotated + aInstXY;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  vec3 clip = mvp * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, aInstDepth, 1.0);
  vUV = mix(aInstUV.xy, aInstUV.zw, aQuad);
  vColor = aInstColor;
}
`;

/** Normal: texture already PMA from upload; texture*vColor applies tint + instance alpha. */
const FRAGMENT_SRC = `
precision highp float;
in vec2 vUV;
in vec4 vColor;
uniform sampler2D uTexture;

void main() {
  vec4 c = texture2D(uTexture, vUV) * vColor;
  gl_FragColor = c;
}
`;

/** Additive glows: PMA rgb, alpha 0 so ADD (ONE,ONE) never darkens. */
const FRAGMENT_SRC_ADDITIVE = `
precision highp float;
in vec2 vUV;
in vec4 vColor;
uniform sampler2D uTexture;

void main() {
  vec4 c = texture2D(uTexture, vUV) * vColor;
  gl_FragColor = vec4(c.rgb, 0.0);
}
`;

/**
 * Per-textureId LUT: origW, origH, u0, v0, u1, v1, trimX, trimY, trimW, trimH
 */
export const TEX_LUT_FLOATS = 10;

function writeLutSlot(lut, base, tex) {
  if (typeof tex.updateUvs === 'function') tex.updateUvs();
  const orig = tex.orig;
  const origW = (orig && orig.width) || tex.width || 0;
  const origH = (orig && orig.height) || tex.height || 0;
  const uvs = tex.uvs;
  const trim = tex.trim;
  // Guard: Pixi sometimes leaves raw frame pixels in uvs before source size is known
  const srcW = tex.source?.width || tex.frame?.width || 1;
  const srcH = tex.source?.height || tex.frame?.height || 1;
  let u0 = uvs.x0;
  let v0 = uvs.y0;
  let u1 = uvs.x2;
  let v1 = uvs.y2;
  if (u1 > 1.5 || v1 > 1.5 || u0 > 1.5 || v0 > 1.5) {
    u0 = uvs.x0 / srcW;
    v0 = uvs.y0 / srcH;
    u1 = uvs.x2 / srcW;
    v1 = uvs.y2 / srcH;
  }
  lut[base] = origW;
  lut[base + 1] = origH;
  lut[base + 2] = u0;
  lut[base + 3] = v0;
  lut[base + 4] = u1;
  lut[base + 5] = v1;
  if (trim) {
    lut[base + 6] = trim.x;
    lut[base + 7] = trim.y;
    lut[base + 8] = trim.width;
    lut[base + 9] = trim.height;
  } else {
    lut[base + 6] = 0;
    lut[base + 7] = 0;
    lut[base + 8] = origW;
    lut[base + 9] = origH;
  }
}

export function buildTextureLut(flatTextures, fallbackTexture) {
  const n = flatTextures?.length || 0;
  const lut = new Float32Array(Math.max(1, n) * TEX_LUT_FLOATS);
  const fb = fallbackTexture || Texture.WHITE;
  for (let i = 0; i < n; i++) {
    writeLutSlot(lut, i * TEX_LUT_FLOATS, flatTextures[i] || fb);
  }
  if (n === 0) writeLutSlot(lut, 0, fb);
  return lut;
}

export class InstancedSpriteBatch {
  /**
   * @param {object} opts
   * @param {number} opts.capacity
   * @param {string} opts.label
   * @param {import('../lib/pixi_8.16_.min.js').TextureSource} opts.atlasSource
   * @param {boolean} [opts.depthTest=true]
   * @param {boolean} [opts.premultiplyAlpha=true] - true → normal PMA out; false → additive (glows)
   * @param {string} [opts.blendMode='normal'] - Pixi State blend mode
   */
  constructor({ capacity, label, atlasSource, depthTest = true, premultiplyAlpha = true, blendMode = 'normal' }) {
    this.capacity = Math.max(1, capacity | 0);
    this.data = new Float32Array(this.capacity * INSTANCED_SPRITE_FLOATS);
    this.buffer = new Buffer({
      data: this.data,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      label: label || 'instanced-sprites',
    });

    const quad = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const stride = INSTANCED_SPRITE_STRIDE;
    const buf = this.buffer;

    this.geometry = new Geometry({
      attributes: {
        aQuad: { buffer: quad, format: 'float32x2' },
        aInstXY: { buffer: buf, format: 'float32x2', stride, offset: 0, instance: true },
        aInstScale: { buffer: buf, format: 'float32x2', stride, offset: 8, instance: true },
        aInstSize: { buffer: buf, format: 'float32x2', stride, offset: 16, instance: true },
        aInstAnchor: { buffer: buf, format: 'float32x2', stride, offset: 24, instance: true },
        aInstRot: { buffer: buf, format: 'float32', stride, offset: 32, instance: true },
        aInstDepth: { buffer: buf, format: 'float32', stride, offset: 36, instance: true },
        aInstUV: { buffer: buf, format: 'float32x4', stride, offset: 40, instance: true },
        aInstColor: { buffer: buf, format: 'float32x4', stride, offset: 56, instance: true },
        aInstTrim: { buffer: buf, format: 'float32x4', stride, offset: 72, instance: true },
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    this.geometry.instanceCount = 0;

    const glProgram = GlProgram.from({
      vertex: VERTEX_SRC,
      fragment: premultiplyAlpha ? FRAGMENT_SRC : FRAGMENT_SRC_ADDITIVE,
      name: label || 'instanced-sprites',
    });

    this.shader = new Shader({
      glProgram,
      resources: {
        uTexture: atlasSource || Texture.WHITE.source,
      },
    });

    const state = new State();
    state.blend = true;
    state.blendMode = blendMode || 'normal';
    state.depthTest = !!depthTest;
    state.culling = false;

    this.mesh = new Mesh({
      geometry: this.geometry,
      shader: this.shader,
      state,
      label: label || 'instanced-sprites',
    });
    this.mesh.blendMode = state.blendMode;
    this.mesh.visible = false;
    this.mesh.cullable = false; // bounds ignore instance attrs; don't frustum-cull the batch
  }

  setAtlasSource(source) {
    if (source) this.shader.resources.uTexture = source;
  }

  /**
   * Upload SoA views into instance buffer.
   * @param {object} q - typed array views + count
   * @param {object} opts
   * @param {'world'|'screen'} [opts.space='world']
   * @param {number} [opts.zoom=1]
   * @param {number} [opts.cameraX=0]
   * @param {number} [opts.cameraY=0]
   * @param {number} [opts.resolution=1] - RT scale (shadows/custom shader layers)
   * @param {'index'|'worldY'} [opts.depthMode='index']
   * @param {number} [opts.worldHeight=1]
   * @param {Float32Array|null} [opts.texLut]
   * @param {number} [opts.texLutCount=0]
   * @param {Array|null} [opts.textures] - flatTextures fallback when LUT miss / absent
   * @param {Uint8Array|null} [opts.type] - render queue type (filter + worldY glow bias)
   * @param {number} [opts.includeType] - only pack this type (e.g. 3 = light glow)
   * @param {number} [opts.excludeType] - skip this type (e.g. 3 when packing ENTITIES)
   */
  upload(q, opts = {}) {
    const count = q.count | 0;
    if (count <= 0) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return 0;
    }

    const data = this.data;
    const space = opts.space || 'world';
    const zoom = opts.zoom ?? 1;
    const cameraX = opts.cameraX ?? 0;
    const cameraY = opts.cameraY ?? 0;
    const resolution = opts.resolution ?? 1;
    const depthMode = opts.depthMode || 'index';
    const worldHeight = opts.worldHeight > 0 ? opts.worldHeight : 1;
    const texLut = opts.texLut;
    const texLutCount = opts.texLutCount | 0;
    const textures = opts.textures || null;
    const typeArr = opts.type || null;
    const includeType = opts.includeType;
    const excludeType = opts.excludeType;
    const filterTypes = typeArr && (includeType !== undefined || excludeType !== undefined);
    const depthDenom = (opts.depthDenom || this.capacity) + 1;
    const sortKeyMax = worldHeight * Y_SORT_K + GLOW_BIAS + 1;

    const rqX = q.x;
    const rqY = q.y;
    const rqScaleX = q.scaleX;
    const rqScaleY = q.scaleY;
    const rqRotation = q.rotation;
    const rqAlpha = q.alpha;
    const rqTint = q.tint;
    const rqTextureId = q.textureId;
    const rqAnchorX = q.anchorX;
    const rqAnchorY = q.anchorY;

    const screenScale = zoom * resolution;
    const hasLut = texLut && texLutCount > 0;
    // Without type[] cannot filter: includeType → empty; excludeType → draw all
    if (includeType !== undefined && !typeArr) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return 0;
    }
    const scanCount = count > this.capacity && !filterTypes ? this.capacity : count;
    let base = 0;
    let out = 0;
    for (let i = 0; i < scanCount; i++) {
      if (filterTypes) {
        const t = typeArr[i];
        if (includeType !== undefined && t !== includeType) continue;
        if (excludeType !== undefined && t === excludeType) continue;
      }
      if (out >= this.capacity) break;

      const texId = rqTextureId[i];
      let ow = 0;
      let oh = 0;
      let u0 = 0;
      let v0 = 0;
      let u1 = 0;
      let v1 = 0;
      let trimX = 0;
      let trimY = 0;
      let trimW = 0;
      let trimH = 0;

      if (hasLut && texId >= 0 && texId < texLutCount) {
        const lutBase = texId * TEX_LUT_FLOATS;
        ow = texLut[lutBase];
        oh = texLut[lutBase + 1];
        u0 = texLut[lutBase + 2];
        v0 = texLut[lutBase + 3];
        u1 = texLut[lutBase + 4];
        v1 = texLut[lutBase + 5];
        trimX = texLut[lutBase + 6];
        trimY = texLut[lutBase + 7];
        trimW = texLut[lutBase + 8];
        trimH = texLut[lutBase + 9];
      } else if (textures && texId >= 0 && texId < textures.length) {
        const tex = textures[texId];
        if (tex) {
          const orig = tex.orig;
          ow = (orig && orig.width) || tex.width || 0;
          oh = (orig && orig.height) || tex.height || 0;
          const uvs = tex.uvs;
          u0 = uvs.x0;
          v0 = uvs.y0;
          u1 = uvs.x2;
          v1 = uvs.y2;
          const trim = tex.trim;
          if (trim) {
            trimX = trim.x;
            trimY = trim.y;
            trimW = trim.width;
            trimH = trim.height;
          } else {
            trimW = ow;
            trimH = oh;
          }
        }
      }
      // invalid / missing textureId → zero-size instance (never map to LUT slot 0 / _empty)

      const worldY = rqY[i];
      let x = rqX[i];
      let y = worldY;
      let sx = rqScaleX[i];
      let sy = rqScaleY[i];
      if (space === 'screen') {
        x = (x - cameraX) * screenScale;
        y = (y - cameraY) * screenScale;
        sx *= screenScale;
        sy *= screenScale;
      }

      let depth;
      if (depthMode === 'worldY') {
        let sortKey = worldY * Y_SORT_K;
        if (typeArr && typeArr[i] === 3) sortKey += GLOW_BIAS;
        else if (typeArr && typeArr[i] === 5) sortKey -= 1;
        depth = 1.0 - sortKey / sortKeyMax;
        depth -= (out + 1) * 1e-7;
      } else {
        depth = 1.0 - (out + 1) / depthDenom;
      }

      const tint = rqTint[i] >>> 0;
      data[base] = x;
      data[base + 1] = y;
      data[base + 2] = sx;
      data[base + 3] = sy;
      data[base + 4] = ow;
      data[base + 5] = oh;
      data[base + 6] = rqAnchorX[i];
      data[base + 7] = rqAnchorY[i];
      data[base + 8] = rqRotation[i];
      data[base + 9] = depth;
      data[base + 10] = u0;
      data[base + 11] = v0;
      data[base + 12] = u1;
      data[base + 13] = v1;
      data[base + 14] = ((tint >> 16) & 0xff) / 255;
      data[base + 15] = ((tint >> 8) & 0xff) / 255;
      data[base + 16] = (tint & 0xff) / 255;
      data[base + 17] = rqAlpha[i];
      data[base + 18] = trimX;
      data[base + 19] = trimY;
      data[base + 20] = trimW;
      data[base + 21] = trimH;
      base += INSTANCED_SPRITE_FLOATS;
      out++;
    }

    if (out <= 0) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return 0;
    }

    this.mesh.visible = true;
    this.buffer.update();
    this.geometry.instanceCount = out;
    return out;
  }
}
