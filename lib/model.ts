// Token Radar's peer-priced model (MODEL_VERSION 'radar-peer-1').
//
// The idea: a pre-token protocol is worth what the market already pays for the
// same kind of protocol that does have a token. For every category, the peer
// multiple is the median market-cap-per-TV L of the live-token protocols in
// that category, read straight out of the snapshot. A category with few live
// peers is shrunk toward the global median, so one odd peer cannot set the
// price, and every multiple is clamped to a sane band.
//
//   peer multiple  median(mcap/tvl) of the category's live peers, winsorised
//                  at 3.0, shrunk 8/9 toward the global median, clamped
//                  to [0.04, 1.20]
//   implied        round(tvl x peer x growth x maturity x chains)
//   growth         1 + clamp(change_7d, -60, 120) / 100 x 0.5
//   maturity       0.6 + min(age_days, 1095) / 1095 x 0.4
//   chains         1 + min(log2(chain count), 4) x 0.03
//
// Age is the days from listed_at to the snapshot's as_of; an unlisted age
// counts as 365 days. No protocol name is special-cased anywhere: the board
// is every launch candidate the snapshot holds, sorted by implied value.
//
// A launch candidate is a protocol that records no token and is not a
// wrapped, staked or bridged product of another protocol, and not a versioned
// duplicate. The watchlist is the floor (40 rows); the early radar is every
// other candidate below the watchlist floor, so the board covers the whole
// launchable set the snapshot holds, not just its top.

export const MODEL_VERSION = 'radar-peer-1';

/** The snapshot's ten fields, exactly as the frozen file carries them. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One scored board row, the shape the gate reads. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/**
 * One row for the dashboard, as a compact array so the page's data stays
 * small. Positions: 0 slug, 1 name, 2 category, 3 chains, 4 tvl_usd,
 * 5 change_7d, 6 age_days, 7 peer multiple, 8 growth multiplier,
 * 9 maturity multiplier, 10 chain multiplier, 11 implied value,
 * 12 on the watchlist (1/0).
 */
export type RadarRowArray = [
  string,
  string,
  string,
  string[],
  number,
  number | null,
  number | null,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** One live-token protocol for the page's set-aside view. Positions: 0 slug,
 *  1 name, 2 category, 3 chains, 4 tvl_usd, 5 change_7d, 6 mcap_usd. */
export type LiveRowArray = [string, string, string, string[], number, number | null, number];

/** Everything the dashboard needs, in one JSON value. */
export interface RadarData {
  model_version: string;
  as_of: string;
  floor_usd: number;
  watchlist_size: number;
  early_size: number;
  board_size: number;
  live_size: number;
  /** Peer table for the model panel: category -> [multiple, live peers, median]. */
  peers: Record<string, [number, number, number]>;
  rows: RadarRowArray[];
  live: LiveRowArray[];
}

// ---------------------------------------------------------------- constants

/** How strongly a thin category is pulled toward the global median. */
const SHRINK_K = 8;
/** No single live peer may price a category above this ratio. */
const WINSOR = 3.0;
/** The band every peer multiple is clamped to. */
const MULTIPLE_MIN = 0.04;
const MULTIPLE_MAX = 1.2;
/** Growth is clamped to this band of seven-day TVL change, in per cent. */
const GROWTH_FLOOR = -60;
const GROWTH_CAP = 120;
/** Growth's weight on the multiple. */
const GROWTH_WEIGHT = 0.5;
/** Maturity's floor and range, over this many days. */
const MATURITY_FLOOR = 0.6;
const MATURITY_RANGE = 0.4;
const MATURITY_DAYS = 1095;
/** Age when the snapshot records no listing date. */
const UNKNOWN_AGE_DAYS = 365;
/** Chain breadth's weight, per doubling, up to this many doublings. */
const CHAIN_WEIGHT = 0.03;
const CHAIN_DOUBLINGS = 4;
/** The farm's capital by TVL, and the hold by age. */
const CAPITAL_TIERS: Array<[number, number]> = [
  [5e9, 250],
  [1e9, 150],
  [1e8, 100],
];
const CAPITAL_DEFAULT = 50;
const HOLD_YOUNG_DAYS = 60;
const HOLD_MID_DAYS = 45;
const HOLD_OLD_DAYS = 30;
/** How many live-token protocols the set-aside view shows, by market cap. */
const LIVE_ROWS = 24;

// ---------------------------------------------------------------- snapshot

/** Parse and validate the frozen snapshot; protocols come out sorted by slug. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (typeof raw !== 'object' || raw === null) throw new Error('snapshot is not an object');
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) {
    throw new Error('snapshot as_of is not a YYYY-MM-DD date');
  }
  if (typeof raw.floor_usd !== 'number' || !(raw.floor_usd > 0)) {
    throw new Error('snapshot floor_usd is not a positive number');
  }
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot protocols/watchlist are not arrays');
  }
  const protocols = raw.protocols.slice().sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('snapshot protocol is missing slug, name or tvl_usd');
    }
    if (!Array.isArray(p.chains)) throw new Error(`snapshot protocol ${p.slug} has no chains array`);
  }
  return { as_of: raw.as_of, source: raw.source, floor_usd: raw.floor_usd, protocols, watchlist: raw.watchlist.slice() };
}

/** True when the snapshot records no token for the protocol. */
function hasNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that mark a wrapped, staked or bridged product, never a launch. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a product's name may not begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A version marker at the end of a name: "V2", "v2", "2.0" and the like. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * True when the protocol is a wrapped, staked or bridged product of another
 * protocol, a versioned duplicate, or an exchange product: not a protocol
 * still waiting on a launch of its own. This is the watchlist's own rule,
 * applied below the floor as well as on it.
 */
function isWrappedOrVersioned(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  const name = p.name;
  if (/\b(wrapped|staked|staking)\b/i.test(name)) return true;
  if (EXCHANGE_PREFIXES.some((x) => name.startsWith(x))) return true;
  if (VERSION_SUFFIX.test(name)) return true;
  return false;
}

/** True when the protocol could plausibly launch a token of its own. */
function isLaunchCandidate(p: SnapshotProtocol): boolean {
  return hasNoToken(p) && !isWrappedOrVersioned(p);
}

// ---------------------------------------------------------------- the model

/** Days between two YYYY-MM-DD dates, in UTC, never negative. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return UNKNOWN_AGE_DAYS;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** The protocol's age in days at the snapshot date; 365 when unlisted. */
function ageDays(p: SnapshotProtocol, asOf: string): number {
  if (p.listed_at === null) return UNKNOWN_AGE_DAYS;
  return daysBetween(p.listed_at, asOf);
}

/** The median of a sorted array of numbers. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) throw new Error('median of an empty list');
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The peer multiples: category -> [multiple, live peers, category median]. */
export interface PeerTable {
  byCategory: Map<string, [number, number, number]>;
  global: number;
}

function peerTable(protocols: SnapshotProtocol[]): PeerTable {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = Math.min(p.mcap_usd / p.tvl_usd, WINSOR);
    allRatios.push(ratio);
    const key = p.category ?? 'Other';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  allRatios.sort((a, b) => a - b);
  const global = median(allRatios);
  const byCategory = new Map<string, [number, number, number]>();
  for (const [key, list] of ratiosByCategory) {
    list.sort((a, b) => a - b);
    const med = median(list);
    const n = list.length;
    const multiple = Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, (n * med + SHRINK_K * global) / (n + SHRINK_K)));
    byCategory.set(key, [multiple, n, med]);
  }
  return { byCategory, global };
}

