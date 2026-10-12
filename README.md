# Safrochain Token Registry

The canonical, source-of-truth registry of every **chain**, **fungible token**,
**NFT collection**, and **IBC path** that should appear in
[Safrimba](https://safrimba.safrochain.com), [Safrochain Hub](https://hub.safrochain.com),
Audoswap, Keplr, Leap, block explorers, and any other client built on top of Safrochain.

It follows the [Cosmos chain‑registry](https://github.com/cosmos/chain-registry)
layout so existing tooling (`@chain-registry/*`, CosmosKit, Keplr Suggest‑Chain,
Skip API, etc.) can consume it without adaptation. We extend it with
**NFT assetlists** (`nft-assetlist.json`) and a richer **`safrimba` metadata**
block used by the Safrimba explorer/wallet for rich listings (logos, banners,
socials, audits, ranks, …).

---

## Layout

```
token-registry/
├── schemas/                       JSON Schemas (Draft‑2020‑12)
│   ├── chain.schema.json
│   ├── assetlist.schema.json
│   ├── nft-assetlist.schema.json
│   └── ibc.schema.json
├── templates/                     Copy-paste starter files for contributors
├── _IBC/                          IBC channel definitions (cosmos chain-registry _IBC/ format)
│   └── safrochain-osmosistestnet.json
├── mainnet/
│   └── <chain_name>/
│       ├── chain.json             Chain definition
│       ├── assetlist.json         Fungible tokens (native, factory, cw20, ics20)
│       ├── nft-assetlist.json     NFT collections (cw721, ics721, native)
│       └── images/                Logos: <denom>.png / <denom>.svg
├── testnet/
│   └── <chain_name>/...
├── scripts/                       Tooling
│   ├── validate.ts                Validate every file against its schema
│   ├── build-index.ts             Produce `dist/registry.json` for consumers
│   ├── lint.ts                    Cross‑file consistency checks (IBC denom hashes,
│   │                              channel pairs, fee floors, explorer templates,
│   │                              bech32 addresses, repo-hosted images)
│   └── fee-floors.json            Per-chain minimum gas prices, verified on chain
├── dist/                          Generated (gitignored except for `dist/.gitkeep`)
└── .github/workflows/validate.yml CI validation on every PR
```

Each chain folder is keyed by **`chain_name`** (lowercase, no spaces — e.g. `safrochain`,
`osmosistestnet`, `nobletestnet`). The folder name MUST match `chain.json`'s `chain_name`.

---

## Quick start

```bash
# from token-registry/
pnpm install              # installs ajv + tsx
pnpm validate             # validates every chain/asset/nft/ibc file vs schema
pnpm lint                 # cross-file consistency checks: ibc/<hash> = sha256(trace path),
                          # channel pairs, fee prices >= chain floor, explorer templates,
                          # bech32 addresses, images present
pnpm build                # writes dist/registry.json
```

Consumers (Safrimba, Safrochain Hub) fetch
`https://registry.safrochain.com/dist/registry.json` (or import the JSON files
directly through their build pipeline — Vite glob, Webpack, etc.).

---

## Add a new token (fungible)

1. Open `mainnet/<chain_name>/assetlist.json`.
2. Append an entry under `assets[]` following the schema (see
   `templates/assetlist.template.json` for a copy‑paste starter).
3. Drop a logo at `mainnet/<chain_name>/images/<symbol-lower>.png` (≥ 256×256,
   < 100 KB) and ideally an SVG of the same name.
4. Run `pnpm validate && pnpm lint`. Open a PR.

Minimum required fields: `base`, `name`, `display`, `symbol`, `denom_units`,
`type_asset`, `logo_URIs`.

## Add a new NFT collection

1. Open `mainnet/<chain_name>/nft-assetlist.json`.
2. Append under `assets[]`. Required: `collection_id`, `name`, `symbol`,
   `standard` (`cw721` | `ics721` | `native`), `contract_address` (if `cw721`),
   `creator`, `logo_URIs`.
3. Add images under `images/nft/<collection_id>/{logo,banner}.png`.
4. Run `pnpm validate && pnpm lint`.

## Add an IBC path

Create `_IBC/<chain_a>-<chain_b>.json` (alphabetical order of `chain_name`).
See `templates/ibc.template.json`.

---

## Why a separate repo?

- **Single source of truth** — Safrimba, the Hub, Audoswap, Keplr suggestions,
  the Cosmos chain‑registry mirror, and third‑party indexers all point at the
  same files. No drift.
- **Permissive review** — Token/NFT issuers open PRs here without touching
  product code.
- **CI‑enforced** — every PR is schema‑validated; broken entries can't merge.

---

## License

Apache‑2.0 — see [`LICENSE`](LICENSE).
