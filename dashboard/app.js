// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail drawer with the model's own inputs and the protocol's
// farm plan. No network: every byte it shows is in data.js.
//
// A row is a compact array. Positions: 0 slug, 1 name, 2 category,
// 3 chains, 4 tvl_usd, 5 change_7d, 6 age_days, 7 peer multiple,
// 8 growth multiplier, 9 maturity multiplier, 10 chain multiplier,
// 11 implied value, 12 on the watchlist (1/0). A live row: 0 slug, 1 name,
// 2 category, 3 chains, 4 tvl_usd, 5 change_7d, 6 mcap_usd.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number the board carries, so the page's code and
  // the board's data are visibly the same arithmetic. Same order as
  // lib/model.ts: tvl x peer x growth x maturity x chains.
  function impliedOf(row) {
    var growth = Math.min(120, Math.max(-60, row[5] === null || row[5] === undefined ? 0 : row[5]));
    var growthMult = 1 + (growth / 100) * 0.5;
    var age = row[6] === null || row[6] === undefined ? 365 : row[6];
    var maturityMult = 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4;
    var chainMult = 1 + Math.min(Math.log2(Math.max(row[3].length, 1)), 4) * 0.03;
    return Math.max(1, Math.round(row[4] * row[7] * growthMult * maturityMult * chainMult));
  }
  function factorsOf(row) {
    var growth = Math.min(120, Math.max(-60, row[5] === null || row[5] === undefined ? 0 : row[5]));
    var age = row[6] === null || row[6] === undefined ? 365 : row[6];
    return {
      growth: 1 + (growth / 100) * 0.5,
      maturity: 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4,
      chains: 1 + Math.min(Math.log2(Math.max(row[3].length, 1)), 4) * 0.03
    };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation lib/model.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(row) { return row[3] && row[3].length > 0 ? row[3][0] : 'its main chain'; }
  function capitalFor(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(row, capital, chain) {
    var c = (row[2] || '').toLowerCase();
    var name = row[1];
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open so it counts as a lender, not a passer-by.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open through at least one fee cycle.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds inside its app, so the crossing is a real use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge, then close it in profit or at a small loss.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one market position on an outcome you have actually read about.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + " and keep the shares until the vault's next rebalance.";
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' through ' + name + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy for its full term.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open through the next snapshot.';
  }
  function stepText(text, cost, time) {
    var s = text + ' Cost: ' + cost + '. Time: ' + time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    return s;
  }
  function farmSteps(row) {
    var chain = chainOf(row);
    var capital = capitalFor(row[4]);
    var hold = holdDaysFor(row[6]);
    return [
      stepText('Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
      stepText(actionFor(row, capital, chain), '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', '15 minutes to set up'),
      stepText('Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet shows repeat activity.', 'about $2 of gas a week on ' + chain, '10 minutes a week'),
      stepText('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days'),
      stepText("Before you withdraw, open " + row[1] + "'s own points or rewards page and claim only from the link it publishes.", 'no fee to check, and never pay to claim', '10 minutes'),
      stepText('Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes')
    ];
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r[2] !== state.category) return false;
      if (state.chain !== 'all' && (r[3] || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r[1], r[0], r[2], (r[3] || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a[1].toLowerCase(); bv = b[1].toLowerCase(); }
      else if (key === 'tvl') { av = a[4]; bv = b[4]; }
      else if (key === 'growth') { av = a[5] === null ? -Infinity : a[5]; bv = b[5] === null ? -Infinity : b[5]; }
      else if (key === 'age') { av = a[6] === null ? Infinity : a[6]; bv = b[6] === null ? Infinity : b[6]; }
      else if (key === 'peer') { av = a[7]; bv = b[7]; }
      else { av = a[11]; bv = b[11]; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }),
        el('span', { class: 'brand-name' }, el('b', { text: 'Token Radar' }), ' · peer-priced')),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, priced by their live peers' }),
        el('p', null,
          'Every pre-token protocol is worth what the market already pays for the same kind of protocol that ',
          el('b', { text: 'does' }),
          ' have a token. The peer multiple is the median market-cap-per-TVL of the live-token protocols in its own category — never a name on a list. The early radar adds ',
          el('b', { text: String(DATA.early_size) }),
          ' more candidates below the $' + Math.round(DATA.floor_usd / 1e6) + 'M watchlist floor. Implied value is a model, not a price.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function topChains() {
    var counts = {};
    DATA.rows.forEach(function (r) {
      (r[3] || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 12);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r[2] || 'Other'; }))).sort();
    var chains = topChains();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r[11] > max) max = r[11]; });
    var tbody = el('tbody');
    list.forEach(function (r, i) {
      var rank = DATA.rows.indexOf(r) + 1;
      var growth = r[5] === null ? 'n/a' : fmtPct(r[5]);
      var growthClass = r[5] === null ? '' : r[5] >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r[0] ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r[0]); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r[0]); } }
      },
        el('td', { class: 'num', text: String(rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r[1] }),
          el('span', { class: 'sub', text: (r[2] || 'Other') + ' on ' + (r[3] && r[3].length ? r[3].slice(0, 2).join(', ') : 'an unnamed chain') }),
          el('span', { class: 'row-tags' },
            r[12] === 1 ? el('span', { class: 'tag watch', text: 'Watchlist' }) : el('span', { class: 'tag early', text: 'Early' })
          )
        )),
        el('td', { class: 'num', text: fmtUsd(r[4]) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r[6]) }),
        el('td', { class: 'num', text: fmtMult(r[7]) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r[11] / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r[11]) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('peer', 'Peer multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r[1] }), el('span', { class: 'sub', text: (r[2] || 'Other') + ' on ' + (r[3] && r[3].length ? r[3].slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r[4]) }),
        el('td', { class: 'num ' + (r[5] !== null && r[5] >= 0 ? 'pos' : 'neg'), text: fmtPct(r[5]) }),
        el('td', { class: 'num', text: fmtUsd(r[6]) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are the peers that price it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var peerRows = Object.keys(DATA.peers).sort(function (a, b) { return DATA.peers[b][0] - DATA.peers[a][0]; });
    var peerBody = el('tbody');
    peerRows.forEach(function (cat) {
      var p = DATA.peers[cat];
      peerBody.appendChild(el('tr', null,
        el('td', { text: cat }),
        el('td', { class: 'num', text: fmtMult(p[0]) }),
        el('td', { class: 'num', text: String(p[1]) }),
        el('td', { class: 'num', text: fmtMult(p[2]) })
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'implied = round( tvl_usd x peer multiple x growth x maturity x chains )' }),
        el('div', { text: 'peer multiple = median(mcap / tvl) of the live-token protocols in the category, each ratio capped at 3.0, shrunk toward the global median (8 of 9 parts global when a category has one peer), clamped to 0.04x–1.20x.' }),
        el('div', { text: 'growth = 1 + clamp(change_7d, -60, 120) / 100 x 0.5' }),
        el('div', { text: 'maturity = 0.6 + min(age_days, 1095) / 1095 x 0.4' }),
        el('div', { text: 'chains = 1 + min(log2(chain count), 4) x 0.03' })
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses 365 days. The early radar is every other launch candidate below the watchlist floor — the watchlist rule (no wrapped, staked or bridged product, no versioned duplicate) applied at every size — and the live-token protocols are set aside with their market caps shown. Their multiples are:' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'peers' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Peer multiple' }),
            el('th', { scope: 'col', text: 'Live peers' }),
            el('th', { scope: 'col', text: 'Category median' })
          )),
          peerBody
        )
      )
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Source: DefiLlama public protocol index (api.llama.fi/protocols), snapshot ' + DATA.as_of + '. Model ' + DATA.model_version + '.' }),
      el('span', { text: 'Implied value is a model built from that snapshot, not a price and not a promise. Farm plans are a starting point: check the protocol’s own page before you move funds.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r[0] === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var f = factorsOf(row);
    var recomputed = impliedOf(row);
    var peer = DATA.peers[row[2]] || null;
    var rank = DATA.rows.indexOf(row) + 1;
    var why = 'Rank ' + rank + ' of ' + DATA.board_size + ': ' + fmtUsd(row[4]) + ' of TVL priced at a ' + fmtMult(row[7]) + ' peer multiple'
      + (peer ? ' (the median of ' + peer[1] + ' live ' + row[2] + ' token' + (peer[1] === 1 ? '' : 's') + ')' : '')
      + ', ' + fmtPct(row[5]) + ' seven-day growth, ' + fmtAge(row[6]) + ' with no token, across ' + row[3].length + ' chain' + (row[3].length === 1 ? '' : 's') + '.';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name' }, el('b', { text: 'Rank ' + rank + ' of ' + DATA.board_size }), row[12] === 1 ? ' · Watchlist' : ' · Early radar'),
        el('h2', { id: 'detail-title', text: row[1] }),
        el('p', { class: 'sub', text: (row[2] || 'Other') + ' on ' + (row[3] && row[3].length ? row[3].join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row[4]) })),
        el('div', null, el('span', { text: 'Peer multiple (' + (row[2] || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row[7]) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row[5]) + ' → ' + fmtMult(f.growth) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row[6]) + ' → ' + fmtMult(f.maturity) })),
        el('div', null, el('span', { text: 'Chains reached' }), el('b', { class: 'num', text: String(row[3].length) + ' → ' + fmtMult(f.chains) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row[11]) }))
      ),
      el('p', { class: 'why' }, el('b', { text: 'Why this rank. ' }), why),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row[11] ? ', the same number the board carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
