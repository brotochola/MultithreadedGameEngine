/**
 * Shared SoA → one instanced Mesh upload for ENTITIES / cast shadows / custom layers.
 * Pixi v8 Geometry + Shader + Mesh.
 * Atlas is PMA-on-upload (Pixi ImageSource default). Fragment must:
 *   - scale rgb by instance alpha (vColor.a) so soft particles / smoke fade
 *   - NOT multiply by tex.a again (tex.rgb already has it) — that darkens trails
 * blendMode 'normal' expects PMA (ONE, ONE_MINUS_SRC_ALPHA).
 *
 * GPU record stays interleaved AoS (vertex fetch). CPU pack is compact: LUT
 * size/uv/trim and tint unpack live in the vertex shader (texelFetch uTexLut).
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
  TextureSource,
} from '../lib/pixi_8.16_.min.js';

import { DECORATION_Y_SORT_SCALE, ENTITY_GLOW_SORT_BIAS } from '../core/ConfigDefaults.js';

/** Compact instance floats: xy, scale, anchor, rotCS, depth, packedARGB, texId, tileInv. */
export const INSTANCED_SPRITE_FLOATS = 13;
export const INSTANCED_SPRITE_STRIDE = INSTANCED_SPRITE_FLOATS * 4;

const Y_SORT_K = DECORATION_Y_SORT_SCALE;
const GLOW_BIAS = ENTITY_GLOW_SORT_BIAS;

const VERTEX_SRC = `
in vec2 aQuad;
in vec2 aInstXY;
in vec2 aInstScale;
in vec2 aInstAnchor;
in vec2 aInstRotCS;
in float aInstDepth;
in float aInstTintBits;
in float aInstTexId;
in vec2 aInstTileInv;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform sampler2D uTexLut;

out vec2 vLocal;
out vec4 vColor;
out vec2 vWorld;
out vec4 vAtlasUV;
out vec2 vTileInv;

void main() {
  int tid = int(aInstTexId + 0.5);
  ivec2 lutSize = textureSize(uTexLut, 0);
  vec2 aInstSize = vec2(0.0);
  vec4 aInstUV = vec4(0.0);
  vec4 aInstTrim = vec4(0.0);
  if (tid >= 0 && tid < lutSize.y) {
    vec4 t0 = texelFetch(uTexLut, ivec2(0, tid), 0);
    vec4 t1 = texelFetch(uTexLut, ivec2(1, tid), 0);
    vec4 t2 = texelFetch(uTexLut, ivec2(2, tid), 0);
    aInstSize = t0.xy;
    aInstUV = vec4(t0.zw, t1.xy);
    aInstTrim = vec4(t1.zw, t2.xy);
  }

  uint tintBits = floatBitsToUint(aInstTintBits);
  vec3 rgb = vec3(
    float((tintBits >> 16u) & 255u),
    float((tintBits >> 8u) & 255u),
    float(tintBits & 255u)
  ) / 255.0;
  float instA = float((tintBits >> 24u) & 255u) / 255.0;

  vec2 content = aInstTrim.xy + aQuad * aInstTrim.zw;
  vec2 local = (content - aInstAnchor * aInstSize) * aInstScale;
  float c = aInstRotCS.x;
  float s = aInstRotCS.y;
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 world = rotated + aInstXY;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  vec3 clip = mvp * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, aInstDepth, 1.0);
  vLocal = aQuad;
  vColor = vec4(rgb, instA);
  vWorld = world;
  vAtlasUV = aInstUV;
  vTileInv = aInstTileInv;
}
`;

/** Sample atlas rect; optional world-space fract tile (repeatX/Y). */
function tiledSamplePrelude() {
  return `
vec2 weedUv() {
  vec2 t = vLocal;
  if (vTileInv.x > 0.0) t.x = fract(vWorld.x * vTileInv.x);
  if (vTileInv.y > 0.0) t.y = fract(vWorld.y * vTileInv.y);
  return mix(vAtlasUV.xy, vAtlasUV.zw, t);
}
`;
}

