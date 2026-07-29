// PerformancePanel.js — Worker stats table, FPS, entity counts, audio metrics

import { createPanel, createStat } from '../ui/DebugDOM.js';
import { formatNumber } from '../../utils.js';
import { DecorationPool } from '../../DecorationPool.js';
import {
  RENDERER_STATS,
  PARTICLE_STATS,
  PHYSICS_STATS,
  SPATIAL_STATS,
  LOGIC_STATS,
  PRE_RENDER_STATS,
  WORKER_DISPLAY_CONFIG,
  WORKER_ROW_ORDER,
} from '../stats/StatsCollector.js';

const COMMON_KEYS = ['STEP_MS', 'FPS', 'MSG_MS'];
const SCHEMA_BY_TYPE = {
  renderer: RENDERER_STATS,
  particle: PARTICLE_STATS,
  physics: PHYSICS_STATS,
  spatial: SPATIAL_STATS,
  logic: LOGIC_STATS,
  preRender: PRE_RENDER_STATS,
};

function fmtMs(v) {
  return v == null || Number.isNaN(v) ? '—' : v.toFixed(2) + ' ms';
}

function fmtFps(v) {
  return v == null || Number.isNaN(v) ? '—' : v.toFixed(1);
}

export class PerformancePanel {
  constructor(debugUI) {
    this.debugUI = debugUI;
    this.elements = {};
    this.panel = null;
  }

  // ------- DOM creation -------

  create() {
    this.panel = createPanel();

    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-direction:column;gap:12px';

    // Summary section
    const summary = document.createElement('div');
    summary.className = 'debug-ui-performance-summary';
    summary.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px;background:rgba(0,0,0,0.3);border-radius:4px';

    const poolRow = document.createElement('div');
    poolRow.className = 'debug-ui-row';
    poolRow.style.cssText = 'justify-content:flex-start;gap:16px;flex-wrap:wrap';

    const poolTitle = document.createElement('span');
    poolTitle.className = 'debug-ui-stat';
    poolTitle.style.cssText = 'font-weight:bold;color:rgba(255,255,255,0.9)';
    poolTitle.textContent = 'Pools:';
    poolRow.appendChild(poolTitle);

    this.elements.perfGameObjects = this._colorStat('#4ade80', 'Game objects: -- / -- (👁 --)');
    poolRow.appendChild(this.elements.perfGameObjects);

    this.elements.perfParticles = this._colorStat('#fb923c', 'Particles: -- / -- (👁 --)');
    poolRow.appendChild(this.elements.perfParticles);

    this.elements.perfDecorations = this._colorStat('#34d399', 'Decorations: -- / -- (👁 --)');
    poolRow.appendChild(this.elements.perfDecorations);

    this.elements.perfFlash = this._colorStat('#fbbf24', 'Flash: --');
    poolRow.appendChild(this.elements.perfFlash);

    summary.appendChild(poolRow);
    container.appendChild(summary);

    // Job stealing row (hidden by default)
    const jobRow = document.createElement('div');
    jobRow.className = 'debug-ui-row';
    this.elements.jobStealing = createStat('Jobs: --', 'jobs');
    jobRow.appendChild(this.elements.jobStealing);
    jobRow.style.display = 'none';
    this.elements.jobStealingRow = jobRow;
    container.appendChild(jobRow);

    const workerTitle = document.createElement('div');
    workerTitle.className = 'debug-ui-stat';
    workerTitle.style.cssText = 'font-weight:bold;font-size:12px;margin-top:8px;margin-bottom:4px;color:rgba(255,255,255,0.9)';
    workerTitle.textContent = 'Workers';
    container.appendChild(workerTitle);

    this.elements.workerStatsContainer = document.createElement('div');
    this.elements.workerStatsContainer.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    container.appendChild(this.elements.workerStatsContainer);

    this.panel.appendChild(container);
    return this.panel;
  }

  // ------- lifecycle -------

  attach() {
    this._createWorkerStatElements();
  }

  update() {
    this._updatePerformanceSection();
  }

  // ------- worker DOM builder -------

