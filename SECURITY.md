# Security policy

## Mainnet launch status

The public launchpad is fail-closed until `launch-config.json` contains a Factory address that passes every on-chain identity and economic-constant check in `launch.js`.

Factory V4 is a limited pilot:

- token creation is permanently restricted to the immutable administrator;
- creation is nonpayable and the website explicitly sends `0 ETH`;
- the exact 250,000 RARE launch fee is sent directly to the immutable Launch Vault;
- symbols cannot be reused;
- each token has isolated ETH backing and isolated creator/treasury fee liabilities;
- graduation uses the immutable official Robinhood Chain Uniswap V3 Position Manager and WETH addresses;
- at the immutable 29 ETH market-cap target, curve backing seeds a full-range position and its LP NFT is minted directly to a no-withdrawal locker;
- curve trading stops permanently after graduation;
- buys and sells require a deadline and caller-selected minimum output;
- external token and ETH transfers are protected by a reentrancy lock and exact-balance checks.

Do not enable public third-party creation by modifying this deployment. That feature requires a separately reviewed contract version with creator identity, moderation, token discovery, and abuse controls.

## Deployment checklist

1. Run `npm test` and `npx solhint RareLaunchFactory.sol --quiet` from `contracts/`.
2. Deploy only the current `assets/RareLaunchFactory.json` bytecode with zero ETH.
3. Use the admin console to verify Factory version 4, official Uniswap addresses, and all immutable settings.
4. Publish and verify the exact `contracts/RareLaunchFactory.standard-input.json` source.
5. Fund only through a separate `buy` transaction after verifying the launched token address.
6. Start with a capped pilot amount and independently review on-chain accounting before wider use.

Automated tests reduce known implementation risk but are not a substitute for an independent professional smart-contract audit.
