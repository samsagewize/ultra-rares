# Ultra Rares utility contracts

This package is the first testnet milestone for the utility architecture:

`Ultra Rares NFT → Utility Registry → Reward Vault → NFT-linked account`

`UtilityRegistry.sol` never transfers, escrows, burns, or modifies the existing NFT. It reads `ownerOf` from the deployed Ultra Rares collection and stores opt-in utility state alongside it.

## Recorded state

- Activation and linked-account address
- Tier from 1–4
- Up to three allowlisted reward assets
- Reward accrual checkpoints maintained by the Reward Vault
- Append-only fusion records maintained by a separate fusion controller

## Roles

- **NFT holder:** activates a token and selects reward assets.
- **Owner:** configures allowlisted assets and controller addresses, can pause, and uses two-step ownership transfer.
- **Reward Vault:** checkpoints/debits reward accounting and updates tiers.
- **Fusion controller:** records completed fusion events and may update a resulting NFT's tier.

## Robinhood Chain configuration

- Mainnet chain ID: `4663`
- Testnet chain ID: `46630`
- Existing Ultra Rares contract: `0x923aaaa62c12505b1bbb57ed52b730d6462c01c5`

Deploy to testnet first. The constructor arguments are the NFT collection address and a multisig/admin address. Configure the Reward Vault, fusion controller, and reward-asset allowlist only after those components have been independently tested.

## Security boundary

The registry deliberately holds no ETH, ERC-20s, or NFTs. Reward funding and payouts belong in a separate vault with its own accounting, solvency checks, and audit. Fusion must be executed by another contract before its result is recorded here.

This is prototype code, not audited production code.

## Reward Vault and RARE token

`UltraRaresToken.sol` contains the fixed-cap `RareToken` ERC-20. Its public name is **Rare Token** and its symbol is **RARE**. Transfers begin disabled and can only be enabled irreversibly by the owner after separate legal and security review. The configured Reward Vault alone can mint or burn tokens.

`RewardVault.sol` provides two steps:

1. The current NFT owner converts reward accrual already recorded in the Utility Registry into RARE.
2. The holder burns RARE for an enabled reward asset already held by the vault.
3. The owner can batch-airdrop RARE to holder addresses, always subject to the token's fixed maximum supply.

For the prototype, the vault owner checkpoints reward accrual. Production must replace that authority with a narrowly bounded keeper/oracle role and auditable emission limits.

The vault cannot mint Stock Tokens. It only transfers existing ERC-20 inventory. It supports a replaceable eligibility module because Robinhood Stock Tokens are regulated tokenized debt securities with geographic and investor restrictions. A failed transfer reverts the entire redemption, including the credit burn.

Asset exchange rates in this prototype are administrator-configured. Do not use them on mainnet. A production implementation needs delayed, oracle-governed rates that correctly handle Stock Token corporate-action multipliers, trading halts, decimals, inventory capacity, and eligibility.

## Proposed Last Rares launch architecture

This is the recorded product direction, not yet implemented or approved for mainnet:

1. Deploy the fixed-cap **RARE** token with immutable allocations for the liquidity curve, Ultra Rares holder airdrop, team vesting, and ecosystem treasury.
2. Let existing Ultra Rares holders claim the airdrop once per eligible NFT from a snapshot-based distributor.
3. Deploy a separate **Last Rares** ERC-721 collection and pre-mint its full supply directly to a custody vault.
4. The vault approves only the auction contract. Last Rares cannot be sold through a public mint and leave the vault only after a completed auction.
5. Auctions accept RARE only. Winning RARE is routed according to a published policy; losing bids are claimable back by their bidders.
6. Team tokens use an onchain vesting schedule rather than an immediately spendable wallet allocation.

Before implementation, fix the Last Rares supply, RARE maximum supply, allocation percentages, vesting period, curve design, auction format, reserve price, auction duration, and per-wallet limits. These parameters must not be improvised at deployment time.