/** The peer multiple for a category, shrunk toward the global median. */
function peerMultiple(category: string | null, peers: PeerTable): number {
  const entry = peers.byCategory.get(category ?? 'Other');
  if (entry !== undefined) return entry[0];
  return Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, peers.global));
}

function growthMultiplier(change7d: number | null): number {
  const growth = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, change7d ?? 0));
  return 1 + (growth / 100) * GROWTH_WEIGHT;
}

function maturityMultiplier(age: number): number {
  return MATURITY_FLOOR + (Math.min(Math.max(age, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
}

function chainMultiplier(chains: string[]): number {
  return 1 + Math.min(Math.log2(Math.max(chains.length, 1)), CHAIN_DOUBLINGS) * CHAIN_WEIGHT;
}

/**
 * The implied value of a protocol: TVL priced at its category's peer
 * multiple, moved by seven-day growth, by how long it has run with no token,
 * and by how many chains it reaches. The same arithmetic, in the same order,
 * as the dashboard recomputes it from the row.
 */
function impliedValue(
  tvl: number,
  peer: number,
  growthMult: number,
  maturityMult: number,
  chainMult: number,
): number {
  return Math.max(1, Math.round(tvl * peer * growthMult * maturityMult * chainMult));
}

// ---------------------------------------------------------------- the farm

/** The farm's capital for a protocol, by its TVL. */
function capitalFor(tvl: number): number {
  for (const [floor, capital] of CAPITAL_TIERS) if (tvl >= floor) return capital;
  return CAPITAL_DEFAULT;
}

/** The hold, in days, for a protocol of this age. */
function holdDaysFor(age: number | null): number {
  if (age === null || age === undefined) return HOLD_OLD_DAYS;
  if (age < 180) return HOLD_YOUNG_DAYS;
  if (age < 365) return HOLD_MID_DAYS;
  return HOLD_OLD_DAYS;
}

/** The first chain a protocol's TVL sits on, for the farm's directions. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The main action for a protocol, by what kind of protocol it is. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open so it counts as a lender, not a passer-by.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through at least one fee cycle.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app, so the crossing is a real use.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the same wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge, then close it in profit or at a small loss.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and place one market position on an outcome you have actually read about.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares until the vault's next rebalance.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} through ${name} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy for its full term.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open through the next snapshot.`;
}

/** One farm step: the action plus its cost and time, 20 to 600 characters. */
function stepText(text: string, cost: string, time: string): string {
  const s = `${text} Cost: ${cost}. Time: ${time}.`;
  return s.length > 600 ? `${s.slice(0, 596)}...` : s;
}

/**
 * The six-step farm plan for a protocol. The steps are derived, never
 * hand-written per protocol: the category picks the action, the TVL picks
 * the capital, the age picks the hold. The dashboard derives the same six
 * steps from the same rules, so the page and the board always agree.
 */
export function farmSteps(p: SnapshotProtocol, asOf: string): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p.tvl_usd);
  const age = p.listed_at === null ? null : ageDays(p, asOf);
  const hold = holdDaysFor(age);
  return [
    stepText(
      'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ),
    stepText(
      actionFor(p, capital, chain),
      `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      '15 minutes to set up',
    ),
    stepText(
      'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet shows repeat activity.',
      `about $2 of gas a week on ${chain}`,
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      'no fee to check, and never pay to claim',
      '10 minutes',
    ),
    stepText(
      'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      'nothing but the log',
      '5 minutes',
    ),
  ];
}

// ---------------------------------------------------------------- the board

export interface BuiltRadar {
  board: BoardRow[];
  radar: RadarData;
}

/**
 * Build the board and the dashboard's data from a snapshot. The board is the
 * watchlist plus every other launch candidate below the watchlist floor,
 * each scored by the peer-priced model and ranked by implied value.
 */
export function buildRadar(snapshot: Snapshot): BuiltRadar {
  const peers = peerTable(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const scored: Array<{
    p: SnapshotProtocol;
    peer: number;
    growthMult: number;
    maturityMult: number;
    chainMult: number;
    implied: number;
    age: number;
  }> = [];
  for (const p of snapshot.protocols) {
    const onWatchlist = watchlist.has(p.slug);
    if (!onWatchlist) {
      if (!isLaunchCandidate(p)) continue;
      if (p.tvl_usd >= snapshot.floor_usd) continue;
    }
    const peer = peerMultiple(p.category, peers);
    const growthMult = growthMultiplier(p.change_7d);
    const age = ageDays(p, snapshot.as_of);
    const maturityMult = maturityMultiplier(age);
    const chainMult = chainMultiplier(p.chains);
    const implied = impliedValue(p.tvl_usd, peer, growthMult, maturityMult, chainMult);
    scored.push({ p, peer, growthMult, maturityMult, chainMult, implied, age });
  }
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });

  const board: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p, snapshot.as_of),
  }));

  const rows: RadarRowArray[] = scored.map((s, i) => [
    s.p.slug,
    s.p.name,
    s.p.category ?? 'Other',
    s.p.chains,
    s.p.tvl_usd,
    s.p.change_7d,
    s.p.listed_at === null ? null : s.age,
    s.peer,
    s.growthMult,
    s.maturityMult,
    s.chainMult,
    s.implied,
    watchlist.has(s.p.slug) ? 1 : 0,
  ]);

  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p): LiveRowArray => [p.slug, p.name, p.category ?? 'Other', p.chains, p.tvl_usd, p.change_7d, p.mcap_usd ?? 0]);

  const peersOut: Record<string, [number, number, number]> = {};
  for (const [key, value] of [...peers.byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    peersOut[key] = value;
  }

  const radar: RadarData = {
    model_version: MODEL_VERSION,
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length,
    early_size: rows.length - snapshot.watchlist.length,
    board_size: rows.length,
    live_size: live.length,
    peers: peersOut,
    rows,
    live,
  };
  return { board, radar };
}

/**
 * The gate's own checks on a board, in the same shape the scorer refuses:
 * null when the board passes, else the first reason it fails.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate wants`;
  if (board.length > 4000) return `the board holds ${board.length} rows, over the 4,000 the gate allows`;
  const seen = new Set<string>();
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} carries rank ${row.rank}, not ${i + 1}`;
    if (!bySlug.has(row.slug)) return `row ${row.slug} is not a protocol in the snapshot`;
    if (seen.has(row.slug)) return `row ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} carries implied value ${row.implied_value_usd}, outside 1 to 100,000,000,000,000`;
    }
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${row.slug} is worth more than the row ranked above it`;
    }
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} carries ${Array.isArray(row.farm_steps) ? row.farm_steps.length : 0} farm steps, not 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const trimmed = typeof step === 'string' ? step.trim() : '';
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} carries a farm step of ${trimmed.length} characters, outside 20 to 600`;
      }
    }
  }
  if (board.length > 1 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every row carries the same implied value';
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `the watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data as a script: `window.RADAR=<JSON>;`. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
