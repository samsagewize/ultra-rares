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

## Inventory-backed NFT claim vault

`RareNftClaimVault.sol` is the claim contract for the already-deployed RARE token. It does not mint tokens. The owner explicitly approves and deposits RARE inventory, configures a default amount per NFT plus optional token-specific overrides, locks the allocation schedule, and starts a fixed 30-day claim window.

Each Ultra Rares token ID can claim once. Ownership is checked at claim time, so the connected wallet must still own the NFT. Claim state follows the NFT token ID rather than a wallet, preventing a transferred NFT from claiming twice.

Mainnet constructor configuration:

- Ultra Rares NFT: `0x923aaaa62c12505b1bbb57ed52b730d6462c01c5`
- RARE token: `0x1d522a4c3e1f3d97b585903474b2544cf9feeffb`
- Vault administrator: `0x562F6ac10723ef6AF9F077A83cF25135FB369612`

Exact constructor argument order:

1. `collection_`: `0x923aaaa62c12505b1bbb57ed52b730d6462c01c5`
2. `rareToken_`: `0x1d522a4c3e1f3d97b585903474b2544cf9feeffb`
3. `owner_`: `0x562F6ac10723ef6AF9F077A83cF25135FB369612`

Recommended launch order:

1. Deploy and verify the vault on Robinhood Chain.
2. Set the default reward and any per-token overrides.
3. Approve only the exact RARE funding amount, then call `fund`.
4. Reconcile vault inventory against the complete allocation schedule.
5. Call `lockAllocations` only after review.
6. Call `enableClaims` only after an independent security review. This starts an exact 30-day claim window that cannot be extended.
7. After the deadline, the administrator may call `withdrawAfterDeadline(recipient)` to recover all unclaimed RARE. Claims cannot be made after the deadline.

Current equal allocation plan (RARE uses 18 decimals):

- Eligible NFT supply: `420`
- Reward per NFT: `65,933 RARE` (`65933000000000000000000` base units)
- Exact required vault inventory: `27,691,860 RARE` (`27691860000000000000000000` base units)
- Tokens remaining from the stated `27,691,955 RARE` balance: `95 RARE`

The contract reads `totalSupply()` during deployment and refuses any collection whose supply is not exactly 420. Claims also stop if that supply later changes, preventing newly minted IDs from consuming the original holders' allocation. It validates every token-specific override against `ownerOf`, accounts for the amount actually received when funding, exposes `requiredInventory()`, and refuses to enable claims unless the vault can cover every configured allocation. A direct ERC-20 transfer to the vault is recognized as inventory, but the recommended funding flow is an exact approval followed by `fund(amount)` so the deposit emits a dedicated event.

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

## Ultra Rares RARE marketplace

`RareMarketplace.sol` is a non-custodial, fixed-price marketplace dedicated to the existing Ultra Rares NFT and RARE token. A seller keeps the NFT in their wallet, approves the marketplace for that token ID, and creates a listing denominated in RARE. At purchase, RARE transfers directly from buyer to seller and the NFT transfers directly from seller to buyer in one atomic transaction.

The contract has no administrator, custody wallet, marketplace fee, or upgrade mechanism. A listing becomes unbuyable if the seller transfers the NFT or revokes approval. Reentrancy protection covers the purchase path, and listing state is deleted before either external transfer.

Mainnet constructor configuration:

- Ultra Rares NFT: `0x923aaaa62c12505b1bbb57ed52b730d6462c01c5`
- RARE token: `0x1d522a4c3e1f3d97b585903474b2544cf9feeffb`

Deploy and test on Robinhood Chain testnet first. The public marketplace interface remains disabled until the reviewed mainnet contract address is placed in `marketplace.html`.
