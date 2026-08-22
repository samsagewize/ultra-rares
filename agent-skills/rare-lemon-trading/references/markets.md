# Approved markets and boundaries

## Robinhood Chain

- Chain ID: `4663`
- Official public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Ultra Rares: `0x923aaaa62c12505b1bbb57ed52b730d6462c01c5`
- RARE: `0x1d522a4c3e1f3d97b585903474b2544cf9feeffb`
- LEMON: `0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3`
- WETH observed in the RARE pool: `0x0bd7d308f8e1639fab988df18a8011f41eacad73`
- RARE/WETH pool: `0x8ec9c76ed191fb03397637acee1ce928426beb80`
- Admin pilot wallet: `0x562f6ac10723ef6af9f077a83cf25135fb369612`
- Admin-owned pilot NFT: Ultra Rare `#420`

## Security boundaries

- Never read or request seed phrases or private keys.
- Never approve an arbitrary spender or execute arbitrary router calldata.
- Never trade from the holder's main wallet.
- Keep each NFT's capital in its isolated agent.
- Require an immutable allowlist, exact approvals, TWAP-style protection, slippage limits, cooldown, daily-loss cap, consecutive-loss breaker, pause, and owner withdrawal.
- Treat missing, stale, conflicting, or rate-limited data as `WAIT`.

## Paper defaults

- Base size: `0.01 WETH` maximum
- Minimum confidence: `70`
- Maximum spread: `150 bps`
- Maximum expected impact: `100 bps`
- Minimum liquidity: `50×` trade size
- Maximum snapshot age: `30 seconds`
- Stop after: `2` consecutive losses
- Profit split example: `70%` claim pocket / `30%` retained, controlled onchain

Defaults are evaluation parameters, not financial advice. Tune only from paper results and never silently widen risk.
