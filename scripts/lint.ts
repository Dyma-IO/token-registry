#!/usr/bin/env tsx
/**
 * Cross-file consistency checks that are awkward to express in JSON Schema:
 *  - folder name === chain.json#chain_name
 *  - assetlist.chain_name matches the parent folder
 *  - asset.display is one of the denom_units
 *  - asset.base appears at exponent 0
 *  - asset.base is unique within a chain
 *  - nft.collection_id is unique within a chain
 *  - IBC chain_1/chain_2 chain_names exist as folders in the matching network
 *  - IBC traces on assets resolve to a declared channel
 *  - every `ibc/<HASH>` denom is re-derived from its trace: HASH = SHA-256 of the
 *    trace path (`transfer/channel-N/<base_denom>`), upper-case hex
 *  - the chain side of an IBC trace is the same channel pair as the _IBC file
 *  - fee gas prices are ordered (fixed_min <= low <= average <= high) and never
 *    below the chain's floor (scripts/fee-floors.json, verified on chain)
 *  - explorer templates carry the ${txHash} / ${accountAddress} placeholders
 *  - addresses (factory creators, cw20/cw721 contracts, NFT creators) are valid
 *    bech32 with the chain's prefix
 *  - images hosted in this repo (raw.githubusercontent.com URLs) exist on disk
 */
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors: string[] = [];

async function loadJson<T = any>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function isDir(p: string) {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function exists(p: string) {
  try { await access(p); return true; } catch { return false; }
}

const NETWORKS = ["mainnet", "testnet", "devnet"] as const;

type Trace = {
  type?: string;
  counterparty: { chain_name: string; base_denom?: string; channel_id?: string; port?: string };
  chain?: { channel_id?: string; port?: string; path?: string };
};
type Asset = {
  type_asset: string;
  base: string;
  display: string;
  address?: string;
  denom_units: Array<{ denom: string; exponent: number }>;
  traces?: Trace[];
};
type AssetList = { chain_name: string; assets: Asset[] };
type Nft = {
  collection_id: string;
  contract_address?: string;
  minter?: string;
  creator?: { address?: string };
  royalties?: { payment_address?: string };
};
type NftList = { chain_name: string; assets: Nft[] };
type FeeToken = {
  denom: string;
  fixed_min_gas_price?: number;
  low_gas_price?: number;
  average_gas_price?: number;
  high_gas_price?: number;
};
type Chain = {
  chain_name: string;
  chain_id: string;
  network_type: string;
  bech32_prefix: string;
  fees?: { fee_tokens?: FeeToken[] };
  explorers?: Array<{ url: string; tx_page?: string; account_page?: string }>;
};
type Ibc = {
  chain_1: { chain_name: string };
  chain_2: { chain_name: string };
  channels: Array<{
    chain_1: { channel_id: string; port_id: string };
    chain_2: { channel_id: string; port_id: string };
  }>;
};
type FeeFloors = { floors: Record<string, Record<string, { min: number; source: string }>> };

// ---- bech32 (BIP-173), enough to check the checksum and read the prefix ----
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
/** The human-readable prefix of a valid bech32 string, or null when it is not valid bech32. */
function bech32Prefix(addr: string): string | null {
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return null;
  const s = addr.toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep + 7 > s.length || s.length > 90) return null;
  const hrp = s.slice(0, sep);
  const expanded: number[] = [];
  for (const ch of hrp) expanded.push(ch.charCodeAt(0) >> 5);
  expanded.push(0);
  for (const ch of hrp) expanded.push(ch.charCodeAt(0) & 31);
  for (const ch of s.slice(sep + 1)) {
    const d = BECH32_CHARSET.indexOf(ch);
    if (d === -1) return null;
    expanded.push(d);
  }
  return bech32Polymod(expanded) === 1 ? hrp : null;
}

function checkAddress(where: string, label: string, address: string | undefined, prefix: string) {
  if (address === undefined) return;
  const hrp = bech32Prefix(address);
  if (hrp === null) errors.push(`${where} — ${label} "${address}" is not a valid bech32 address`);
  else if (hrp !== prefix) errors.push(`${where} — ${label} "${address}" has prefix "${hrp}", expected "${prefix}"`);
}

