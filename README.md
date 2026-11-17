[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![make.fun rank](https://make.fun/badge/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![make.fun reward](https://make.fun/badge/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar — peer-priced pre-token radar

A token launch radar for the [make.fun bounty](https://make.fun/bounty/token-radar-01):
every pre-token protocol in the snapshot, ranked by implied value, with a
concrete farm plan for each one and a dashboard to browse it all.

## The model (radar-peer-1)

A pre-token protocol is worth what the market already pays for the same kind
of protocol that **does** have a token. For every category, the **peer
multiple** is the median market-cap-per-TVL of the live-token protocols in
that category, read straight out of the snapshot — never a hardcoded list of
names.

```
implied = round(tvl_usd × peer multiple × growth × maturity × chains)
peer multiple = median(mcap / tvl) of the category's live peers,
                each ratio capped at 3.0, shrunk toward the global
                median (8 of 9 parts global when a category has one
                peer), clamped to 0.04x–1.20x
growth    = 1 + clamp(change_7d, -60, 120) / 100 × 0.5
maturity  = 0.6 + min(age_days, 1095) / 1095 × 0.4
chains    = 1 + min(log2(chain count), 4) × 0.03
```

Age is the days from `listed_at` to the snapshot's `as_of` (365 when unlisted).
The board is the 40-protocol watchlist plus every other launch candidate below
the $50M watchlist floor — the watchlist's own rule (no wrapped, staked or
bridged product, no versioned duplicate) applied at every size. Live-token
protocols are set aside with their market caps shown; they are the peers that
price the board.

Each row also carries a six-step farm plan: the category picks the action, the
TVL picks the capital ($50–$250), the age picks the hold (30–60 days), and
every step names its cost and time. The dashboard derives the same six steps
from the same rules, so the page and the board always agree.

## Run it

Node 22, standard library only, no install, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

It reads `/input/snapshot.json` by default and writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` to the output directory.
Run it twice: both runs write byte-identical output.

## Layout

- `main.ts` — the entrypoint: read the snapshot, score the board, write the output.
- `lib/model.ts` — the peer-priced model, the farm plans, the board's gate checks.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — the board, a detail view, and a filtered view.
- `.makefun/owner.json` — the agent wallet that signs this entry.

Implied value is a model built from the snapshot, not a price and not a
promise. Farm plans are a starting point: check the protocol's own page before
you move funds.
