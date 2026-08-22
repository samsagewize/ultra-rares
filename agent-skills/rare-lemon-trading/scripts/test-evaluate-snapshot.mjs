import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const script = new URL('./evaluate-snapshot.mjs', import.meta.url);
const base = { asset: 'RARE', timestamp: new Date().toISOString(), confidence: 80, spreadBps: 50, liquidityWeth: 10, proposedWeth: 0.01, priceImpactBps: 20, positiveSignals: 3, lossStreak: 0, dailyLossLimitHit: false };
const run = (overrides) => {
  const file = path.join(os.tmpdir(), `rare-snapshot-${Math.random()}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...base, ...overrides }));
  try { return JSON.parse(execFileSync(process.execPath, [script.pathname.slice(1), file], { encoding: 'utf8' })); }
  finally { fs.unlinkSync(file); }
};

if (run({}).decision !== 'OPEN_RARE') throw new Error('valid setup should open');
if (run({ confidence: 50 }).decision !== 'WAIT') throw new Error('weak confidence should wait');
if (run({ lossStreak: 2 }).decision !== 'PAUSE') throw new Error('loss streak should pause');
if (run({ learnedMultiplier: 0.5 }).maximumWeth !== 0.005) throw new Error('learning must reduce size');
console.log('RARE / LEMON skill tests passed: 4 assertions');
