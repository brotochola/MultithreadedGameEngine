import { MachineBox } from '/demos/gameObjects/machineBox.js';
import { MachineWheel } from '/demos/gameObjects/machineWheel.js';
import { MachineRocket } from '/demos/gameObjects/machineRocket.js';
import { Floor } from '/demos/gameObjects/floor.js';
import { Camera } from '/src/core/Camera.js';
import WEED from '/src/index.js';
import {
  CELL,
  DEFAULT_ROCKET_ANGLE,
  PALETTE_BOX,
  PALETTE_ROCKET,
  PALETTE_WHEEL,
  WHEEL_RADIUS,
  canPlaceBox,
  canPlaceRocket,
  canPlaceWheel,
  cellKey,
  cellToWorld,
  heightsToSegments,
  parseCellKey,
  planJoints,
  snapWorld,
} from '/demos/scenes/badPiggiesGrid.js';

const { Scene, Mouse, Keyboard, Transform, RigidBody, Joint, Noise2D } = WEED;

const WALL = 150;
const TERRAIN_DX = 160;
const TERRAIN_THICK = 100;
const PAD_SAMPLES = 48;
const HILL_AMP = 900;
const MOTOR_SPEED = 1000;
const MOTOR_TORQUE = 80e8;
const MODE_EDITOR = 'editor';
const MODE_PLAY = 'play';

export class BadPiggiesScene extends Scene {
  static config = {
    worldWidth: 120000,
    worldHeight: 40000,

    spatial: {
      cellSize: 512,
      maxNeighbors: 0,
      noLimitFPS: false,
    },

    logic: { noLimitFPS: false },

    particle: {
      noLimitFPS: false,
      maxParticles: 40000,
      decals: false,
    },

    physics: {
      subStepCount: 5,
      noLimitFPS: false,
      maxJoints: 8024,
      gravity: { x: 0, y: 1800 },
      sleeping: false,
    },

    renderer: { noLimitFPS: false },

    lighting: { enabled: false },
  };

  static assets = {
    textures: {
      box: '/demos/img/box_100_100.png',
      ball: '/demos/img/bola.png',
      rocky: '/demos/img/rocky.jpg',
      smoke: '/demos/img/smoke.png',
    },
  };

  static entities = [
    [MachineBox, 1500],
    [MachineWheel, 1500],
    [MachineRocket, 1500],
    [Floor, 2024],
  ];

  constructor(game) {
    super(game);
    this.cameraPanSpeed = 12;
    this.cameraFollowX = 0;
    this.cameraFollowY = 0;
    this.mode = MODE_EDITOR;
    this.palette = PALETTE_BOX;
    this.occupancy = new Map();
    this.originX = 0;
    this.originY = 0;
    this.floorTop = 0;
    this.ghostBoxIdx = -1;
    this.ghostWheelIdx = -1;
    this.ghostRocketIdx = -1;
    this._hud = null;
    this._paletteBar = null;
    this._wheelJoints = [];
    this._padSurfaceY = 0;
    this._placeAngle = DEFAULT_ROCKET_ANGLE;
  }

  create() {
    this.spawnFloorAndWalls();

    this.floorTop = this._padSurfaceY;
    this.originX = WALL + (PAD_SAMPLES * TERRAIN_DX) * 0.5;
    this.originY = this._padSurfaceY - CELL - CELL / 2;

    this.cameraFollowX = this.originX;
    this.cameraFollowY = this.originY - CELL * 4;
    Camera.centerOn(this.cameraFollowX, this.cameraFollowY);
    Camera.setZoom(0.7);

    const ghostBox = MachineBox.spawn({ x: -9999, y: -9999, ghost: true });
    const ghostWheel = MachineWheel.spawn({ x: -9999, y: -9999, ghost: true });
    const ghostRocket = MachineRocket.spawn({ x: -9999, y: -9999, ghost: true, rotation: this._placeAngle });
    this.ghostBoxIdx = ghostBox ? ghostBox.index : -1;
    this.ghostWheelIdx = ghostWheel ? ghostWheel.index : -1;
    this.ghostRocketIdx = ghostRocket ? ghostRocket.index : -1;

    this._createPalette();
    this._createHud();
    this._refreshHud();
  }

