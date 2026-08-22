import assert from 'node:assert/strict';
import { AdaptiveWorkStrategy } from './adaptive-work-strategy.mjs';

const strategy = new AdaptiveWorkStrategy({ baseSizeWeth: 0.01, stopAfterLosses: 2 });
assert.throws(() => strategy.decide({ asset: 'SCAM', confidence: 1, spreadBps: 1, liquidityWeth: 10, momentumBps: 1 }));
assert.equal(strategy.decide({ asset: 'RARE', confidence: 0.5, spreadBps: 10, liquidityWeth: 10, momentumBps: 100 }).action, 'WAIT');
assert.equal(strategy.decide({ asset: 'RARE', confidence: 0.9, spreadBps: 200, liquidityWeth: 10, momentumBps: 100 }).action, 'WAIT');
assert.equal(strategy.decide({ asset: 'RARE', confidence: 0.9, spreadBps: 10, liquidityWeth: 0.1, momentumBps: 100 }).action, 'WAIT');
assert.equal(strategy.decide({ asset: 'RARE', confidence: 0.9, spreadBps: 10, liquidityWeth: 10, momentumBps: 100 }).action, 'OPEN');
assert.equal(strategy.recordClosedTrade('RARE', -100).riskMultiplier, 0.5);
assert.equal(strategy.recordClosedTrade('RARE', -50).riskMultiplier, 0.25);
assert.equal(strategy.decide({ asset: 'RARE', confidence: 0.9, spreadBps: 10, liquidityWeth: 10, momentumBps: 100 }).action, 'PAUSE');
assert.equal(strategy.recordClosedTrade('RARE', 200).lossStreak, 0);
assert.ok(strategy.state('RARE').riskMultiplier > 0.25);

console.log('Adaptive strategy tests passed: 10 assertions');