  _createWorkerStatElements() {
    const stats = this.debugUI.stats;
    if (!stats.workerStatViews) return;

    const container = this.elements.workerStatsContainer;
    container.innerHTML = '';

    const table = document.createElement('div');
    table.className = 'debug-ui-worker-table';

    // Column headers (aligned common columns)
    const header = document.createElement('div');
    header.className = 'debug-ui-worker-row header';
    header.appendChild(this._cell('label', ''));
    header.appendChild(this._cell('stat common', 'Step'));
    header.appendChild(this._cell('stat common', 'Fps'));
    header.appendChild(this._cell('stat common', 'Msg'));
    header.appendChild(this._cell('stat extras', 'Details'));
    table.appendChild(header);

    this.elements.workerStats = {};

    // Main
    table.appendChild(this._createFixedRow('main', 'Main', 'main', {
      STEP_MS: true,
      FPS: true,
      MSG_MS: false,
    }));

    // Workers in requested order
    for (const type of WORKER_ROW_ORDER) {
      if (type === 'spatial' || type === 'logic') {
        const views = stats.workerStatViews[type];
        if (!views || views.length === 0) continue;
        this.elements.workerStats[type] = [];
        for (let i = 0; i < views.length; i++) {
          const built = this._createWorkerStatRow(type, i);
          table.appendChild(built.row);
          this.elements.workerStats[type].push(built.elements);
        }
      } else if (stats.workerStatViews[type]) {
        const built = this._createWorkerStatRow(type, 0);
        table.appendChild(built.row);
        if (!this.elements.workerStats[type]) this.elements.workerStats[type] = [];
        this.elements.workerStats[type].push(built.elements);
      }
    }

    // Audio last
    table.appendChild(this._createAudioRow());

    container.appendChild(table);
  }

  _cell(className, text) {
    const el = document.createElement('div');
    el.className = `debug-ui-worker-cell ${className}`;
    el.textContent = text;
    return el;
  }

  _createFixedRow(id, label, colorClass, commonFlags) {
    const row = document.createElement('div');
    row.className = 'debug-ui-worker-row';

    const labelCell = this._cell(`label debug-ui-stat ${colorClass}`, label);
    row.appendChild(labelCell);

    const elements = {};
    for (const key of COMMON_KEYS) {
      const cell = this._cell(`stat common debug-ui-stat ${colorClass}`, '—');
      row.appendChild(cell);
      if (commonFlags[key]) elements[key] = cell;
      else cell.classList.add('empty');
    }

    const extras = this._cell(`stat extras debug-ui-stat ${colorClass}`, '');
    row.appendChild(extras);
    elements._extras = extras;

    if (id === 'main') {
      this.elements.mainStep = elements.STEP_MS;
      this.elements.mainFPS = elements.FPS;
      this.elements.mainExtras = extras;
    }

    return row;
  }

  _createAudioRow() {
    const row = document.createElement('div');
    row.className = 'debug-ui-worker-row';
    row.appendChild(this._cell('label debug-ui-stat audio', 'Audio'));

    this.elements.audioStats = {};
    const step = this._cell('stat common debug-ui-stat audio', '—');
    row.appendChild(step);
    this.elements.audioStats.STEP_MS = step;

    const fps = this._cell('stat common empty debug-ui-stat audio', '—');
    row.appendChild(fps);

    const msg = this._cell('stat common empty debug-ui-stat audio', '—');
    row.appendChild(msg);

    const extras = this._cell('stat extras debug-ui-stat audio', '');
    row.appendChild(extras);
    this.elements.audioStats._extras = extras;
    this.elements.audioStats.Slots = null; // filled as text in extras

    return row;
  }

  _createWorkerStatRow(workerType, workerIndex) {
    const stats = this.debugUI.stats;
    const config = WORKER_DISPLAY_CONFIG[workerType];
    const row = document.createElement('div');
    row.className = 'debug-ui-worker-row';
    const elements = {};

    const count = (workerType === 'spatial' || workerType === 'logic')
      ? stats.workerStatViews[workerType].length
      : 1;
    const title = count > 1 ? `${config.label} #${workerIndex}` : config.label;
    row.appendChild(this._cell(`label debug-ui-stat ${config.color}`, title));

    for (const key of COMMON_KEYS) {
      const cell = this._cell(`stat common debug-ui-stat ${config.color}`, '—');
      row.appendChild(cell);
      elements[key] = cell;
    }

    const extrasWrap = this._cell(`stat extras debug-ui-stat ${config.color}`, '');
    extrasWrap.classList.add('extras-wrap');
    row.appendChild(extrasWrap);

    for (let s = COMMON_KEYS.length; s < config.stats.length; s++) {
      const stat = config.stats[s];
      const chip = document.createElement('span');
      chip.className = 'debug-ui-worker-detail';
      chip.textContent = `${stat.label}: —`;
      extrasWrap.appendChild(chip);
      elements[stat.key] = chip;
    }

    return { row, elements };
  }