  async destroy() {
    this._removePalette();
    this._removeHud();
    await super.destroy();
  }

  update(_dtRatio, _deltaTime) {
    if (this.mode === MODE_PLAY) this._driveMotors();
    this._panCamera();

    if (Keyboard.isPressed('1')) this.palette = PALETTE_BOX;
    if (Keyboard.isPressed('2')) this.palette = PALETTE_WHEEL;
    if (Keyboard.isPressed('3')) this.palette = PALETTE_ROCKET;

    if (Keyboard.isPressed(' ') || Keyboard.isPressed('enter')) {
      if (this.mode === MODE_EDITOR) this._enterPlay();
      else this._enterEditor();
    } else if (Keyboard.isPressed('r')) {
      if (this.mode === MODE_PLAY) this._enterEditor();
      else this._placeAngle -= Math.PI / 2;
    }

    if (this.mode === MODE_EDITOR) {
      this._editorInput();
      this._updateGhost();
    } else {
      this._hideGhosts();
    }

    this._refreshHud();
  }

  _driveMotors() {
    const kb = this.keyboard;
    let speed = 0;
    if (kb.arrowright) speed = MOTOR_SPEED;
    else if (kb.arrowleft) speed = -MOTOR_SPEED;
    for (let i = 0; i < this._wheelJoints.length; i++) {
      Joint.update(this._wheelJoints[i], {
        enableMotor: true,
        motorSpeed: speed,
        maxMotorTorque: MOTOR_TORQUE,
      });
    }
  }

