#!/usr/bin/env node
/**
 * LightingBench A/B scout — both cookie + raycast modes ×2 (headed).
 *
 * Hyp → metric map:
 *   densify kill / uLightRadius     → raycast: VISIBILITY_MS, preRender STEP_MS
 *   CASTED_SHADOWS off under raycast → raycast: SHADOWS_MS ≈ 0
 *   cookie shadow path              → cookie: SHADOWS_MS, SHADOW_Q_MS
 *   Ray LoS / linecastDir           → both: logic STEP_MS
 *
 * Usage:
 *   node tests/bench/run-lighting-bench-ab.mjs
 *   node tests/bench/run-lighting-bench-ab.mjs --warmup-ms 10000 --duration-ms 8000
 *   node tests/bench/run-lighting-bench-ab.mjs --tag branch
 *
 * Compare main vs branch: run with --tag main / --tag branch, then compare
 * VISIBLE_ENTITIES / RENDER_QUEUE_SIZE (drift guard fails if >5% apart within a tag pair).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_DURATION_MS, DEFAULT_WARMUP_MS } from './benchmarkDefaults.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const runner = path.join(repoRoot, 'tests/bench/run-integrated-worker-benchmark.mjs');
const outDir = path.join(repoRoot, 'tests/results');

const SCENE = '/demos/scenes/LightingBenchScene.js';
const MODES = [
  { exportName: 'LightingBenchCookieScene', label: 'cookie' },
  { exportName: 'LightingBenchRaycastScene', label: 'raycast' },
];

const DRIFT_PCT = 0.05;

function parseArgs(argv) {
  const out = {
    warmupMs: Math.min(DEFAULT_WARMUP_MS, 12_000),
    durationMs: Math.min(DEFAULT_DURATION_MS, 10_000),
    tag: 'local',
    runs: 2,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--warmup-ms' && argv[i + 1]) out.warmupMs = parseInt(argv[++i], 10) || out.warmupMs;
    else if (a === '--duration-ms' && argv[i + 1]) out.durationMs = parseInt(argv[++i], 10) || out.durationMs;
    else if (a === '--tag' && argv[i + 1]) out.tag = String(argv[++i]);
    else if (a === '--runs' && argv[i + 1]) out.runs = Math.max(1, parseInt(argv[++i], 10) || 2);
  }
  return out;
}

function avg(j, id, key) {
  const w = (j.workers || []).find((x) => x.id === id);
  if (!w) return null;
  const s = w.statsSamplesAverage || w.statsEnd || {};
  return s[key] != null ? Number(s[key]) : null;
}

function fmt(v, digits = 3) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(digits);
}

function extract(j) {
  return {
    physicsStep: avg(j, 'physics', 'STEP_MS'),
    bodyCount: avg(j, 'physics', 'BODY_COUNT'),
    logic0Step: avg(j, 'logic0', 'STEP_MS'),
    logic1Step: avg(j, 'logic1', 'STEP_MS'),
    particleStep: avg(j, 'particle', 'STEP_MS'),
    preRenderStep: avg(j, 'preRender', 'STEP_MS'),
    visibilityMs: avg(j, 'preRender', 'VISIBILITY_MS'),
    shadowQMs: avg(j, 'preRender', 'SHADOW_Q_MS'),
    renderQueue: avg(j, 'preRender', 'RENDER_QUEUE_SIZE'),
    visibleEnts: avg(j, 'preRender', 'VISIBLE_ENTITIES') ?? avg(j, 'renderer', 'VISIBLE_ENTITIES'),
    rendererStep: avg(j, 'renderer', 'STEP_MS'),
    shadowsMs: avg(j, 'renderer', 'SHADOWS_MS'),
    lightsMs: avg(j, 'renderer', 'LIGHTS_MS'),
  };
}

function driftFail(a, b, key) {
  const va = a[key];
  const vb = b[key];
  if (va == null || vb == null || va === 0) return null;
  const rel = Math.abs(vb - va) / Math.abs(va);
  if (rel > DRIFT_PCT) return { key, va, vb, rel };
  return null;
}

function runOne(mode, tag, runIndex, warmupMs, durationMs) {
  const stem = `lb-${mode.label}-${tag}-${runIndex}`;
  const output = path.join(outDir, `${stem}.json`);
  const args = [
    runner,
    '--headed',
    '--warmup-ms',
    String(warmupMs),
    '--duration-ms',
    String(durationMs),
    '--scene',
    SCENE,
    '--scene-export',
    mode.exportName,
    '--output',
    output,
  ];
  console.log(`\n>>> ${stem}`);
  execFileSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' });
  const j = JSON.parse(fs.readFileSync(output, 'utf8'));
  return { stem, output, metrics: extract(j) };
}

function printTable(rows) {
  const keys = [
    'physicsStep',
    'logic0Step',
    'particleStep',
    'preRenderStep',
    'visibilityMs',
    'shadowQMs',
    'shadowsMs',
    'rendererStep',
    'visibleEnts',
    'renderQueue',
    'bodyCount',
  ];
  console.log('\n=== LightingBench summary ===');
  console.log(
    'run'.padEnd(28) +
      keys.map((k) => k.slice(0, 12).padStart(12)).join('')
  );
  for (const r of rows) {
    const m = r.metrics;
    console.log(
      r.stem.padEnd(28) +
        keys.map((k) => fmt(m[k], k.includes('Step') || k.endsWith('Ms') ? 3 : 1).padStart(12)).join('')
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(outDir, { recursive: true });

  const rows = [];
  for (const mode of MODES) {
    const modeRows = [];
    for (let i = 1; i <= args.runs; i++) {
      const row = runOne(mode, args.tag, i, args.warmupMs, args.durationMs);
      rows.push(row);
      modeRows.push(row);
    }
    if (modeRows.length >= 2) {
      for (const key of ['visibleEnts', 'renderQueue', 'bodyCount']) {
        const d = driftFail(modeRows[0].metrics, modeRows[1].metrics, key);
        if (d) {
          console.error(
            `\nDRIFT GUARD FAIL [${mode.label}] ${d.key}: ${fmt(d.va, 1)} vs ${fmt(d.vb, 1)} ` +
              `(${(d.rel * 100).toFixed(1)}% > ${DRIFT_PCT * 100}%)`
          );
          process.exitCode = 2;
        }
      }
    }
  }

  printTable(rows);
  console.log(`\nTag=${args.tag} warmup=${args.warmupMs}ms duration=${args.durationMs}ms`);
  console.log('Compare tags only when visibleEnts / renderQueue / bodyCount match across builds.');
}

main();