/** Pixi GlProgram only injects GLSL 300 if the fragment contains this string. */
const GLSL300 = '#version 300 es';

/** Normal + depth-write: discard clear atlas texels so they do not punch Z. */
const FRAGMENT_SRC = `
${GLSL300}
precision highp float;
in vec2 vLocal;
in vec4 vColor;
in vec2 vWorld;
in vec4 vAtlasUV;
in vec2 vTileInv;
uniform sampler2D uTexture;
out vec4 finalColor;

${tiledSamplePrelude()}

void main() {
  vec4 t = texture(uTexture, weedUv());
  float a = t.a * vColor.a;
  if (a < 0.01) discard;
  finalColor = vec4(t.rgb * vColor.rgb * vColor.a, a);
}
`;

/** Soft particles (no Z write): PMA blend only — no discard (ParticleContainer-style fill). */
const FRAGMENT_SRC_BLEND = `
${GLSL300}
precision highp float;
in vec2 vLocal;
in vec4 vColor;
in vec2 vWorld;
in vec4 vAtlasUV;
in vec2 vTileInv;
uniform sampler2D uTexture;
out vec4 finalColor;

${tiledSamplePrelude()}

void main() {
  vec4 t = texture(uTexture, weedUv());
  float a = t.a * vColor.a;
  finalColor = vec4(t.rgb * vColor.rgb * vColor.a, a);
}
`;

/** Additive glows: same rgb scale, alpha 0 so ADD (ONE,ONE) never darkens. */
const FRAGMENT_SRC_ADDITIVE = `
${GLSL300}
precision highp float;
in vec2 vLocal;
in vec4 vColor;
in vec2 vWorld;
in vec4 vAtlasUV;
in vec2 vTileInv;
uniform sampler2D uTexture;
out vec4 finalColor;

${tiledSamplePrelude()}

void main() {
  vec4 t = texture(uTexture, weedUv());
  finalColor = vec4(t.rgb * vColor.rgb * vColor.a, 0.0);
}
`;

/**
 * Per-textureId LUT: origW, origH, u0, v0, u1, v1, trimX, trimY, trimW, trimH
 */
export const TEX_LUT_FLOATS = 10;
/** RGBA32F texels per LUT row (12 floats; last two unused). */
export const TEX_LUT_RGBA_WIDTH = 3;

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

/** Pack CPU LUT (10 floats/id) into RGBA32F rows for vertex texelFetch. */
export function packTextureLutRgba(lut, count) {
  const n = Math.max(1, count | 0);
  const out = new Float32Array(n * TEX_LUT_RGBA_WIDTH * 4);
  const srcN = lut ? (lut.length / TEX_LUT_FLOATS) | 0 : 0;
  for (let i = 0; i < n; i++) {
    const dst = i * 12;
    if (i < srcN) {
      const s = i * TEX_LUT_FLOATS;
      out[dst] = lut[s];
      out[dst + 1] = lut[s + 1];
      out[dst + 2] = lut[s + 2];
      out[dst + 3] = lut[s + 3];
      out[dst + 4] = lut[s + 4];
      out[dst + 5] = lut[s + 5];
      out[dst + 6] = lut[s + 6];
      out[dst + 7] = lut[s + 7];
      out[dst + 8] = lut[s + 8];
      out[dst + 9] = lut[s + 9];
    }
  }
  return out;
}

let _dummyLutSource = null;
function dummyLutSource() {
  if (_dummyLutSource) return _dummyLutSource;
  _dummyLutSource = TextureSource.from({
    resource: packTextureLutRgba(null, 1),
    width: TEX_LUT_RGBA_WIDTH,
    height: 1,
    format: 'rgba32float',
    scaleMode: 'nearest',
    addressMode: 'clamp-to-edge',
    autoGenerateMipmaps: false,
  });
  return _dummyLutSource;
}