  _followMachine() {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const rec of this.occupancy.values()) {
      const i = rec.boxIndex;
      sx += Transform.x[i];
      sy += Transform.y[i];
      n++;
    }
    if (!n) return false;
    this.cameraFollowX = sx / n;
    this.cameraFollowY = sy / n;
    return true;
  }

  _panCamera() {
    const panSpeed = this.cameraPanSpeed / Camera.zoom;
    const kb = this.keyboard;
    const wasd = kb.w || kb.s || kb.a || kb.d;

    if (this.mode === MODE_PLAY && this.occupancy.size && !wasd) {
      this._followMachine();
    } else {
      if (kb.w || (this.mode === MODE_EDITOR && kb.arrowup)) this.cameraFollowY -= panSpeed;
      if (kb.s || (this.mode === MODE_EDITOR && kb.arrowdown)) this.cameraFollowY += panSpeed;
      if (kb.a || (this.mode === MODE_EDITOR && kb.arrowleft)) this.cameraFollowX -= panSpeed;
      if (kb.d || (this.mode === MODE_EDITOR && kb.arrowright)) this.cameraFollowX += panSpeed;
    }

    // this.cameraFollowX = Math.max(0, Math.min(this.cameraFollowX, this.config.worldWidth));
    // this.cameraFollowY = Math.max(0, Math.min(this.cameraFollowY, this.config.worldHeight));
    Camera.follow(this.cameraFollowX, this.cameraFollowY, 0.15);

    const aimingRocket = this.mode === MODE_EDITOR && this._aimHoveredRocket();
    if (!aimingRocket) {
      const zoom = Camera.zoom * (1 - Mouse.wheel * 0.1);
      Camera.setZoom(Math.max(0.025, Math.min(3, zoom)));
    }
  }

  _editorInput() {
    if (Keyboard.isPressed('delete') || Keyboard.isPressed('backspace')) {
      const snap = snapWorld(Mouse.x, Mouse.y, this.originX, this.originY);
      this._deleteAt(snap.gx, snap.gy, this._pickKindAt(Mouse.x, Mouse.y));
    }

    if (Mouse.isButton2Down) {
      const snap = snapWorld(Mouse.x, Mouse.y, this.originX, this.originY);
      this._deleteAt(snap.gx, snap.gy, this._pickKindAt(Mouse.x, Mouse.y));
      return;
    }

    if (Mouse.isButton0Down) this._placeAtMouse();
  }

  _pickKindAt(mx, my) {
    const hit = this._pickAt(mx, my);
    return hit ? hit.kind : 'box';
  }

  _pickAt(mx, my) {
    const snap = snapWorld(mx, my, this.originX, this.originY);
    const key = cellKey(snap.gx, snap.gy);
    const rec = this.occupancy.get(key);
    if (!rec) return null;

    const dx = mx - snap.x;
    const dy = my - snap.y;
    const half = CELL * 0.5;
    const insideBox = Math.abs(dx) <= half && Math.abs(dy) <= half;
    const insideWheel =
      rec.wheelIndex >= 0 && dx * dx + dy * dy <= WHEEL_RADIUS * WHEEL_RADIUS;
    const insideRocket = rec.rocketIndex >= 0 && dx * dx + dy * dy <= CELL * CELL * 0.45;

    if (insideRocket && this.palette === PALETTE_ROCKET) {
      return { kind: 'rocket', key, gx: snap.gx, gy: snap.gy, ...rec };
    }
    if (insideWheel && this.palette === PALETTE_WHEEL) {
      return { kind: 'wheel', key, gx: snap.gx, gy: snap.gy, ...rec };
    }
    if (insideRocket && !insideBox) {
      return { kind: 'rocket', key, gx: snap.gx, gy: snap.gy, ...rec };
    }
    if (insideWheel && !insideBox) {
      return { kind: 'wheel', key, gx: snap.gx, gy: snap.gy, ...rec };
    }
    if (insideBox) {
      return { kind: 'box', key, gx: snap.gx, gy: snap.gy, ...rec };
    }
    if (insideRocket) {
      return { kind: 'rocket', key, gx: snap.gx, gy: snap.gy, ...rec };
    }
    if (insideWheel) {
      return { kind: 'wheel', key, gx: snap.gx, gy: snap.gy, ...rec };
    }
    return null;
  }

  _placeAtMouse() {
    const snap = snapWorld(Mouse.x, Mouse.y, this.originX, this.originY);
    if (!this._cellInBounds(snap.gx, snap.gy)) return;

    if (this.palette === PALETTE_BOX) {
      if (!canPlaceBox(this.occupancy, snap.gx, snap.gy)) return;
      const spawned = MachineBox.spawn({ x: snap.x, y: snap.y });
      if (!spawned) return;
      this.occupancy.set(cellKey(snap.gx, snap.gy), {
        boxIndex: spawned.index,
        wheelIndex: -1,
        rocketIndex: -1,
        rocketAngle: DEFAULT_ROCKET_ANGLE,
      });
      return;
    }

    if (this.palette === PALETTE_WHEEL) {
      if (!canPlaceWheel(this.occupancy, snap.gx, snap.gy)) return;
      const rec = this.occupancy.get(cellKey(snap.gx, snap.gy));
      const spawned = MachineWheel.spawn({ x: snap.x, y: snap.y });
      if (!spawned) return;
      rec.wheelIndex = spawned.index;
      return;
    }

    if (!canPlaceRocket(this.occupancy, snap.gx, snap.gy)) return;
    const rec = this.occupancy.get(cellKey(snap.gx, snap.gy));
    const spawned = MachineRocket.spawn({ x: snap.x, y: snap.y, rotation: this._placeAngle });
    if (!spawned) return;
    rec.rocketIndex = spawned.index;
    rec.rocketAngle = this._placeAngle;
  }

  _deleteAt(gx, gy, kind) {
    const key = cellKey(gx, gy);
    const rec = this.occupancy.get(key);
    if (!rec) return;

    if (kind === 'wheel' && rec.wheelIndex >= 0) {
      this.despawnEntity(rec.wheelIndex);
      rec.wheelIndex = -1;
      return;
    }

    if (kind === 'rocket' && rec.rocketIndex >= 0) {
      this.despawnEntity(rec.rocketIndex);
      rec.rocketIndex = -1;
      return;
    }

    if (rec.wheelIndex >= 0) this.despawnEntity(rec.wheelIndex);
    if (rec.rocketIndex >= 0) this.despawnEntity(rec.rocketIndex);
    this.despawnEntity(rec.boxIndex);
    this.occupancy.delete(key);
  }

  _snapPartsToKey(key) {
    const rec = this.occupancy.get(key);
    if (!rec) return;
    const { gx, gy } = parseCellKey(key);
    const pos = cellToWorld(gx, gy, this.originX, this.originY);
    this._moveEntity(rec.boxIndex, pos.x, pos.y, true);
    if (rec.wheelIndex >= 0) this._moveEntity(rec.wheelIndex, pos.x, pos.y, true);
    if (rec.rocketIndex >= 0) {
      this._moveEntity(rec.rocketIndex, pos.x, pos.y, false, rec.rocketAngle ?? DEFAULT_ROCKET_ANGLE);
    }
  }

  _cellInBounds(gx, gy) {
    const { x, y } = cellToWorld(gx, gy, this.originX, this.originY);
    const minX = WALL + CELL / 2;
    const maxX = this.config.worldWidth - WALL - CELL / 2;
    const minY = CELL / 2;
    const maxY = this.floorTop - CELL / 2;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  _view(index) {
    if (index < 0 || !Transform.active || !Transform.active[index]) return null;
    return this.getEntityView(index, { cache: true });
  }

  _moveEntity(index, x, y, resetPose = false, rotation = null) {
    const view = this._view(index);
    if (!view) return;
    view.setPosition(x, y);
    view.setVelocity(0, 0);
    view.angularVelocity = 0;
    if (rotation != null) view.rotation = rotation;
    else if (resetPose) view.rotation = 0;
    RigidBody.sleeping[index] = 0;
  }

  _setStatic(index, isStatic) {
    const view = this._view(index);
    if (!view) return;
    view.rigidBody.static = isStatic ? 1 : 0;
    view.setVelocity(0, 0);
    view.angularVelocity = 0;
    RigidBody.sleeping[index] = 0;
  }

  _enterPlay() {
    if (this.occupancy.size === 0) return;
    this.mode = MODE_PLAY;

    for (const [key] of this.occupancy) this._snapPartsToKey(key);

    const { welds, revolutes } = planJoints(this.occupancy, this.originX, this.originY);
    for (const w of welds) {
      Joint.addWeld({
        entityA: w.entityA,
        entityB: w.entityB,
        worldAnchorX: w.worldAnchorX,
        worldAnchorY: w.worldAnchorY,
      });
    }
    this._wheelJoints.length = 0;
    for (const r of revolutes) {
      const idx = Joint.addRevolute({
        entityA: r.entityA,
        entityB: r.entityB,
        worldAnchorX: r.worldAnchorX,
        worldAnchorY: r.worldAnchorY,
        enableMotor: true,
        motorSpeed: 0,
        maxMotorTorque: MOTOR_TORQUE,
      });
      if (idx >= 0) this._wheelJoints.push(idx);
    }

    for (const rec of this.occupancy.values()) {
      this._setStatic(rec.boxIndex, false);
      if (rec.wheelIndex >= 0) this._setStatic(rec.wheelIndex, false);
      if (rec.rocketIndex >= 0) this._setStatic(rec.rocketIndex, false);
    }
  }

  _enterEditor() {
    this.mode = MODE_EDITOR;
    this._wheelJoints.length = 0;

    for (const rec of this.occupancy.values()) {
      Joint.removeAllForEntity(rec.boxIndex);
      if (rec.wheelIndex >= 0) Joint.removeAllForEntity(rec.wheelIndex);
      if (rec.rocketIndex >= 0) Joint.removeAllForEntity(rec.rocketIndex);
    }

    for (const [key, rec] of this.occupancy) {
      this._setStatic(rec.boxIndex, true);
      if (rec.wheelIndex >= 0) this._setStatic(rec.wheelIndex, true);
      if (rec.rocketIndex >= 0) this._setStatic(rec.rocketIndex, true);
      this._snapPartsToKey(key);
    }
  }

  _updateGhost() {
    if (!Mouse.isPresent || Mouse.isButton0Down || Mouse.isButton2Down) {
      this._hideGhosts();
      return;
    }

    const snap = snapWorld(Mouse.x, Mouse.y, this.originX, this.originY);
    const valid =
      this._cellInBounds(snap.gx, snap.gy) &&
      (this.palette === PALETTE_BOX
        ? canPlaceBox(this.occupancy, snap.gx, snap.gy)
        : this.palette === PALETTE_WHEEL
          ? canPlaceWheel(this.occupancy, snap.gx, snap.gy)
          : canPlaceRocket(this.occupancy, snap.gx, snap.gy));

    const alpha = valid ? 0.4 : 0.15;
    this._placeGhost(this.ghostBoxIdx, this.palette === PALETTE_BOX ? snap.x : -9999, this.palette === PALETTE_BOX ? snap.y : -9999, this.palette === PALETTE_BOX ? alpha : 0);
    this._placeGhost(this.ghostWheelIdx, this.palette === PALETTE_WHEEL ? snap.x : -9999, this.palette === PALETTE_WHEEL ? snap.y : -9999, this.palette === PALETTE_WHEEL ? alpha : 0);
    this._placeGhost(
      this.ghostRocketIdx,
      this.palette === PALETTE_ROCKET ? snap.x : -9999,
      this.palette === PALETTE_ROCKET ? snap.y : -9999,
      this.palette === PALETTE_ROCKET ? alpha : 0,
      this._placeAngle
    );
  }

  _placeGhost(index, x, y, alpha, rotation = null) {
    const view = this._view(index);
    if (!view) return;
    view.setPosition(x, y);
    view.setAlpha(alpha);
    if (rotation != null) view.rotation = rotation;
  }

  _hideGhosts() {
    this._placeGhost(this.ghostBoxIdx, -9999, -9999, 0);
    this._placeGhost(this.ghostWheelIdx, -9999, -9999, 0);
    this._placeGhost(this.ghostRocketIdx, -9999, -9999, 0);
  }

  _aimHoveredRocket() {
    const wheel = Mouse.wheel;
    if (!wheel) return false;
    const snap = snapWorld(Mouse.x, Mouse.y, this.originX, this.originY);
    const rec = this.occupancy.get(cellKey(snap.gx, snap.gy));
    if (!rec || rec.rocketIndex < 0) return false;
    const dx = Mouse.x - snap.x;
    const dy = Mouse.y - snap.y;
    if (dx * dx + dy * dy > CELL * CELL * 0.45) return false;
    rec.rocketAngle = (rec.rocketAngle ?? DEFAULT_ROCKET_ANGLE) + wheel * 0.18;
    const view = this._view(rec.rocketIndex);
    if (view) view.rotation = rec.rocketAngle;
    return true;
  }

  _createHud() {
    const el = document.createElement('div');
    el.id = 'bad-piggies-hud';
    el.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:900;color:#fff;font:14px/1.4 sans-serif;' +
      'background:rgba(0,0,0,0.65);padding:10px 12px;border-radius:6px;pointer-events:none;white-space:pre;';
    document.body.appendChild(el);
    this._hud = el;
  }

  _refreshHud() {
    if (!this._hud) return;
    const part =
      this.palette === PALETTE_BOX ? 'box' : this.palette === PALETTE_WHEEL ? 'wheel' : 'rocket';
    this._hud.textContent =
      `Bad Piggies  |  ${this.mode === MODE_EDITOR ? 'EDITOR' : 'PLAY'}  |  part: ${part}\n` +
      `1 box  2 wheel  3 rocket  LMB paint  RMB/Del erase  Space play/edit\n` +
      (this.mode === MODE_PLAY
        ? `← → drive  ↑ thrust  WASD camera  R editor`
        : `R rotate rocket 90°  hover rocket + wheel aim  WASD camera`);
    this._refreshPalette();
  }

  _removeHud() {
    if (this._hud && this._hud.parentNode) this._hud.parentNode.removeChild(this._hud);
    this._hud = null;
  }

  _createPalette() {
    const bar = document.createElement('div');
    bar.id = 'bad-piggies-palette';
    bar.style.cssText =
      'position:fixed;left:12px;top:80px;z-index:901;display:flex;gap:8px;font:14px/1 sans-serif;';
    const tools = [
      [PALETTE_BOX, '1 Caja'],
      [PALETTE_WHEEL, '2 Rueda'],
      [PALETTE_ROCKET, '3 Cohete'],
    ];
    for (let i = 0; i < tools.length; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.tool = tools[i][0];
      btn.textContent = tools[i][1];
      btn.style.cssText =
        'padding:8px 12px;border:1px solid #888;border-radius:6px;background:#222;color:#fff;cursor:pointer;';
      btn.addEventListener('click', () => {
        this.palette = tools[i][0];
        this._refreshPalette();
      });
      bar.appendChild(btn);
    }
    document.body.appendChild(bar);
    this._paletteBar = bar;
    this._refreshPalette();
  }

  _refreshPalette() {
    if (!this._paletteBar) return;
    const buttons = this._paletteBar.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i++) {
      const on = buttons[i].dataset.tool === this.palette;
      buttons[i].style.background = on ? '#c45c12' : '#222';
      buttons[i].style.borderColor = on ? '#ffb070' : '#888';
    }
  }

  _removePalette() {
    if (this._paletteBar && this._paletteBar.parentNode) this._paletteBar.parentNode.removeChild(this._paletteBar);
    this._paletteBar = null;
  }

  spawnFloorAndWalls() {
    const worldWidth = this.config.worldWidth;
    const worldHeight = this.config.worldHeight;
    const baseY = worldHeight * 0.5;
    this._padSurfaceY = baseY;

    const x0 = WALL;
    const x1 = worldWidth - WALL;
    const count = Math.floor((x1 - x0) / TERRAIN_DX) + 1;
    const heights = new Float32Array(count);
    const noise = new Noise2D(7);
    const minY = 200;
    const maxY = worldHeight - 200;
    for (let i = 0; i < count; i++) {
      if (i < PAD_SAMPLES) {
        heights[i] = baseY;
      } else {
        const n = noise.fbm((i - PAD_SAMPLES) * 0.04, 0.5, 5, 1, 1, 2, 0.5);
        const y = baseY - n * HILL_AMP;
        heights[i] = y < minY ? minY : y > maxY ? maxY : y;
      }
    }

    const segs = heightsToSegments(heights, x0, TERRAIN_DX, TERRAIN_THICK, 1.05);
    const maxSegs = (Floor.poolSize || 1024) - 2;
    const n = segs.length < maxSegs ? segs.length : maxSegs;
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      Floor.spawn({
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
        rotation: s.rotation,
        sprite: 'rocky',
        friction: 0.9,
      });
    }

    Floor.spawn({
      x: WALL / 2,
      y: worldHeight / 2,
      width: WALL,
      height: worldHeight,
    });
    Floor.spawn({
      x: worldWidth - WALL / 2,
      y: worldHeight / 2,
      width: WALL,
      height: worldHeight,
    });
  }
}
