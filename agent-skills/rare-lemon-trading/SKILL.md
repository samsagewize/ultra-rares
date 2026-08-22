---
name: rare-lemon-trading
description: Evaluate, paper-test, journal, and risk-gate RARE/LEMON spot strategies for the Ultra Rares Work agent on Robinhood Chain. Use when assessing a proposed RARE or LEMON trade, replaying market snapshots, tuning entry/exit rules, analyzing a completed trade, or deciding whether the agent must WAIT, OPEN, EXIT, or PAUSE. Never use it to promise returns, expose keys, or bypass owner and onchain controls.
---

# RARE / LEMON Trading

Operate as a signal and risk layer, never as wallet custody.

## Workflow

1. Confirm `mode=paper`. Refuse live execution unless the owner explicitly enables a separately audited adapter and price guard.
2. Accept only official RARE, LEMON, and WETH addresses from [references/markets.md](references/markets.md). Reject arbitrary tokens, routers, calldata, or approval targets.
3. Gather a timestamped snapshot: venue, pool, price, market cap, liquidity, spread, 5-minute and 1-hour change, buy/sell ratio, expected price impact, gas, and current agent state.
4. Run `node scripts/evaluate-snapshot.mjs <snapshot.json>`. Treat its hard gates as final. Never let narrative judgment override `WAIT` or `PAUSE`.
5. Create a step log: `DEPOSIT → ENTRY → MONITOR → EXIT TO WETH → PROFIT SPLIT`. Do not show future steps as completed.
6. Record every rejected setup and closed trade. Update performance separately for RARE and LEMON; never combine their loss streaks or average returns.
7. After a loss, halve that market's next size. Restore size by at most 10 percentage points after a win. Pause after two consecutive losses or the onchain daily-loss limit.

## Decision rules

- Require confidence ≥70, spread ≤150 bps, liquidity ≥50× proposed WETH, price impact ≤100 bps, and fresh data ≤30 seconds.
- Require at least two independent positive signals. Treat price alone as one signal.
- Reject entries after a one-hour move above the configured chase limit.
- Size from the owner's base amount and learned multiplier; never exceed the onchain cycle cap.
- Define exit and invalidation before entry. Close only through the guarded adapter into WETH.
- Calculate profit from WETH returned minus WETH principal and all execution costs. Token appreciation is not realized profit.
- Split only positive realized WETH according to the onchain `claimBps`. A loss produces zero claimable ETH.
- Use deterministic calculations for amounts and P/L. Use an LLM only to summarize evidence or discover candidate signals.

## Required output

Return:

- decision: `WAIT`, `OPEN_RARE`, `OPEN_LEMON`, `EXIT`, or `PAUSE`
- confidence and hard-gate results
- maximum WETH size
- entry reason and invalidation
- guarded minimum output
- current step and timestamp
- realized WETH P/L when closed
- claim-pocket and continued-trading amounts
- evidence sources and data age

Never claim that a strategy is guaranteed profitable.