export class InstancedSpriteBatch {
  /**
   * @param {object} opts
   * @param {number} opts.capacity
   * @param {string} opts.label
   * @param {import('../lib/pixi_8.16_.min.js').TextureSource} opts.atlasSource
   * @param {boolean} [opts.depthTest=true]
   * @param {boolean} [opts.depthMask=true] - false → test Z (Y-sort) without writing (soft particles)
   * @param {boolean} [opts.alphaDiscard=true] - false → blend-only fragment (no discard; soft particles)
   * @param {boolean} [opts.premultiplyAlpha=true] - true → normal PMA out; false → additive (glows)
   * @param {string} [opts.blendMode='normal'] - Pixi State blend mode
   */
  constructor({
    capacity,
    label,
    atlasSource,
    depthTest = true,
    depthMask = true,
    alphaDiscard = true,
    premultiplyAlpha = true,
    blendMode = 'normal',
    lutSource = null,
  }) {
    this.capacity = Math.max(1, capacity | 0);
    this.data = new Float32Array(this.capacity * INSTANCED_SPRITE_FLOATS);
    this.dataU32 = new Uint32Array(this.data.buffer);
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
        aInstAnchor: { buffer: buf, format: 'float32x2', stride, offset: 16, instance: true },
        aInstRotCS: { buffer: buf, format: 'float32x2', stride, offset: 24, instance: true },
        aInstDepth: { buffer: buf, format: 'float32', stride, offset: 32, instance: true },
        aInstTintBits: { buffer: buf, format: 'float32', stride, offset: 36, instance: true },
        aInstTexId: { buffer: buf, format: 'float32', stride, offset: 40, instance: true },
        aInstTileInv: { buffer: buf, format: 'float32x2', stride, offset: 44, instance: true },
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    this.geometry.instanceCount = 0;

    let fragment = FRAGMENT_SRC_ADDITIVE;
    if (premultiplyAlpha) {
      fragment = alphaDiscard !== false ? FRAGMENT_SRC : FRAGMENT_SRC_BLEND;
    }
    const glProgram = GlProgram.from({
      vertex: VERTEX_SRC,
      fragment,
      name: label || 'instanced-sprites',
    });

    this.shader = new Shader({
      glProgram,
      resources: {
        uTexture: atlasSource || Texture.WHITE.source,
        uTexLut: lutSource || dummyLutSource(),
      },
    });

    const state = new State();
    state.blend = true;
    state.blendMode = blendMode || 'normal';
    state.depthTest = !!depthTest;
    state.depthMask = depthMask !== false;
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

  setLutSource(source) {
    if (source) this.shader.resources.uTexLut = source;
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
   * @param {'index'|'sortKey'} [opts.depthMode='index']
   * @param {number} [opts.worldHeight=1]
   * @param {Float32Array|null} [opts.sortKey] - composite collector keys (depthMode sortKey)
   * @param {Float32Array|null} [opts.texLut] - unused (LUT is a vertex texture); kept for callers
   * @param {number} [opts.texLutCount=0]
   * @param {Array|null} [opts.textures]
   * @param {Uint8Array|null} [opts.type] - render queue type (filter)
   * @param {number} [opts.includeType] - only pack this type (e.g. 3 = light glow)
   * @param {number|number[]} [opts.excludeType] - skip this type / these types
   * @param {Uint16Array|null} [opts.indices] - compact source indices (skips type filter)
   * @param {number} [opts.indexCount]
   */
  upload(q, opts = {}) {
    const count = q.count | 0;
    const indices = opts.indices;
    const indexCount = opts.indexCount | 0;
    const useIndices = indices != null;
    if ((!useIndices && count <= 0) || (useIndices && indexCount <= 0)) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return 0;
    }

    const data = this.data;
    const dataU32 = this.dataU32;
    const space = opts.space || 'world';
    const zoom = opts.zoom ?? 1;
    const cameraX = opts.cameraX ?? 0;
    const cameraY = opts.cameraY ?? 0;
    const resolution = opts.resolution ?? 1;
    const depthMode = opts.depthMode || 'index';
    const worldHeight = opts.worldHeight > 0 ? opts.worldHeight : 1;
    const typeArr = opts.type || null;
    const sortKeyArr = opts.sortKey || null;
    const includeType = opts.includeType;
    const excludeRaw = opts.excludeType;
    const excludeList =
      excludeRaw == null ? null : typeof excludeRaw === 'number' ? [excludeRaw] : excludeRaw;
    const filterTypes = !useIndices && typeArr && (includeType !== undefined || excludeList);
    const depthDenom = (opts.depthDenom || this.capacity) + 1;
    const sortKeyMax = worldHeight * Y_SORT_K + GLOW_BIAS + 1;

    const rqX = q.x;
    const rqY = q.y;
    const rqScaleX = q.scaleX;
    const rqScaleY = q.scaleY;
    const rqRotC = q.rotC;
    const rqRotS = q.rotS;
    const rqAlpha = q.alpha;
    const rqTint = q.tint;
    const rqTextureId = q.textureId;
    const rqAnchorX = q.anchorX;
    const rqAnchorY = q.anchorY;
    const rqRepeatX = q.repeatX;
    const rqRepeatY = q.repeatY;

    const screenScale = zoom * resolution;
    const useScreen = space === 'screen';
    const useSortKey = depthMode === 'sortKey' && sortKeyArr;
    if (!useIndices && includeType !== undefined && !typeArr) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return 0;
    }
    const scanCount = useIndices
      ? indexCount
      : count > this.capacity && !filterTypes
        ? this.capacity
        : count;
    let base = 0;
    let out = 0;
    for (let k = 0; k < scanCount; k++) {
      const i = useIndices ? indices[k] : k;
      if (filterTypes) {
        const t = typeArr[i];
        if (includeType !== undefined && t !== includeType) continue;
        if (excludeList) {
          let skip = false;
          for (let e = 0; e < excludeList.length; e++) {
            if (t === excludeList[e]) {
              skip = true;
              break;
            }
          }
          if (skip) continue;
        }
      }
      if (out >= this.capacity) break;

      const worldY = rqY[i];
      let x = rqX[i];
      let y = worldY;
      let sx = rqScaleX[i];
      let sy = rqScaleY[i];
      if (useScreen) {
        x = (x - cameraX) * screenScale;
        y = (y - cameraY) * screenScale;
        sx *= screenScale;
        sy *= screenScale;
      }

      let depth;
      if (useSortKey) {
        depth = 1.0 - sortKeyArr[i] / sortKeyMax;
        depth -= (out + 1) * 1e-7;
      } else {
        depth = 1.0 - (out + 1) / depthDenom;
      }

      let a = rqAlpha[i];
      if (a < 0) a = 0;
      else if (a > 1) a = 1;
      const a8 = (a * 255 + 0.5) | 0;
      const packed = ((a8 & 255) << 24) | (rqTint[i] & 0xffffff);

      const rx = rqRepeatX ? rqRepeatX[i] : 0;
      const ry = rqRepeatY ? rqRepeatY[i] : 0;
      data[base] = x;
      data[base + 1] = y;
      data[base + 2] = sx;
      data[base + 3] = sy;
      data[base + 4] = rqAnchorX[i];
      data[base + 5] = rqAnchorY[i];
      data[base + 6] = rqRotC[i];
      data[base + 7] = rqRotS[i];
      data[base + 8] = depth;
      dataU32[base + 9] = packed >>> 0;
      data[base + 10] = rqTextureId[i];
      data[base + 11] = rx > 0 ? 1 / rx : 0;
      data[base + 12] = ry > 0 ? 1 / ry : 0;
      base += INSTANCED_SPRITE_FLOATS;
      out++;
    }

    if (out <= 0) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return 0;
    }

    this.mesh.visible = true;
    this.buffer.update(out * INSTANCED_SPRITE_STRIDE);
    this.geometry.instanceCount = out;
    return out;
  }
}