  // ------- tick updates -------

  _updatePerformanceSection() {
    const scene = this.debugUI.scene;
    const stats = this.debugUI.stats;
    if (!scene || !stats.workerStatViews) return;

    this._updateSummary(stats, scene);

    const mainStepRounded = (scene.mainStepMs * 100) | 0;
    if (this.elements.mainStep && mainStepRounded !== stats.prev.mainStepMs) {
      stats.prev.mainStepMs = mainStepRounded;
      this.elements.mainStep.textContent = fmtMs(mainStepRounded / 100);
    }
    const mainFPSRounded = (scene.mainFPS * 100) | 0;
    if (this.elements.mainFPS && mainFPSRounded !== stats.prev.mainFPS) {
      stats.prev.mainFPS = mainFPSRounded;
      this.elements.mainFPS.textContent = fmtFps(mainFPSRounded / 100);
    }

    this._updateAudioStats(scene.audioMetrics, stats);

    for (const type of WORKER_ROW_ORDER) {
      const schema = SCHEMA_BY_TYPE[type];
      if (!schema) continue;
      if (type === 'spatial' || type === 'logic') {
        this._updateMultiWorkerStats(type, schema, stats);
      } else {
        this._updateSingleWorkerStats(type, schema, stats);
      }
    }
  }

  _updateSummary(stats, scene) {
    const pv = stats.prev;
    const particleView = stats.workerStatViews?.particle;
    const rendererView = stats.workerStatViews?.renderer;

    if (particleView && this.elements.perfGameObjects) {
      const aGO = (particleView[PARTICLE_STATS.ACTIVE_ENTITIES] || 0) | 0;
      const tGO = (particleView[PARTICLE_STATS.TOTAL_ENTITIES] || 0) | 0;
      const vGO = rendererView ? (rendererView[RENDERER_STATS.VISIBLE_ENTITIES] || 0) | 0 : 0;
      if (aGO !== pv.activeGO || tGO !== pv.totalGO || vGO !== pv.visibleGO) {
        pv.activeGO = aGO; pv.totalGO = tGO; pv.visibleGO = vGO;
        this.elements.perfGameObjects.textContent = 'Game objects: ' + formatNumber(aGO) + ' / ' + formatNumber(tGO) + ' (👁 ' + formatNumber(vGO) + ')';
      }
    }

    if (particleView && this.elements.perfParticles) {
      const aP = (particleView[PARTICLE_STATS.ACTIVE_PARTICLES] || 0) | 0;
      const tP = (particleView[PARTICLE_STATS.TOTAL_PARTICLES] || 0) | 0;
      const vP = rendererView ? (rendererView[RENDERER_STATS.VISIBLE_PARTICLES] || 0) | 0 : 0;
      if (aP !== pv.activeP || tP !== pv.totalP || vP !== pv.visibleP) {
        pv.activeP = aP; pv.totalP = tP; pv.visibleP = vP;
        this.elements.perfParticles.textContent = 'Particles: ' + formatNumber(aP) + ' / ' + formatNumber(tP) + ' (👁 ' + formatNumber(vP) + ')';
      }
    }

    if (rendererView && this.elements.perfDecorations) {
      const aD = (rendererView[RENDERER_STATS.ACTIVE_DECORATIONS] || 0) | 0;
      const vD = (rendererView[RENDERER_STATS.VISIBLE_DECORATIONS] || 0) | 0;
      const tD = (DecorationPool.maxDecorations || 0) | 0;
      if (aD !== pv.activeD || tD !== pv.totalD || vD !== pv.visibleD) {
        pv.activeD = aD; pv.totalD = tD; pv.visibleD = vD;
        this.elements.perfDecorations.textContent = 'Decorations: ' + formatNumber(aD) + ' / ' + formatNumber(tD) + ' (👁 ' + formatNumber(vD) + ')';
      }
    }

    if (particleView && this.elements.perfFlash) {
      const flash = (particleView[PARTICLE_STATS.FLASHES_UPDATED] || 0) | 0;
      if (flash !== pv.flashUpdated) {
        pv.flashUpdated = flash;
        this.elements.perfFlash.textContent = 'Flash: ' + formatNumber(flash) + ' updated';
      }
    }
  }