/** `ibc/<HASH>` for an ICS-20 trace path, the way ibc-go derives it. */
function ibcDenomFor(path: string): string {
  return "ibc/" + createHash("sha256").update(path).digest("hex").toUpperCase();
}

// Images hosted in this repo: the URL path after the branch must exist on disk.
const REPO_RAW_PREFIX = /^https:\/\/raw\.githubusercontent\.com\/Safrochain-Org\/token-registry\/main\//;
async function checkRepoImages(where: string, value: unknown): Promise<void> {
  if (typeof value === "string") {
    if (REPO_RAW_PREFIX.test(value)) {
      const rel = value.replace(REPO_RAW_PREFIX, "");
      if (!(await exists(resolve(ROOT, rel)))) errors.push(`${where} — image "${rel}" is referenced but not in the repo`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) await checkRepoImages(where, v);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) await checkRepoImages(where, v);
  }
}

const feeFloors = await loadJson<FeeFloors>(resolve(ROOT, "scripts/fee-floors.json"));
const PRICE_KEYS = ["fixed_min_gas_price", "low_gas_price", "average_gas_price", "high_gas_price"] as const;

const chainsByNet: Record<string, Set<string>> = { mainnet: new Set(), testnet: new Set(), devnet: new Set() };

for (const net of NETWORKS) {
  const netDir = resolve(ROOT, net);
  if (!(await isDir(netDir))) continue;
  const entries = await readdir(netDir);

  for (const folder of entries) {
    const folderPath = resolve(netDir, folder);
    if (!(await isDir(folderPath))) continue;

    const chainPath = resolve(folderPath, "chain.json");
    let chain: Chain;
    try {
      chain = await loadJson<Chain>(chainPath);
    } catch {
      errors.push(`${net}/${folder}/chain.json — missing or unreadable`);
      continue;
    }

    if (chain.chain_name !== folder) {
      errors.push(`${net}/${folder}/chain.json — chain_name "${chain.chain_name}" does not match folder "${folder}"`);
    }
    if (chain.network_type !== net) {
      errors.push(`${net}/${folder}/chain.json — network_type "${chain.network_type}" does not match parent folder "${net}"`);
    }
    chainsByNet[net].add(folder);
    await checkRepoImages(`${net}/${folder}/chain.json`, chain);

    // ---- fees: ordered, and never below the chain's verified floor ----
    for (const token of chain.fees?.fee_tokens ?? []) {
      const where = `${net}/${folder}/chain.json — fee token "${token.denom}"`;
      const present = PRICE_KEYS.filter((k) => typeof token[k] === "number");
      for (let i = 1; i < present.length; i++) {
        const prev = present[i - 1];
        const cur = present[i];
        if ((token[cur] as number) < (token[prev] as number)) {
          errors.push(`${where}: ${cur} ${token[cur]} is below ${prev} ${token[prev]}`);
        }
      }
      const floor = feeFloors.floors[chain.chain_id]?.[token.denom];
      if (floor) {
        for (const k of present) {
          if ((token[k] as number) < floor.min) {
            errors.push(`${where}: ${k} ${token[k]} is below the chain minimum ${floor.min}${token.denom} (${floor.source})`);
          }
        }
      }
    }

    // ---- explorer templates ----
    for (const ex of chain.explorers ?? []) {
      if (ex.tx_page !== undefined && !ex.tx_page.includes("${txHash}")) {
        errors.push(`${net}/${folder}/chain.json — explorer ${ex.url} tx_page has no \${txHash} placeholder`);
      }
      if (ex.account_page !== undefined && !ex.account_page.includes("${accountAddress}")) {
        errors.push(`${net}/${folder}/chain.json — explorer ${ex.url} account_page has no \${accountAddress} placeholder`);
      }
    }

    // ---- assetlist ----
    try {
      const al = await loadJson<AssetList>(resolve(folderPath, "assetlist.json"));
      const where = `${net}/${folder}/assetlist.json`;
      if (al.chain_name !== folder) errors.push(`${where} — chain_name "${al.chain_name}" ≠ folder`);
      await checkRepoImages(where, al);

      const seenBases = new Set<string>();
      for (const a of al.assets) {
        if (seenBases.has(a.base)) errors.push(`${where} — duplicate base "${a.base}"`);
        seenBases.add(a.base);

        const denoms = new Set(a.denom_units.map(u => u.denom));
        if (!denoms.has(a.display)) errors.push(`${where} — asset "${a.base}" display "${a.display}" not in denom_units`);

        const zero = a.denom_units.find(u => u.exponent === 0);
        if (!zero) errors.push(`${where} — asset "${a.base}" has no exponent-0 denom_unit`);
        else if (zero.denom !== a.base) errors.push(`${where} — asset "${a.base}" exponent-0 denom "${zero.denom}" must equal base`);

        // ibc/<HASH> must be the hash of the trace path that brought it here.
        if (a.base.startsWith("ibc/") || a.type_asset === "ics20") {
          const ibcTraces = (a.traces ?? []).filter(t => t.type === "ibc");
          const last = ibcTraces[ibcTraces.length - 1];
          if (!a.base.startsWith("ibc/")) {
            errors.push(`${where} — ics20 asset "${a.base}" must have an ibc/<hash> base`);
          } else if (!last?.chain?.path) {
            errors.push(`${where} — asset "${a.base}" needs an ibc trace with chain.path to re-derive its hash`);
          } else {
            const path = last.chain.path;
            const derived = ibcDenomFor(path);
            if (derived !== a.base) {
              errors.push(`${where} — asset "${a.base}" does not match its trace: sha256("${path}") = ${derived}`);
            }
            const port = last.chain.port ?? "transfer";
            if (!last.chain.channel_id || !path.startsWith(`${port}/${last.chain.channel_id}/`)) {
              errors.push(`${where} — asset "${a.base}" trace path "${path}" does not start with ${port}/${last.chain.channel_id}/`);
            }
            const origin = last.counterparty.base_denom;
            const expectedPath = `${port}/${last.chain.channel_id}/${origin}`;
            if (origin && !origin.startsWith("ibc/") && path !== expectedPath) {
              errors.push(`${where} — asset "${a.base}" trace path "${path}" should be "${expectedPath}" (port/channel/counterparty base_denom)`);
            }
          }
        }

        // tokenfactory denoms: factory/<creator>/<subdenom>, creator on this chain
        if (a.type_asset === "factory") {
          const parts = a.base.split("/");
          if (parts.length < 3 || parts[0] !== "factory") {
            errors.push(`${where} — factory asset "${a.base}" must look like factory/<creator>/<subdenom>`);
          } else {
            checkAddress(where, `factory creator of "${a.base}"`, parts[1], chain.bech32_prefix);
            if (a.address !== undefined && a.address !== parts[1]) {
              errors.push(`${where} — factory asset "${a.base}" address "${a.address}" is not its creator "${parts[1]}"`);
            }
          }
        } else {
          checkAddress(where, `address of "${a.base}"`, a.address, chain.bech32_prefix);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // assetlist optional but recommended; warn rather than error
        console.warn(`note: ${net}/${folder}/assetlist.json missing`);
      } else {
        errors.push(`${net}/${folder}/assetlist.json — ${(err as Error).message}`);
      }
    }

    // ---- nft list ----
    try {
      const nl = await loadJson<NftList>(resolve(folderPath, "nft-assetlist.json"));
      const where = `${net}/${folder}/nft-assetlist.json`;
      if (nl.chain_name !== folder) errors.push(`${where} — chain_name "${nl.chain_name}" ≠ folder`);
      await checkRepoImages(where, nl);
      const seenIds = new Set<string>();
      for (const c of nl.assets) {
        if (seenIds.has(c.collection_id)) errors.push(`${where} — duplicate collection_id "${c.collection_id}"`);
        seenIds.add(c.collection_id);
        const label = `collection "${c.collection_id}"`;
        checkAddress(where, `${label} contract_address`, c.contract_address, chain.bech32_prefix);
        checkAddress(where, `${label} minter`, c.minter, chain.bech32_prefix);
        checkAddress(where, `${label} creator.address`, c.creator?.address, chain.bech32_prefix);
        checkAddress(where, `${label} royalties.payment_address`, c.royalties?.payment_address, chain.bech32_prefix);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.warn(`note: ${net}/${folder}/nft-assetlist.json missing`);
      } else {
        errors.push(`${net}/${folder}/nft-assetlist.json — ${(err as Error).message}`);
      }
    }
  }
}

// ---- _IBC ----
const ibcFiles = await fg("_IBC/*.json", { cwd: ROOT, absolute: true });
const ibcChannelsByChain: Record<string, Set<string>> = {};
/** "<chain>|<counterparty>" -> channel pairs as seen from <chain>: "<own channel>|<counterparty channel>" */
const ibcPairs = new Map<string, Set<string>>();
function addIbcPair(chain: string, counterparty: string, own: string, theirs: string) {
  const key = `${chain}|${counterparty}`;
  if (!ibcPairs.has(key)) ibcPairs.set(key, new Set());
  ibcPairs.get(key)!.add(`${own}|${theirs}`);
}

for (const f of ibcFiles) {
  const ibc = await loadJson<Ibc>(f);
  const a = ibc.chain_1.chain_name;
  const b = ibc.chain_2.chain_name;

  const expected = [a, b].sort().join("-") + ".json";
  if (basename(f) !== expected) errors.push(`_IBC/${basename(f)} — filename must be ${expected} (alphabetical)`);

  // both chains must exist in one matching network (mainnet↔mainnet, testnet↔testnet)
  const matchingNet = NETWORKS.find(n => chainsByNet[n].has(a) && chainsByNet[n].has(b));
  if (!matchingNet) errors.push(`_IBC/${basename(f)} — chains "${a}" and "${b}" are not both declared in the same network folder`);

  for (const ch of ibc.channels) {
    (ibcChannelsByChain[a] ??= new Set()).add(ch.chain_1.channel_id);
    (ibcChannelsByChain[b] ??= new Set()).add(ch.chain_2.channel_id);
    addIbcPair(a, b, ch.chain_1.channel_id, ch.chain_2.channel_id);
    addIbcPair(b, a, ch.chain_2.channel_id, ch.chain_1.channel_id);
  }
}

// ---- asset traces must point at declared IBC channels (both ends of the same channel) ----
const assetlists = await fg(["mainnet/*/assetlist.json", "testnet/*/assetlist.json", "devnet/*/assetlist.json"], { cwd: ROOT, absolute: true });
for (const f of assetlists) {
  const al = await loadJson<AssetList>(f);
  const rel = f.replace(ROOT + "/", "");
  for (const a of al.assets) {
    for (const t of a.traces ?? []) {
      if (t.counterparty?.channel_id) {
        const remote = t.counterparty.chain_name;
        const ch = t.counterparty.channel_id;
        if (!ibcChannelsByChain[remote]?.has(ch)) {
          errors.push(`${rel} — asset "${a.base}" trace counterparty channel ${remote}/${ch} not found in _IBC/`);
        }
      }
    }
    // The hop onto this chain: (this chain's channel, counterparty channel) must be one channel of the _IBC file.
    const ibcTraces = (a.traces ?? []).filter(t => t.type === "ibc");
    const last = ibcTraces[ibcTraces.length - 1];
    if (last?.chain?.channel_id && last.counterparty?.channel_id) {
      const pairs = ibcPairs.get(`${al.chain_name}|${last.counterparty.chain_name}`);
      const want = `${last.chain.channel_id}|${last.counterparty.channel_id}`;
      if (!pairs?.has(want)) {
        errors.push(`${rel} — asset "${a.base}" trace ${al.chain_name}/${last.chain.channel_id} ↔ ${last.counterparty.chain_name}/${last.counterparty.channel_id} is not a channel of _IBC/${[al.chain_name, last.counterparty.chain_name].sort().join("-")}.json`);
      }
    }
  }
}

if (errors.length) {
  console.error(`\n${errors.length} lint error(s):`);
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
}
console.log(`Lint clean — ${Object.values(chainsByNet).reduce((s, set) => s + set.size, 0)} chain(s), ${ibcFiles.length} IBC file(s).`);
