# Contributing to the Safrochain Token Registry

Thanks for adding your asset! Please read this short guide before opening a PR
— it keeps the review loop fast and protects users in Safrimba and the Hub from
broken or malicious listings.

## Ground rules

1. **One PR per change.** A single PR may add one chain, one token, or one NFT
   collection. Mixed PRs are slower to review.
2. **No paid placements.** `safrimba.rank` and `safrimba.featured` are set by
   Safrimba editors after listing. Leave them out of your initial PR.
3. **Use real, working URLs.** RPC/REST endpoints in `apis` must respond on
   submission. Logo URLs must serve a valid image (or use the relative
   `./images/<file>` form and commit the file).
4. **Don't impersonate.** Symbols, names, and logos that clone an existing
   asset will be rejected.

## Adding a chain

```
mainnet/<chain_name>/
├── chain.json              copy from templates/chain.template.json
├── assetlist.json          at least the native token
├── nft-assetlist.json      {"chain_name":"<chain_name>","assets":[]} is fine
└── images/
    └── <symbol>.png        ≥256×256, transparent background preferred
```

`chain_name` MUST be lowercase, ASCII, hyphen/underscore allowed, and MUST
equal the folder name.

## Adding a token

Open `<network>/<chain>/assetlist.json` and append to `assets[]`. Required
fields:

| field         | notes                                                                        |
| ------------- | ---------------------------------------------------------------------------- |
| `type_asset`  | `sdk.coin` (native), `ics20` (IBC), `cw20`, `factory`, `erc20`               |
| `base`        | on-chain denom (e.g. `usaf`, `ibc/...`, `factory/...`, contract address)     |
| `display`     | human denom — MUST appear in `denom_units`                                   |
| `denom_units` | include an `exponent: 0` entry whose `denom` equals `base`                   |
| `symbol`      | uppercase ASCII, ≤ 16 chars                                                  |
| `logo_URIs`   | at least one of `png` or `svg`                                               |

For **IBC‑bridged tokens** include a `traces` entry pointing at the source
chain and channel; the linter verifies the channel is declared in `_IBC/`
(both ends of the same channel) and **re-derives the denom**: `base` must equal
`"ibc/" + SHA-256(traces[-1].chain.path)` in upper-case hex, where the path is
`transfer/<channel on this chain>/<counterparty base_denom>`. Check the result on
chain before opening the PR:

```bash
curl -s "$REST/ibc/apps/transfer/v1/denom_traces/<HASH>"                 # path + base_denom
curl -s "$REST/cosmos/bank/v1beta1/supply/by_denom?denom=ibc/<HASH>"      # non-zero supply
```

For **tokenfactory tokens** (`factory/<creator>/<subdenom>`) the creator must
be a valid address of the chain, and `address`, when set, must be that creator.

## Fees

`fees.fee_tokens[]` prices must be ordered (`fixed_min_gas_price` ≤ `low` ≤
`average` ≤ `high`) and never below the chain's minimum recorded in
`scripts/fee-floors.json` (Safrochain mainnet: x/globalfee `0.05usaf`). Wallets
build transactions from these numbers: a price below the floor is rejected by
the network. Only change a floor with live evidence (`/gaia/globalfee/v1beta1/minimum_gas_prices`
and `/cosmos/base/node/v1beta1/config` on the chain's REST endpoint).

## Endpoints and explorers

Only list endpoints that answer for the right `chain_id` (REST `node_info`, RPC
`/status`, gRPC with a valid TLS certificate). Explorer `tx_page` must contain
`${txHash}` and `account_page` `${accountAddress}`; open both with a real
transaction and address before submitting.

## Adding an NFT collection

Open `<network>/<chain>/nft-assetlist.json` and append to `assets[]`. For
`cw721`/`cw2981`/`sg721` you MUST set `contract_address`. Place artwork under
`images/nft/<collection_id>/{logo,banner,preview-N}.png`. Every address
(`contract_address`, `minter`, `creator.address`, `royalties.payment_address`)
must be a real bech32 address of the chain, and every image hosted in this repo
must exist: the linter fails otherwise. Never mark a collection `verified` or
`featured` before it is deployed and checked on chain.

## Adding an IBC path

Create `_IBC/<chain_a>-<chain_b>.json` — chain names in **alphabetical order**
joined with a single hyphen. Use `templates/ibc.template.json` as starter.
Both `chain_a` and `chain_b` MUST already have a `chain.json` in the same
network folder (`mainnet/` or `testnet/`).

## Before opening the PR

```bash
pnpm install
pnpm check       # validate + lint + build
```

If `pnpm check` is clean, you're good. CI runs the same command on every PR.

## Image guidelines

| asset      | format     | min size | max size |
| ---------- | ---------- | -------- | -------- |
| token      | PNG or SVG | 256×256  | 100 KB   |
| nft logo   | PNG or SVG | 400×400  | 200 KB   |
| nft banner | PNG        | 1500×500 | 600 KB   |

Place the PNG with the same basename as the SVG so consumers can pick either.

### Image URL convention

All `logo_URIs`, `images[]`, `banner_URI`, and `preview_images[]` entries MUST
use the **full GitHub raw URL** so third‑party consumers (Keplr, Mintscan,
Safrimba, …) can fetch logos without cloning the repo:

```
https://raw.githubusercontent.com/Safrochain-Org/token-registry/main/<network>/<chain_name>/images/<file>
```

If you've added or moved images and want the URLs regenerated mechanically,
drop relative `./images/<file>` paths into your edit and run:

```bash
pnpm rewrite-image-urls       # rewrites every relative ./images/... in place
# or, for a fork:
REGISTRY_REPO="myorg/token-registry" REGISTRY_BRANCH="main" pnpm rewrite-image-urls
```

The script is idempotent — already‑absolute URLs are left untouched.

## Review SLA

Most PRs land within 48 hours. Verified projects (audited contracts, real
trading volume) are fast‑tracked.
