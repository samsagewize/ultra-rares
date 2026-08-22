const ALLOWED_ASSETS = new Set(['RARE', 'LEMON']);

export class AdaptiveWorkStrategy {
  constructor({ baseSizeWeth, minimumConfidence = 0.7, maximumSpreadBps = 150, stopAfterLosses = 2 }) {
    if (!(baseSizeWeth > 0) || minimumConfidence < 0.5 || minimumConfidence > 1) throw new Error('invalid strategy');
    this.baseSizeWeth = baseSizeWeth;
    this.minimumConfidence = minimumConfidence;
    this.maximumSpreadBps = maximumSpreadBps;
    this.stopAfterLosses = stopAfterLosses;
    this.assets = new Map();
  }

  state(asset) {
    if (!ALLOWED_ASSETS.has(asset)) throw new Error('asset not allowed');
    if (!this.assets.has(asset)) this.assets.set(asset, { trades: 0, averageReturnBps: 0, lossStreak: 0, riskMultiplier: 1 });
    return this.assets.get(asset);
  }

  decide({ asset, confidence, spreadBps, liquidityWeth, momentumBps }) {
    const state = this.state(asset);
    if (state.lossStreak >= this.stopAfterLosses) return { action: 'PAUSE', reason: 'loss circuit breaker' };
    if (confidence < this.minimumConfidence) return { action: 'WAIT', reason: 'confidence too low' };
    if (spreadBps > this.maximumSpreadBps) return { action: 'WAIT', reason: 'spread too wide' };
    if (liquidityWeth < this.baseSizeWeth * 50) return { action: 'WAIT', reason: 'insufficient liquidity' };
    if (momentumBps <= 0 || state.averageReturnBps < -50) return { action: 'WAIT', reason: 'no positive edge' };
    return {
      action: 'OPEN',
      asset,
      sizeWeth: Math.min(this.baseSizeWeth * state.riskMultiplier, liquidityWeth / 100),
      reason: 'risk checks passed',
    };
  }

  recordClosedTrade(asset, returnBps) {
    if (!Number.isFinite(returnBps)) throw new Error('invalid return');
    const state = this.state(asset);
    state.averageReturnBps = state.trades === 0 ? returnBps : (state.averageReturnBps * 0.8) + (returnBps * 0.2);
    state.trades += 1;
    if (returnBps < 0) {
      state.lossStreak += 1;
      state.riskMultiplier = Math.max(0.1, state.riskMultiplier * 0.5);
    } else {
      state.lossStreak = 0;
      state.riskMultiplier = Math.min(1, state.riskMultiplier + 0.1);
    }
    return { ...state };
  }
}