  _updateAudioStats(audioMetrics, stats) {
    const els = this.elements.audioStats;
    if (!els || !audioMetrics) return;
    const pv = stats.prev;

    const processMs = audioMetrics.processMs || 0;
    const processRounded = (processMs * 100) | 0;
    if (processRounded !== pv.audioProcessMs) {
      pv.audioProcessMs = processRounded;
      if (els.STEP_MS) els.STEP_MS.textContent = fmtMs(processRounded / 100);
    }

    const active = (audioMetrics.activeSlots || 0) | 0;
    const max = (audioMetrics.maxSlots || 0) | 0;
    const loaded = (audioMetrics.loadedSounds || 0) | 0;
    const dropped = (audioMetrics.dropped || 0) | 0;
    const masterVolR = ((audioMetrics.masterVolume || 0) * 100 + 0.5) | 0;
    const muted = audioMetrics.muted;
    const baseLat = audioMetrics.baseLatency || 0;
    const outLat = audioMetrics.outputLatency || 0;
    const latencyMs = ((baseLat + outLat) * 100000 + 0.5) | 0;
    const rate = (audioMetrics.sampleRate || 0) | 0;

    if (
      active !== pv.audioActive ||
      max !== pv.audioMax ||
      loaded !== pv.audioLoaded ||
      dropped !== pv.audioDropped ||
      masterVolR !== pv.audioMasterVol ||
      muted !== pv.audioMuted ||
      rate !== pv.audioRate ||
      latencyMs !== pv.audioLatency
    ) {
      pv.audioActive = active;
      pv.audioMax = max;
      pv.audioLoaded = loaded;
      pv.audioDropped = dropped;
      pv.audioMasterVol = masterVolR;
      pv.audioMuted = muted;
      pv.audioRate = rate;
      pv.audioLatency = latencyMs;

      const rateStr = rate >= 1000 ? (rate / 1000) + ' kHz' : rate ? rate + ' Hz' : '—';
      const parts = [
        `Slots ${active}/${max}`,
        `Loaded ${loaded}`,
        `Dropped ${dropped}`,
        `Vol ${masterVolR}%${muted ? ' (muted)' : ''}`,
        `Lat ${(latencyMs / 100).toFixed(2)} ms`,
        rateStr,
      ];
      if (els._extras) els._extras.textContent = parts.join(' · ');
    }
  }

  _updateSingleWorkerStats(workerType, statsSchema, stats) {
    const view = stats.workerStatViews[workerType];
    if (!view) return;
    const ws = this.elements.workerStats;
    if (!ws || !ws[workerType] || !ws[workerType][0]) return;
    this._writeWorkerCells(workerType, 0, view, statsSchema, stats, ws[workerType][0]);
  }

  _updateMultiWorkerStats(workerType, statsSchema, stats) {
    const views = stats.workerStatViews[workerType];
    if (!views || views.length === 0) return;
    const ws = this.elements.workerStats;
    if (!ws || !ws[workerType]) return;

    for (let i = 0; i < views.length; i++) {
      const elements = ws[workerType][i];
      if (!elements) continue;
      this._writeWorkerCells(workerType, i, views[i], statsSchema, stats, elements);
    }
  }

  _writeWorkerCells(workerType, workerIndex, view, statsSchema, stats, elements) {
    const config = WORKER_DISPLAY_CONFIG[workerType];
    if (!stats.prevWorker[workerType]) stats.prevWorker[workerType] = {};
    if (!stats.prevWorker[workerType][workerIndex]) stats.prevWorker[workerType][workerIndex] = {};
    const prevCache = stats.prevWorker[workerType][workerIndex];

    const smoother =
      workerType === 'spatial' || workerType === 'logic'
        ? stats.fpsSmoothing[workerType][workerIndex]
        : stats.fpsSmoothing[workerType];

    for (let s = 0; s < config.stats.length; s++) {
      const stat = config.stats[s];
      const el = elements[stat.key];
      if (!el) continue;

      let rawValue = view[statsSchema[stat.key]];
      if (stat.key === 'FPS' && smoother) {
        rawValue = stats.smoothFPS(rawValue, smoother);
      }
      const rounded = (rawValue * 100) | 0;
      if (prevCache[stat.key] === rounded) continue;
      prevCache[stat.key] = rounded;

      const formatted = stat.format(rawValue);
      if (COMMON_KEYS.includes(stat.key)) {
        el.textContent = formatted;
      } else {
        el.textContent = `${stat.label}: ${formatted}`;
      }
    }
  }

  // ------- util -------

  _colorStat(color, text) {
    const el = createStat(text);
    el.style.color = color;
    return el;
  }
}
