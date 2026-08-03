#!/usr/bin/env node
/**
 * Neighbor reuse correctness gate + perf compare (skin 0 vs 0.25).
 *
 * Phase A — correctness (verifyNeighborSets): FN=0 FP=0 required for both skins.
 * Phase B — perf (no oracle): Verlet STEP_MS must improve ≥3% vs skin 0.
 *
 *   node tests/bench/run-neighbor-reuse-correctness.mjs
 *   node tests/bench/run-neighbor-reuse-correctness.mjs --headed --runs 2
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { workerLoadPct } from '../../src/workers/workers-utils.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runner = path.join(repoRoot, 'tests/bench/run-integrated-worker-benchmark.mjs');
const outDir = path.join(repoRoot, 'tests/results/neighbor-reuse');
const summaryPath = path.join(outDir, 'correctness-summary.json');
const SCENE = '/demos/scenes/NeighborReuseCorrectnessScene.js';

function parseArgs(argv) {
  const out = {
    headed: true,
    runs: 2,
    warmupMs: 8000,
    durationMs: 10000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headless') out.headed = false;
    else if (a === '--headed') out.headed = true;
    else if (a === '--runs' && argv[i + 1]) out.runs = Math.max(1, parseInt(argv[++i], 10) || 2);
    else if (a === '--warmup-ms' && argv[i + 1]) out.warmupMs = parseInt(argv[++i], 10) || out.warmupMs;
    else if (a === '--duration-ms' && argv[i + 1]) out.durationMs = parseInt(argv[++i], 10) || out.durationMs;
  }
  return out;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarize(j) {
  const spatial = (j.workers || []).find((w) => w.id === 'spatial0');
  const avg = spatial?.statsSamplesAverage || {};
  const end = spatial?.statsEnd || {};
  const fn = Math.max(end.FALSE_NEGATIVES ?? 0, avg.FALSE_NEGATIVES ?? 0);
  const fp = Math.max(end.FALSE_POSITIVES ?? 0, avg.FALSE_POSITIVES ?? 0);
  return {
    STEP_MS: avg.STEP_MS ?? 0,
    NEIGHBOR_MS: avg.NEIGHBOR_MS ?? 0,
    REBUILD_MS: avg.REBUILD_MS ?? 0,
    NEIGHBORS_REUSED: avg.NEIGHBORS_REUSED ?? 0,
    FALSE_NEGATIVES: fn,
    FALSE_POSITIVES: fp,
    loadPct: workerLoadPct(avg.STEP_MS ?? 0),
    averageFPS: spatial?.averageFPS ?? 0,
  };
}

function runVariant(label, sceneExport, args) {
  const runs = [];
  for (let r = 0; r < args.runs; r++) {
    const out = path.join(outDir, `${label}-r${r + 1}.json`);
    const cli = [
      runner,
      ...(args.headed ? ['--headed'] : []),
      '--scene',
      SCENE,
      '--scene-export',
      sceneExport,
      '--warmup-ms',
      String(args.warmupMs),
      '--duration-ms',
      String(args.durationMs),
      '--output',
      out,
    ];
    console.log(`\n>>> ${label} run ${r + 1}/${args.runs}`);
    execFileSync(process.execPath, cli, { cwd: repoRoot, stdio: 'inherit' });
    const row = summarize(JSON.parse(fs.readFileSync(out, 'utf8')));
    runs.push(row);
    console.log(
      `  STEP_MS=${row.STEP_MS.toFixed(3)} NEIGHBOR_MS=${row.NEIGHBOR_MS.toFixed(3)} ` +
        `REUSED=${row.NEIGHBORS_REUSED.toFixed(0)} FN=${row.FALSE_NEGATIVES} FP=${row.FALSE_POSITIVES}`
    );
  }
  return {
    label,
    sceneExport,
    runs,
    aggregate: {
      STEP_MS: median(runs.map((x) => x.STEP_MS)),
      NEIGHBOR_MS: median(runs.map((x) => x.NEIGHBOR_MS)),
      NEIGHBORS_REUSED: median(runs.map((x) => x.NEIGHBORS_REUSED)),
      FALSE_NEGATIVES: Math.max(...runs.map((x) => x.FALSE_NEGATIVES)),
      FALSE_POSITIVES: Math.max(...runs.map((x) => x.FALSE_POSITIVES)),
    },
  };
}

const args = parseArgs(process.argv.slice(2));
fs.mkdirSync(outDir, { recursive: true });

console.log(
  `Neighbor reuse gate | runs=${args.runs} | ${args.headed ? 'headed' : 'headless'} | ` +
    `warmup ${args.warmupMs}ms measure ${args.durationMs}ms\n`
);

console.log('=== Phase A: correctness (oracle on) ===');
const correctBaseline = runVariant('correct-skin0', 'NeighborReuseBaselineScene', args);
const correctVerlet = runVariant('correct-skin025', 'NeighborReuseCorrectnessScene', args);

console.log('\n=== Phase B: perf (oracle off) ===');
const perfBaseline = runVariant('perf-skin0', 'NeighborReusePerfBaselineScene', args);
const perfVerlet = runVariant('perf-skin025', 'NeighborReusePerfScene', args);

const baseStep = perfBaseline.aggregate.STEP_MS;
const verStep = perfVerlet.aggregate.STEP_MS;
const stepDeltaPct = baseStep > 0 ? ((verStep - baseStep) / baseStep) * 100 : 0;

const summary = {
  generatedAt: new Date().toISOString(),
  args,
  correctness: { baseline: correctBaseline, verlet: correctVerlet },
  perf: {
    baseline: perfBaseline,
    verlet: perfVerlet,
    baselineStepMs: baseStep,
    verletStepMs: verStep,
    stepDeltaPct,
    improvedAtLeast3pct: stepDeltaPct <= -3,
  },
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
console.log(`\nWrote ${summaryPath}`);

let exitCode = 0;
for (const block of [correctBaseline, correctVerlet]) {
  if (block.aggregate.FALSE_NEGATIVES > 0 || block.aggregate.FALSE_POSITIVES > 0) {
    console.error(
      `CORRECTNESS FAIL ${block.label}: FN=${block.aggregate.FALSE_NEGATIVES} FP=${block.aggregate.FALSE_POSITIVES}`
    );
    exitCode = 1;
  } else {
    console.log(`CORRECTNESS PASS ${block.label}: FN=0 FP=0`);
  }
}

console.log(
  `PERF: baseline STEP_MS=${baseStep.toFixed(3)} verlet=${verStep.toFixed(3)} Δ%=${stepDeltaPct.toFixed(1)} ` +
    `REUSED med=${perfVerlet.aggregate.NEIGHBORS_REUSED.toFixed(0)}`
);
if (exitCode === 0 && !summary.perf.improvedAtLeast3pct) {
  console.error('PERF FAIL: Verlet skin 0.25 did not improve STEP_MS by ≥3%');
  exitCode = 2;
} else if (exitCode === 0) {
  console.log('PERF PASS: ≥3% STEP_MS improvement');
}

process.exit(exitCode);
