import fs from 'node:fs';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('usage: node evaluate-snapshot.mjs <snapshot.json>');
const snapshot = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const allowed = new Set(['RARE', 'LEMON']);
const required = ['asset', 'timestamp', 'confidence', 'spreadBps', 'liquidityWeth', 'proposedWeth', 'priceImpactBps', 'positiveSignals', 'lossStreak', 'dailyLossLimitHit'];
for (const key of required) if (snapshot[key] === undefined) throw new Error(`missing ${key}`);
if (!allowed.has(snapshot.asset)) throw new Error('asset not allowed');

const ageSeconds = Math.max(0, (Date.now() - new Date(snapshot.timestamp).getTime()) / 1000);
const gates = {
  fresh: ageSeconds <= 30,
  confidence: snapshot.confidence >= 70,
  spread: snapshot.spreadBps <= 150,
  liquidity: snapshot.liquidityWeth >= snapshot.proposedWeth * 50,
  impact: snapshot.priceImpactBps <= 100,
  signals: snapshot.positiveSignals >= 2,
  losses: snapshot.lossStreak < 2,
  dailyLoss: snapshot.dailyLossLimitHit === false,
};

let decision = `OPEN_${snapshot.asset}`;
let reason = 'all paper-entry gates passed';
if (!gates.losses || !gates.dailyLoss) {
  decision = 'PAUSE';
  reason = 'loss circuit breaker';
} else if (Object.values(gates).some((value) => !value)) {
  decision = 'WAIT';
  reason = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name).join(', ');
}

const learnedMultiplier = Math.max(0.1, Math.min(1, Number(snapshot.learnedMultiplier ?? 1)));
const maximumWeth = Math.min(Number(snapshot.proposedWeth), Number(snapshot.ownerCycleCapWeth ?? snapshot.proposedWeth)) * learnedMultiplier;
process.stdout.write(`${JSON.stringify({ mode: 'paper', decision, reason, maximumWeth, ageSeconds, gates }, null, 2)}\n`);
