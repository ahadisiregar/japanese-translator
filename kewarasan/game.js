/* KEWARASAN — Edition 1. Browser implementation of the rulebook in docs/rulebook.md.
   Pure static JS, no build step. Data comes from data.js (generated from the markdown files). */
(() => {
'use strict';

const TILES = window.TILES, CARDS = window.CARDS;
const CARD = Object.fromEntries(CARDS.map(c => [c.id, c]));
const SELFCARE = CARDS.filter(c => c.selfCare).map(c => c.id);

// ---------- rules constants (rulebook sections 2–4) ----------
const R = {
  START_CASH: 15000000, START_KEW: 10, MAX_KEW: 10,
  GO_PAY: 2000000, LOAN_UNIT: 1000000, LOAN_MAX: 5, LOAN_INTEREST: 200000,
  RENO_COST: 500000, RENO_RENT: 100000, RENO_MAX: 3,
  TRANSIT_RENT: [0, 250000, 500000, 750000, 1000000],
  KEW_PER_SHORT: 500000, JAIL_POS: 10, JAIL_SKIPS: 2,
  TIME_LIMIT: 90 * 60 * 1000, MAX_TURNS: 3000,
};
const creepFor = n => (n >= 5 ? 3 : 4);   // tuned by bot simulation: keeps games near 60–90 min
const SAVE_KEY = 'kewarasan.save.v1';
const COLORS = ['#ff5d73', '#4aa3ff', '#4cd38a', '#ffd23f', '#b886ff', '#ff9b42'];
const EMOJI = ['🦊', '🐼', '🐸', '🐥', '🦄', '🐙'];
const BOT_NAMES = ['Budi', 'Siti', 'Agus', 'Dewi', 'Rudi', 'Wati'];
const DECKS = {
  politik: { name: 'Politik / Politics', color: '#b3362a', icon: '🏛️' },
  ugly: { name: 'Kenyataan Pahit / Ugly Truth', color: '#5f6b7a', icon: '💀' },
  dark: { name: 'Dark Joke', color: '#4a2a6b', icon: '⚰️' },
  sarcasm: { name: 'Sindiran / Sarcasm', color: '#0f7b8a', icon: '🙃' },
  modern: { name: 'Hidup Modern / Modern Life', color: '#2d6bd1', icon: '📱' },
  finance: { name: 'Keuangan / Finance', color: '#2e8b57', icon: '💳' },
  meme: { name: 'Meme', color: '#c27a12', icon: '🐱' },
};
const GROUPS = [
  [[1, 3], '#8b5a3c'], [[6, 8, 9], '#8fd3f4'], [[11, 13, 14], '#e06bb5'], [[16, 18, 19], '#f39c3d'],
  [[21, 23, 24], '#e0443e'], [[26, 27, 29], '#f2d33a'], [[31, 32, 34], '#3fae5f'], [[37, 39], '#2c5fd6'],
];
const GROUP_OF = {};
GROUPS.forEach(([ps, c]) => ps.forEach(p => GROUP_OF[p] = c));
const ICON = {
  0: '🏁', 1: '🏚️', 3: '📲', 5: '🚆', 6: '💼', 8: '☕', 9: '🗂️', 10: '🏥', 11: '🎓', 12: '⚡', 13: '🏘️', 14: '🏫', 15: '🛵',
  16: '📱', 18: '🏦', 19: '🩺', 20: '🛋️', 21: '🏨', 23: '🦄', 24: '🏪', 25: '🚐', 26: '🚗', 27: '💻', 28: '💧', 29: '📈',
  30: '⏰', 31: '📦', 32: '📊', 34: '🌆', 35: '🚇', 37: '🛍️', 39: '📜',
};
const TAX_ICON = '💸';

// ---------- tiny helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n < 0 ? '-' : '') + 'Rp ' + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const params = new URLSearchParams(location.search);
const AUTOTEST = params.has('autoplay');           // headless test mode: all bots, no delays, no modals
class Out extends Error {}                         // thrown when Kewarasan hits 0

let G = null;                                      // game state
let UI = { modalHandler: null, actionResolver: null, modalOpen: false };

const speed = p => AUTOTEST ? 0 : (G && G.settings.fast && p && !p.human ? 0.3 : 1);
const sleep = (ms, p) => { const t = ms * speed(p); return t <= 0 ? Promise.resolve() : new Promise(r => setTimeout(r, t)); };
const pL = p => `<span class="pl" style="--c:${p.color}">${p.emoji} ${esc(p.name)}</span>`;
const alive = () => G.players.filter(p => p.alive);
const humansAlive = () => alive().some(p => p.human);

// ---------- log / toast ----------
function log(html) {
  if (AUTOTEST) { G.logCount++; return; }
  const d = document.createElement('div'); d.innerHTML = html;
  const box = $('#log'); box.appendChild(d);
  while (box.children.length > 140) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
  const le = $('#lastEvent'); if (le) le.innerHTML = html;
}
function toast(html, cls = '') {
  if (AUTOTEST) return;
  const t = document.createElement('div'); t.className = 'toast ' + cls; t.innerHTML = html;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 2600);
}
function flash(p, cls) {
  if (AUTOTEST) return;
  const el = document.querySelector(`.pcard[data-id="${p.id}"]`);
  if (el) { el.classList.remove('loss', 'gain'); void el.offsetWidth; el.classList.add(cls); }
}

// ---------- modal ----------
function closeModal() { $('#modal').classList.remove('show'); UI.modalOpen = false; UI.modalHandler = null; }
function openModal(title, body, buttons, opts = {}) {
  $('#modal-box').className = 'box' + (opts.wide ? ' wide' : '');
  $('#modal-title').innerHTML = title || '';
  $('#modal-body').innerHTML = body || '';
  const bar = $('#modal-btns'); bar.innerHTML = '';
  const els = [];
  (buttons || []).forEach(b => {
    const e = document.createElement('button'); e.type = 'button';
    e.className = 'btn ' + (b.cls || ''); e.innerHTML = b.label; e.disabled = !!b.disabled;
    e.onclick = () => b.onClick(); bar.appendChild(e); els.push(e);
  });
  $('#modal').classList.add('show'); UI.modalOpen = true;
  UI.modalHandler = opts.handler || null;
  const first = els.find(e => !e.disabled); if (first && !opts.noFocus) first.focus({ preventScroll: true });
}
// ask: show buttons, resolve with the clicked value. `auto` = {value, ms, p} lets bots (or the autoplay test) answer.
function ask({ title, body, buttons, wide, auto }) {
  return new Promise(res => {
    if (AUTOTEST && auto) return res(auto.value);
    let done = false, timer = null;
    const finish = v => { if (done) return; done = true; clearTimeout(timer); closeModal(); res(v); };
    openModal(title, body, buttons.map(b => ({ ...b, onClick: () => finish(b.value) })), { wide });
    if (auto) timer = setTimeout(() => finish(auto.value), Math.max(250, auto.ms * speed(auto.p)));
  });
}
// notice: informational message. Humans press OK, bots auto-dismiss.
function notice(p, title, body, ms = 1900) {
  const human = p && p.human;
  return ask({ title, body, buttons: [{ label: 'OK', value: 1 }], auto: human ? undefined : { value: 1, ms, p } });
}
document.addEventListener('click', e => {
  const b = e.target.closest('#modal-body [data-act]');
  if (b && UI.modalHandler) UI.modalHandler(b.dataset.act, b.dataset);
});

// ---------- board build / render ----------
function gridPos(i) {
  if (i <= 10) return [11, 11 - i];
  if (i <= 19) return [21 - i, 1];
  if (i <= 30) return [1, 1 + (i - 20)];
  return [1 + (i - 30), 11];
}
function buildBoard() {
  const b = $('#board'); b.innerHTML = '';
  TILES.forEach(t => {
    const [r, c] = gridPos(t.pos);
    const d = document.createElement('div');
    const corner = t.pos % 10 === 0;
    d.className = `tile k-${t.kind}` + (corner ? ' corner' : '');
    d.id = 'tile' + t.pos; d.style.gridRow = r; d.style.gridColumn = c;
    if (t.kind === 'card') d.style.setProperty('--dc', DECKS[t.deck].color);
    let ico = ICON[t.pos] || '';
    if (t.kind === 'card') ico = DECKS[t.deck].icon;
    if (t.kind.startsWith('tax')) ico = TAX_ICON;
    const bar = t.kind === 'inst' ? `<div class="bar" style="--g:${GROUP_OF[t.pos]}"></div>` : '';
    const price = t.price ? fmt(t.price).replace('Rp ', '') : '';
    d.innerHTML = `${bar}<div class="ico">${ico}</div><div class="en">${esc(t.en)}</div><div class="idn">${esc(t.idn)}</div><div class="price">${price}</div><div class="reno"></div><div class="toks"></div>`;
    d.onclick = () => showTileInfo(t.pos);
    b.appendChild(d);
  });
  const c = document.createElement('div'); c.id = 'center';
  c.innerHTML = `<div class="logo">KEWARASAN</div><div class="sub">Last one still sane wins.<br>Yang paling terakhir masih waras, dialah pemenangnya.</div>
    <div id="turnInfo"></div><div id="dice"><div class="die" id="d1">⚀</div><div class="die" id="d2">⚁</div></div><div id="lastEvent"></div>`;
  b.appendChild(c);
}
function renderBoard() {
  TILES.forEach(t => {
    const d = $('#tile' + t.pos);
    const o = G.owners[t.pos] != null ? G.players[G.owners[t.pos]] : null;
    d.classList.toggle('owned', !!o);
    if (o) d.style.setProperty('--own', o.color);
    d.querySelector('.reno').innerHTML = '<i></i>'.repeat(G.reno[t.pos] || 0);
    const toks = d.querySelector('.toks'); toks.innerHTML = '';
    G.players.forEach(p => {
      if (p.alive && p.pos === t.pos) {
        const k = document.createElement('div'); k.className = 'tok' + (p.id === G.cur ? ' cur' : '');
        k.style.setProperty('--c', p.color); k.textContent = p.emoji; k.title = p.name; toks.appendChild(k);
      }
    });
  });
}
function renderPlayers() {
  const box = $('#players'); box.innerHTML = '';
  G.players.forEach(p => {
    const kc = p.kew <= 3 ? '#ff5d73' : p.kew <= 6 ? '#ffb347' : '#4cd38a';
    const props = G.owners.reduce((n, o, i) => n + (o === p.id ? 1 : 0), 0);
    const d = document.createElement('div');
    d.className = 'pcard' + (p.id === G.cur && p.alive ? ' active' : '') + (p.alive ? '' : ' dead');
    d.dataset.id = p.id; d.style.setProperty('--c', p.color); d.style.setProperty('--kc', kc);
    d.innerHTML = `<div class="nm"><span>${p.emoji} ${esc(p.name)}</span><span class="b">${p.human ? 'HUMAN' : 'BOT'}</span></div>
      <div class="kew" title="Kewarasan ${p.kew}/10">${Array.from({ length: R.MAX_KEW }, (_, i) => `<i class="${i < p.kew ? 'f' : ''}"></i>`).join('')}</div>
      ${p.alive ? `<div class="stats"><span>🧠 <b>${p.kew}</b>/10</span><span>💰 <b>${fmt(p.cash).replace('Rp ', '')}</b></span><span>🏠 <b>${props}</b></span>
      ${p.loans ? `<span class="tag-d">Cicilan ×${p.loans}</span>` : ''}${p.paylater.length ? `<span class="tag-d">Paylater ×${p.paylater.length}</span>` : ''}
      ${p.hand.length ? `<span>🌿 <b>${p.hand.length}</b></span>` : ''}${p.skip ? `<span>⏭ <b>${p.skip}</b></span>` : ''}</div>`
      : '<div class="tag-d">BURNOUT — out / tersingkir</div>'}`;
    box.appendChild(d);
  });
  const cur = G.players[G.cur];
  document.body.classList.toggle('lowsanity', !!(cur && cur.alive && cur.kew <= 3 && cur.human));
}
function renderAll() { if (AUTOTEST) return; renderBoard(); renderPlayers(); }

// ---------- actions bar ----------
function setActions(mode) {
  if (AUTOTEST) return;
  const p = G.players[G.cur], a = $('#actions');
  const human = p && p.human && p.alive;
  a.innerHTML = `<div class="who">${p ? pL(p) : ''} ${human ? '— your turn / giliranmu' : p && !p.human ? '(bot thinking…)' : ''}</div>
    <div class="row">
      <button class="btn big" id="bRoll" ${human && mode === 'roll' ? '' : 'disabled'}>🎲 Roll / Lempar</button>
      <button class="btn alt" id="bMan" ${human && (mode === 'roll' || mode === 'end') ? '' : 'disabled'}>Manage / Kelola</button>
      <button class="btn good" id="bEnd" ${human && mode === 'end' ? '' : 'disabled'}>End turn / Selesai</button>
    </div>
    <div class="hint">Manage: Self-Care cards, Cicilan loans, Renovasi. Space = main button.</div>`;
  const go = v => () => { if (UI.actionResolver) { const r = UI.actionResolver; UI.actionResolver = null; r(v); } };
  $('#bRoll').onclick = go('roll'); $('#bMan').onclick = go('manage'); $('#bEnd').onclick = go('end');
}
document.addEventListener('keydown', e => {
  if ((e.code === 'Space') && !UI.modalOpen && UI.actionResolver && !(document.activeElement && document.activeElement.tagName === 'BUTTON')) {
    e.preventDefault(); const b = $('#bRoll:not(:disabled)') || $('#bEnd:not(:disabled)'); if (b) b.click();
  }
});

// ---------- core state changes ----------
function changeKew(p, d, why) {
  const before = p.kew; p.kew = clamp(p.kew + d, 0, R.MAX_KEW);
  const real = p.kew - before;
  if (real !== 0 || d < 0) {
    log(`${pL(p)} <b>${real >= 0 ? '+' : ''}${real} Kewarasan</b> — ${why}`);
    toast(`${p.emoji} ${real >= 0 ? '+' : ''}${real} Kewarasan · ${esc(why)}`, real >= 0 ? 'good' : 'bad');
    flash(p, real >= 0 ? 'gain' : 'loss');
  }
  p.stats.kewLost += Math.max(0, -real);
  if (!AUTOTEST) renderPlayers();
  if (p.kew <= 0) throw new Out();
}
function gain(p, amt, why) {
  p.cash += amt; log(`${pL(p)} <b>+${fmt(amt)}</b> — ${why}`); flash(p, 'gain'); toast(`${p.emoji} +${fmt(amt)} · ${esc(why)}`, 'good');
  if (!AUTOTEST) renderPlayers();
}
function ownedBy(p) { const r = []; G.owners.forEach((o, i) => { if (o === p.id) r.push(i); }); return r; }
// Shortfall rule (rulebook 4.8): sell Renovasi at half cost, then deeds at half price, then lose Kewarasan.
function liquidate(p, need) {
  let raised = 0;
  const owned = ownedBy(p).sort((a, b) => G.reno[b] - G.reno[a]);
  for (const pos of owned) while (G.reno[pos] > 0 && raised < need) {
    G.reno[pos]--; raised += R.RENO_COST / 2; p.cash += R.RENO_COST / 2;
    log(`${pL(p)} sells a Renovasi token on ${esc(TILES[pos].en)} for ${fmt(R.RENO_COST / 2)}`);
  }
  if (raised < need) {
    for (const pos of ownedBy(p).sort((a, b) => TILES[a].price - TILES[b].price)) {
      if (raised >= need) break;
      if (G.reno[pos] > 0) { raised += (R.RENO_COST / 2) * G.reno[pos]; p.cash += (R.RENO_COST / 2) * G.reno[pos]; G.reno[pos] = 0; }
      const v = TILES[pos].price / 2; G.owners[pos] = null; raised += v; p.cash += v;
      log(`${pL(p)} sells <b>${esc(TILES[pos].en)}</b> back to the bank for ${fmt(v)}`);
      toast(`${p.emoji} forced to sell ${esc(TILES[pos].en)}`, 'bad');
    }
  }
}
function pay(p, amt, to, why) {
  if (amt <= 0) return;
  if (p.cash < amt) liquidate(p, amt - p.cash);
  const paid = Math.min(p.cash, amt);
  p.cash -= paid; if (to) to.cash += paid;
  p.stats.paid += paid;
  log(`${pL(p)} pays <b>${fmt(paid)}</b>${to ? ' to ' + pL(to) : ''} — ${why}`);
  flash(p, 'loss'); if (to) flash(to, 'gain');
  if (!AUTOTEST) renderPlayers();
  const short = amt - paid;
  if (short > 0) changeKew(p, -Math.ceil(short / R.KEW_PER_SHORT), `${fmt(short)} short — shortfall rule`);
}

// ---------- movement ----------
function passGo(p) {
  p.cash += R.GO_PAY; log(`${pL(p)} passes GO: <b>+${fmt(R.GO_PAY)}</b> and +1 Kewarasan`);
  toast(`${p.emoji} Gajian! +${fmt(R.GO_PAY)} · +1 Kewarasan`, 'good');
  changeKew(p, +1, 'passed GO');
}
async function walk(p, steps) {
  for (let i = 0; i < steps; i++) {
    p.pos = (p.pos + 1) % 40; if (!AUTOTEST) renderBoard();
    if (p.pos === 0) passGo(p);
    await sleep(110, p);
  }
}
function nextInstitution(from) { for (let i = 1; i <= 40; i++) { const q = (from + i) % 40; if (TILES[q].kind === 'inst') return q; } }
function rentFor(pos) {
  const t = TILES[pos], o = G.owners[pos];
  if (o == null) return 0;
  if (t.kind === 'inst') return t.rent + G.reno[pos] * R.RENO_RENT;
  if (t.kind === 'utility') return t.rent;
  if (t.kind === 'transit') return R.TRANSIT_RENT[TILES.filter(x => x.kind === 'transit' && G.owners[x.pos] === o).length];
  return 0;
}

// ---------- dice ----------
const PIPS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
async function rollDice(p) {
  const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
  if (!AUTOTEST) {
    const d1 = $('#d1'), d2 = $('#d2'); d1.classList.add('roll'); d2.classList.add('roll');
    const n = speed(p) ? 7 : 0;
    for (let i = 0; i < n; i++) { d1.textContent = PIPS[Math.floor(Math.random() * 6)]; d2.textContent = PIPS[Math.floor(Math.random() * 6)]; await sleep(70, p); }
    d1.classList.remove('roll'); d2.classList.remove('roll'); d1.textContent = PIPS[a - 1]; d2.textContent = PIPS[b - 1];
  }
  log(`${pL(p)} rolls <b>${a} + ${b} = ${a + b}</b>${a === b ? ' — doubles!' : ''}`);
  return [a, b];
}

// ---------- tile cards (HTML) ----------
function tileInfoHtml(t) {
  const o = G.owners[t.pos] != null ? G.players[G.owners[t.pos]] : null;
  const rows = [];
  rows.push(['Type', t.kind === 'inst' ? `Institution · ${esc(t.cat)}` : t.kind]);
  if (t.price) rows.push(['Price / Harga', fmt(t.price)]);
  if (['inst', 'utility', 'transit'].includes(t.kind)) {
    if (t.kind === 'transit') rows.push(['Rent / Sewa', '1: Rp 250,000 · 2: 500,000 · 3: 750,000 · 4: 1,000,000']);
    else rows.push(['Rent / Sewa', fmt(t.rent) + (t.kind === 'inst' ? ' + Rp 100,000 per Renovasi' : ' (fixed bill)')]);
    rows.push(['Owner / Pemilik', o ? pL(o) : 'Bank']);
    if (t.kind === 'inst' && o) rows.push(['Renovasi', G.reno[t.pos] + ' / 3']);
  }
  rows.push(['Effect', esc(t.effect)]);
  return `<div class="tinfo"><p><i>${esc(t.idn)}</i></p>${rows.map(r => `<div class="row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}<p style="margin-top:10px;color:var(--muted)"><i>“${esc(t.flavor)}”</i></p></div>`;
}
function showTileInfo(pos) {
  if (UI.modalOpen || !G) return;
  const t = TILES[pos];
  ask({ title: `${ICON[pos] || ''} ${esc(t.en)}`, body: tileInfoHtml(t), buttons: [{ label: 'Close', value: 1, cls: 'alt' }] });
}

// ---------- cards ----------
function effClass(c) { const e = c.e; const v = e.kew != null ? e.kew : e.money != null ? e.money : 0; return v < 0 ? 'neg' : v > 0 ? 'pos' : ''; }
function cardHtml(card, deck, extra = '') {
  const dk = DECKS[deck];
  return `<div class="gcard" style="--dc:${dk.color}"><div class="deck">${dk.icon} ${dk.name}</div>
    <h3>${esc(card.titleEn)}</h3><div class="subt">${esc(card.titleId)}</div>
    <p class="en">${esc(card.en)}</p><p class="idt">${esc(card.idt)}</p>
    <span class="eff ${effClass(card)}">${esc(card.eff)}${card.paylater ? ' + Paylater token' : ''}</span>${extra}
    <div class="fl">${esc(card.flavor)}</div></div>`;
}
async function drawCard(p, deckKey) {
  const deck = G.decks[deckKey];
  if (!deck.draw.length) { deck.draw = shuffle(deck.discard); deck.discard = []; log(`The ${DECKS[deckKey].name} deck is reshuffled.`); }
  if (!deck.draw.length) return;
  const card = CARD[deck.draw.pop()];
  log(`${pL(p)} draws <b>${esc(card.titleEn)}</b> (${esc(DECKS[deckKey].name)})`);
  const keep = card.selfCare;
  await ask({
    title: `${DECKS[deckKey].icon} ${esc(p.name)} draws…`,
    body: cardHtml(card, deckKey, keep ? '<p style="margin-top:8px"><b>Keep it.</b> Play it any time on your turn from Manage / Kelola.</p>' : ''),
    buttons: [{ label: keep ? 'Keep card / Simpan' : 'OK', value: 1 }], auto: p.human ? undefined : { value: 1, ms: 2400, p },
  });
  if (keep) { p.hand.push({ id: card.id, starter: false }); if (!AUTOTEST) renderPlayers(); return; }
  try { await applyEffect(p, card, card.e); } finally { deck.discard.push(card.id); }
}
async function applyEffect(p, card, e) {
  if (e.choice) {
    const pick = await ask({
      title: 'You choose / Kamu yang pilih', body: cardHtml(card, card.deck),
      buttons: [{ label: 'Skip your next turn / Lewati giliran', value: 0 }, { label: 'Lose 1 Kewarasan', value: 1, cls: 'bad' }],
      auto: p.human ? undefined : { value: 0, ms: 1500, p },
    });
    return applyEffect(p, card, e.choice[pick]);
  }
  if (e.kew != null) changeKew(p, e.kew, card.titleEn);
  if (e.money != null) { if (e.money > 0) gain(p, e.money, card.titleEn); else pay(p, -e.money, null, card.titleEn); }
  if (card.paylater) { p.paylater.push(card.paylater); log(`${pL(p)} receives a <b>Paylater token</b> worth ${fmt(card.paylater)}`); toast('Paylater token added to your card', 'bad'); }
  if (e.skip) { p.skip += e.skip; log(`${pL(p)} will skip ${e.skip} turn(s)`); }
  if (e.move === 'next') {
    const target = nextInstitution(p.pos); const steps = (target - p.pos + 40) % 40;
    log(`${pL(p)} moves to the next Institution`); await walk(p, steps); await resolveTile(p);
  } else if (e.move === 'any') {
    const pos = await chooseInstitution(p);
    p.pos = pos; log(`${pL(p)} moves to <b>${esc(TILES[pos].en)}</b>`); renderAll(); await sleep(300, p); await resolveTile(p);
  }
}
async function chooseInstitution(p) {
  const insts = TILES.filter(t => t.kind === 'inst');
  if (!p.human) {
    const score = t => { const o = G.owners[t.pos]; if (o == null) return p.cash - t.price > 1500000 ? 1000000 + t.price : -t.price; if (o === p.id) return 500000; return -rentFor(t.pos); };
    return insts.slice().sort((a, b) => score(b) - score(a))[0].pos;
  }
  const body = `<div class="sec">${insts.map(t => { const o = G.owners[t.pos] != null ? G.players[G.owners[t.pos]] : null; return `<div class="li"><div class="l"><b>${esc(t.en)}</b><small>${o ? 'Owner: ' + pL(o) + ' · rent ' + fmt(rentFor(t.pos)) : 'Unowned · ' + fmt(t.price)}</small></div><button class="btn sm" data-act="go" data-pos="${t.pos}">Go</button></div>`; }).join('')}</div>`;
  return new Promise(res => openModal('Move to any Institution / Pindah ke Institusi mana pun', body, [], { wide: true, handler: (a, d) => { if (a === 'go') { closeModal(); res(+d.pos); } } }));
}

// ---------- auctions ----------
function botBidMax(b, t) { return Math.min(b.cash - 400000, t.price * (0.7 + Math.random() * 0.4)); }
async function auction(pos, fromId, why) {
  const t = TILES[pos], open = Math.ceil(t.price / 2 / 100000) * 100000, step = 100000;
  const order = [];
  for (let k = 1; k <= G.players.length; k++) { const q = G.players[(fromId + k) % G.players.length]; if (q.alive) order.push(q); }
  const active = order.slice(); let high = null, bid = 0, i = 0;
  log(`<b>Auction</b>: ${esc(t.en)} — opening bid ${fmt(open)}${why ? ' (' + why + ')' : ''}`);
  const ui = active.some(q => q.human);
  while (active.length) {
    if (i >= active.length) i = 0;
    const b = active[i];
    if (high && b === high) break;
    const minBid = high ? bid + step : open;
    let dec = null;
    if (b.cash >= minBid) {
      if (b.human) {
        const offers = [minBid, minBid + 500000, minBid + 1000000].filter((v, k, a) => v <= b.cash && a.indexOf(v) === k);
        const choice = await ask({
          title: `Auction: ${esc(t.en)}`, body: `<div class="tinfo">${tileInfoHtml(t)}</div><p><b>${pL(b)}</b>, your turn to bid. You have ${fmt(b.cash)}.<br>${high ? 'High bid: <b>' + fmt(bid) + '</b> by ' + pL(high) : 'No bids yet. Opening: <b>' + fmt(open) + '</b>'}</p>`,
          buttons: [...offers.map(v => ({ label: 'Bid ' + fmt(v), value: v })), { label: 'Pass', value: 0, cls: 'alt' }],
        });
        dec = choice || null;
      } else {
        const max = botBidMax(b, t); await sleep(ui ? 500 : 0, b);
        dec = minBid <= max ? minBid : null;
      }
    }
    if (dec == null) { active.splice(i, 1); } else { high = b; bid = dec; i++; if (ui && !b.human) toast(`${b.emoji} bids ${fmt(bid)}`); }
  }
  if (high) {
    pay(high, bid, null, `won the auction for ${t.en}`); G.owners[pos] = high.id;
    log(`${pL(high)} wins <b>${esc(t.en)}</b> for ${fmt(bid)}`); toast(`${high.emoji} wins ${esc(t.en)} for ${fmt(bid)}`, 'good');
    renderAll();
  } else log(`Nobody bids on ${esc(t.en)}. It stays with the bank.`);
  return high;
}

// ---------- tile resolution ----------
async function offerBuy(p, t) {
  const canAfford = p.cash >= t.price;
  const declineLabel = t.kind === 'transit' ? 'Decline (stuck in traffic: -1 Kewarasan)' : t.kind === 'utility' ? `Decline (pay bill ${fmt(t.rent)})` : 'Decline (auction)';
  if (p.human) {
    return ask({
      title: `${ICON[t.pos] || ''} ${esc(t.en)} — for sale`, body: tileInfoHtml(t) + `<p style="margin-top:10px">You have <b>${fmt(p.cash)}</b>.${canAfford ? '' : ' You can’t afford it — use Manage to borrow a Cicilan first, or decline.'}</p>`,
      buttons: [{ label: `Buy / Beli ${fmt(t.price)}`, value: true, disabled: !canAfford, cls: 'good' }, { label: declineLabel, value: false, cls: 'alt' }],
    });
  }
  await sleep(500, p);
  const reserve = t.kind === 'inst' ? 900000 : 1200000;
  return canAfford && p.cash - t.price >= reserve && Math.random() < 0.93;
}
async function resolveTile(p) {
  const t = TILES[p.pos];
  renderAll();
  switch (t.kind) {
    case 'go': changeKew(p, +1, 'landed on GO'); break;
    case 'inst': case 'transit': case 'utility': {
      const oid = G.owners[t.pos];
      if (oid == null) {
        const buy = await offerBuy(p, t);
        if (buy) { pay(p, t.price, null, `bought ${t.en}`); G.owners[t.pos] = p.id; log(`${pL(p)} buys <b>${esc(t.en)}</b>`); toast(`${p.emoji} buys ${esc(t.en)}`, 'good'); }
        else if (t.kind === 'transit') { changeKew(p, -1, `stuck in traffic at ${t.en}`); }
        else if (t.kind === 'utility') { await notice(p, 'Utility bill', `<p>${esc(t.en)}: <b>${fmt(t.rent)}</b> goes to the bank.</p>`); pay(p, t.rent, null, `${t.en} bill`); }
        else await auction(t.pos, p.id, `${p.name} declined`);
      } else if (oid !== p.id) {
        const owner = G.players[oid], rent = rentFor(t.pos);
        await notice(p, `${esc(t.en)} belongs to ${esc(owner.name)}`, `<p>Rent / Sewa: <b>${fmt(rent)}</b> to ${pL(owner)}.</p><p style="color:var(--muted)"><i>${esc(t.flavor)}</i></p>`);
        pay(p, rent, owner, `rent at ${t.en}`); p.stats.rentPaid += rent;
      } else log(`${pL(p)} lands on their own ${esc(t.en)}.`);
      break;
    }
    case 'card': await drawCard(p, t.deck); break;
    case 'tax-income': {
      const amt = Math.round(p.cash * 0.1 / 1000) * 1000;
      const pick = await ask({
        title: '💸 Pajak Penghasilan / Income Tax', body: `<p>Pay 10% of your cash (<b>${fmt(amt)}</b>) or lose <b>2 Kewarasan</b>. Your choice.</p>`,
        buttons: [{ label: `Pay ${fmt(amt)}`, value: 'cash' }, { label: 'Lose 2 Kewarasan', value: 'kew', cls: 'bad' }],
        auto: p.human ? undefined : { value: (amt <= 1300000 || p.kew <= 4) ? 'cash' : 'kew', ms: 1500, p },
      });
      if (pick === 'cash') pay(p, amt, null, 'income tax'); else changeKew(p, -2, 'income tax');
      break;
    }
    case 'tax-ent': {
      const pick = await ask({
        title: '💸 Pajak Hiburan / Entertainment Tax', body: `<p>Pay <b>${fmt(1500000)}</b> or lose <b>1 Kewarasan</b>. Your choice.</p>`,
        buttons: [{ label: `Pay ${fmt(1500000)}`, value: 'cash' }, { label: 'Lose 1 Kewarasan', value: 'kew', cls: 'bad' }],
        auto: p.human ? undefined : { value: (p.cash >= 3500000 || p.kew <= 3) ? 'cash' : 'kew', ms: 1500, p },
      });
      if (pick === 'cash') pay(p, 1500000, null, 'entertainment tax'); else changeKew(p, -1, 'entertainment tax');
      break;
    }
    case 'jail': log(`${pL(p)} is just visiting the Burnout Clinic.`); break;
    case 'rest': changeKew(p, +1, 'Rest Stop'); break;
    case 'gotojail': await sendToClinic(p, true); break;
  }
}
async function sendToClinic(p, overtime) {
  await notice(p, overtime ? '⏰ Lembur Dulu / Go to Overtime' : '🏥 Klinik Burnout', `<p>${overtime ? 'Nobody asked for overtime. Nobody refused it. <b>-2 Kewarasan.</b><br>' : ''}Sent to the Burnout Clinic: skip your next <b>2 turns</b> and lose <b>1 Kewarasan</b>.</p>`);
  G.turnOver = true;
  if (overtime) changeKew(p, -2, 'Overtime');
  p.pos = R.JAIL_POS; p.skip = R.JAIL_SKIPS; renderAll();
  changeKew(p, -1, 'sent to Burnout Clinic');
}

// ---------- management (Self-Care, Cicilan, Renovasi) ----------
function playSelfCare(p, idx) {
  const h = p.hand[idx]; if (!h) return; const card = CARD[h.id];
  p.hand.splice(idx, 1);
  if (!h.starter) G.decks.modern.discard.push(card.id);
  changeKew(p, card.e.kew, card.titleEn); p.stats.selfCare++;
}
function borrow(p) { if (p.loans >= R.LOAN_MAX) return; p.loans++; p.cash += R.LOAN_UNIT; log(`${pL(p)} takes a <b>Cicilan</b> loan of ${fmt(R.LOAN_UNIT)} (${p.loans} outstanding)`); }
function repay(p) { const cost = R.LOAN_UNIT + R.LOAN_INTEREST; if (!p.loans || p.cash < cost) return; p.loans--; p.cash -= cost; log(`${pL(p)} repays a Cicilan loan (${fmt(cost)})`); }
function addReno(p, pos) { if (G.owners[pos] !== p.id || G.reno[pos] >= R.RENO_MAX || p.cash < R.RENO_COST) return; p.cash -= R.RENO_COST; G.reno[pos]++; log(`${pL(p)} adds Renovasi to ${esc(TILES[pos].en)}`); }
function sellReno(p, pos) { if (G.owners[pos] !== p.id || G.reno[pos] < 1) return; G.reno[pos]--; p.cash += R.RENO_COST / 2; log(`${pL(p)} sells a Renovasi token on ${esc(TILES[pos].en)}`); }
function manageHtml(p) {
  const hand = p.hand.map((h, i) => { const c = CARD[h.id]; return `<div class="li"><div class="l"><b>${esc(c.titleEn)}</b><small>${esc(c.en)}</small></div><button class="btn sm good" data-act="play" data-i="${i}">+${c.e.kew} 🧠 Play</button></div>`; }).join('') || '<p class="pitch">No Self-Care cards. Draw them from Hidup Modern tiles.</p>';
  const insts = ownedBy(p).filter(q => TILES[q].kind === 'inst').map(q => `<div class="li"><div class="l"><b>${esc(TILES[q].en)}</b><small>Renovasi ${G.reno[q]}/3 · rent ${fmt(rentFor(q))}</small></div>
    <button class="btn sm alt" data-act="sell" data-pos="${q}" ${G.reno[q] < 1 ? 'disabled' : ''}>−</button>
    <button class="btn sm" data-act="reno" data-pos="${q}" ${G.reno[q] >= 3 || p.cash < R.RENO_COST ? 'disabled' : ''}>+ ${fmt(R.RENO_COST)}</button></div>`).join('') || '<p class="pitch">You own no Institutions yet.</p>';
  return `<p>Cash <b>${fmt(p.cash)}</b> · Kewarasan <b>${p.kew}/10</b></p>
    <div class="sec"><h4>🌿 Self-Care cards (${p.hand.length})</h4>${hand}</div>
    <div class="sec"><h4>🏦 Cicilan — ${p.loans}/${R.LOAN_MAX} loans · each drains 1 Kewarasan at the start of your turn</h4>
      <div class="li"><div class="l"><b>Borrow ${fmt(R.LOAN_UNIT)}</b><small>Max ${R.LOAN_MAX} loans (${fmt(R.LOAN_UNIT * R.LOAN_MAX)})</small></div><button class="btn sm bad" data-act="borrow" ${p.loans >= R.LOAN_MAX ? 'disabled' : ''}>Borrow</button></div>
      <div class="li"><div class="l"><b>Repay one loan</b><small>${fmt(R.LOAN_UNIT)} + ${fmt(R.LOAN_INTEREST)} interest</small></div><button class="btn sm good" data-act="repay" ${!p.loans || p.cash < R.LOAN_UNIT + R.LOAN_INTEREST ? 'disabled' : ''}>Repay</button></div>
      ${p.paylater.length ? `<p class="tag-d">Paylater tokens on your card: ${p.paylater.map(fmt).join(', ')} — each comes due on a 6 at the start of your turn.</p>` : ''}</div>
    <div class="sec"><h4>🤝 Trade / Tukar</h4>
      <div class="li"><div class="l"><b>Trade with another player</b><small>Cash, deeds and Self-Care cards. Kewarasan can never be traded.</small></div><button class="btn sm" data-act="trade" ${alive().length < 2 ? 'disabled' : ''}>Open trade</button></div></div>
    <div class="sec"><h4>🔨 Renovasi — ${fmt(R.RENO_COST)} each, +${fmt(R.RENO_RENT)} rent, max 3 · sell back at half</h4>${insts}</div>`;
}
function openManage(p) {
  return new Promise(res => {
    const render = () => { $('#modal-body').innerHTML = manageHtml(p); renderAll(); };
    openModal('Manage / Kelola', manageHtml(p), [{ label: 'Done / Selesai', value: 1, onClick: () => { closeModal(); res(); } }], {
      wide: true, noFocus: true,
      handler: (a, d) => {
        if (a === 'trade') { closeModal(); res('trade'); return; }
        if (a === 'play') playSelfCare(p, +d.i); else if (a === 'borrow') borrow(p); else if (a === 'repay') repay(p);
        else if (a === 'reno') addReno(p, +d.pos); else if (a === 'sell') sellReno(p, +d.pos);
        render();
      },
    });
  });
}


// ---------- trading (rulebook 4.8: cash, deeds and Self-Care cards, any time on your turn) ----------
const tradeEmpty = () => ({ cash: 0, deeds: [], cards: [] });
function tradeValue(who, s) {
  let v = s.cash;
  s.deeds.forEach(q => { v += TILES[q].price + G.reno[q] * R.RENO_COST * 0.8; });
  s.cards.forEach(i => { v += CARD[who.hand[i].id].e.kew * (who.kew <= 8 ? 1300000 : 600000); });
  return v;
}
function tradeHtml(p, t) {
  const others = alive().filter(q => q.id !== p.id), q = G.players[t.partner];
  const side = (who, s, key, title) => `<div class="sec"><h4>${title}</h4>
    <div class="li"><div class="l"><b>Cash ${fmt(s.cash)}</b><small>up to ${fmt(who.cash)}</small></div>
      <button class="btn sm alt" data-act="tcash" data-side="${key}" data-d="-500000">−</button><button class="btn sm" data-act="tcash" data-side="${key}" data-d="500000">+ 500k</button></div>
    ${ownedBy(who).map(pos => `<div class="li"><div class="l"><b>${esc(TILES[pos].en)}</b><small>${TILES[pos].kind === 'inst' ? 'Renovasi ' + G.reno[pos] + '/3 · ' : ''}${fmt(TILES[pos].price)}</small></div>
      <button class="btn sm ${s.deeds.includes(pos) ? 'good' : 'alt'}" data-act="tdeed" data-side="${key}" data-pos="${pos}">${s.deeds.includes(pos) ? '✓ In offer' : 'Add'}</button></div>`).join('')}
    ${who.hand.map((h, i) => `<div class="li"><div class="l"><b>🌿 ${esc(CARD[h.id].titleEn)}</b><small>+${CARD[h.id].e.kew} Kewarasan when played</small></div>
      <button class="btn sm ${s.cards.includes(i) ? 'good' : 'alt'}" data-act="tcard" data-side="${key}" data-i="${i}">${s.cards.includes(i) ? '✓ In offer' : 'Add'}</button></div>`).join('')}</div>`;
  return `<div class="sec"><h4>Trade with</h4><div class="seg">${others.map(o => `<button type="button" data-act="tpartner" data-id="${o.id}" class="${o.id === t.partner ? 'on' : ''}">${o.emoji} ${esc(o.name)}</button>`).join('')}</div></div>
    ${side(p, t.give, 'give', 'You give / Kamu beri')}${side(q, t.get, 'get', esc(q.name) + ' gives / diberi ' + esc(q.name))}`;
}
function tradeEmptyOffer(t) { const e = s => !s.cash && !s.deeds.length && !s.cards.length; return e(t.give) && e(t.get); }
function executeTrade(p, q, t) {
  p.cash -= t.give.cash; q.cash += t.give.cash; q.cash -= t.get.cash; p.cash += t.get.cash;
  t.give.deeds.forEach(pos => G.owners[pos] = q.id); t.get.deeds.forEach(pos => G.owners[pos] = p.id);
  const pc = t.give.cards.map(i => p.hand[i]), qc = t.get.cards.map(i => q.hand[i]);
  p.hand = p.hand.filter((_, i) => !t.give.cards.includes(i)).concat(qc);
  q.hand = q.hand.filter((_, i) => !t.get.cards.includes(i)).concat(pc);
  const desc = (s) => [s.cash ? fmt(s.cash) : '', ...s.deeds.map(x => TILES[x].en), ...(s.cards.length ? [s.cards.length + ' Self-Care'] : [])].filter(Boolean).join(', ') || 'nothing';
  log(`🤝 ${pL(p)} gives <b>${esc(desc(t.give))}</b> and gets <b>${esc(desc(t.get))}</b> from ${pL(q)}`);
  toast(`🤝 ${p.emoji} ⇄ ${q.emoji} trade done`, 'good');
  renderAll();
}
function offerSummary(p, q, t) {
  const list = (s, who) => `<ul style="margin:4px 0 4px 18px;padding:0">${[s.cash ? `<li>${fmt(s.cash)}</li>` : '', ...s.deeds.map(x => `<li>${esc(TILES[x].en)}${G.reno[x] ? ' (+' + G.reno[x] + ' Renovasi)' : ''}</li>`), ...s.cards.map(i => `<li>🌿 ${esc(CARD[who.hand[i].id].titleEn)}</li>`)].join('') || '<li>nothing</li>'}</ul>`;
  return `<p>${pL(p)} offers:</p>${list(t.give, p)}<p>…and asks ${pL(q)} for:</p>${list(t.get, q)}`;
}
async function botAcceptsTrade(q, p, t) {
  const got = tradeValue(p, t.give), gave = tradeValue(q, t.get);
  if (q.cash + t.give.cash - t.get.cash < 800000) return false;
  return got >= gave * 1.05 && got > 0;
}
async function openTrade(p) {
  const others = alive().filter(q => q.id !== p.id); if (!others.length) return;
  const t = { partner: others[0].id, give: tradeEmpty(), get: tradeEmpty() };
  const result = await new Promise(res => {
    const render = () => { $('#modal-body').innerHTML = tradeHtml(p, t); };
    openModal('🤝 Trade / Tukar', tradeHtml(p, t), [
      { label: 'Propose / Ajukan', cls: 'good', onClick: () => {
        const q = G.players[t.partner];
        if (tradeEmptyOffer(t)) return toast('Add something to the offer first', 'bad');
        if (t.give.cash > p.cash || t.get.cash > q.cash) return toast('Someone can’t cover that cash amount', 'bad');
        closeModal(); res('go'); } },
      { label: 'Cancel / Batal', cls: 'alt', onClick: () => { closeModal(); res('cancel'); } },
    ], { wide: true, noFocus: true, handler: (a, d) => {
      const q = G.players[t.partner], s = d.side === 'give' ? t.give : t.get, who = d.side === 'give' ? p : q;
      if (a === 'tpartner') { t.partner = +d.id; t.give = tradeEmpty(); t.get = tradeEmpty(); }
      else if (a === 'tcash') s.cash = clamp(s.cash + +d.d, 0, who.cash);
      else if (a === 'tdeed') { const k = s.deeds.indexOf(+d.pos); k >= 0 ? s.deeds.splice(k, 1) : s.deeds.push(+d.pos); }
      else if (a === 'tcard') { const k = s.cards.indexOf(+d.i); k >= 0 ? s.cards.splice(k, 1) : s.cards.push(+d.i); }
      render();
    } });
  });
  if (result !== 'go') return;
  const q = G.players[t.partner];
  let ok;
  if (q.human) ok = await ask({ title: `🤝 ${esc(q.name)}, a trade offer`, body: offerSummary(p, q, t), buttons: [{ label: 'Accept / Terima', value: true, cls: 'good' }, { label: 'Decline / Tolak', value: false, cls: 'alt' }] });
  else { await sleep(700, q); ok = await botAcceptsTrade(q, p, t); }
  if (ok) { executeTrade(p, q, t); await notice(p, '🤝 Deal!', `<p>${esc(q.name)} accepted the trade.</p>`, 1200); }
  else { log(`${pL(q)} declines ${pL(p)}'s trade offer`); await notice(p, 'Trade declined', `<p>${esc(q.name)} said no. <i>Tidak.</i></p>`, 1400); }
}

// ---------- bot logic ----------
function botManage(p) {
  while (p.hand.length && (p.kew <= 7 || (p.kew <= 9 && CARD[p.hand[0].id].e.kew === 1))) playSelfCare(p, 0);
  while (p.loans && p.cash >= R.LOAN_UNIT + R.LOAN_INTEREST + 1500000) repay(p);
  const mine = ownedBy(p).filter(q => TILES[q].kind === 'inst' && G.reno[q] < R.RENO_MAX).sort((a, b) => TILES[b].price - TILES[a].price);
  for (const q of mine) { if (p.cash - R.RENO_COST >= 3500000) addReno(p, q); }
}

// ---------- turn flow ----------
async function waitAction(p, mode) {
  if (!p.human) { botManage(p); renderAll(); return mode; }
  while (true) {
    setActions(mode);
    const a = await new Promise(r => { UI.actionResolver = r; });
    if (a === 'manage') { setActions('none'); if (await openManage(p) === 'trade') await openTrade(p); continue; }
    setActions('none'); return a;
  }
}
async function startOfTurn(p) {
  if (p.paylater.length) {
    const lines = [], keep = [], due = [];
    for (const amt of p.paylater) {
      const d = 1 + Math.floor(Math.random() * 6);
      if (d === 6) { due.push(amt); lines.push(`🎲 ${d} — <b>due!</b> Pay ${fmt(amt)}`); } else { keep.push(amt); lines.push(`🎲 ${d} — ${fmt(amt)} token stays`); }
    }
    p.paylater = keep;
    log(`${pL(p)} checks Paylater tokens: ${due.length} due`);
    await notice(p, '💳 Paylater check', `<p>${lines.join('<br>')}</p>`);
    for (const amt of due) pay(p, amt, null, 'Paylater came due');
  }
  if (p.loans) {
    await notice(p, '🏦 Cicilan', `<p>You owe ${p.loans} loan(s). Each drains 1 Kewarasan.</p>`, 1500);
    changeKew(p, -p.loans, `${p.loans} Cicilan loan(s)`);
  }
}
async function playTurn() {
  const p = G.players[G.cur];
  G.turnOver = false; G.turnNo++;
  renderAll(); setActions('none');
  if (!AUTOTEST) $('#turnInfo').innerHTML = `${pL(p)}`;
  try {
    if (p.skip > 0) {
      p.skip--; log(`${pL(p)} skips this turn (${p.skip} more to skip)`);
      if (p.human || !G.settings.fast) toast(`${p.emoji} ${esc(p.name)} is skipping this turn`);
      await sleep(900, p); return;
    }
    await startOfTurn(p);
    let doubles = 0;
    for (;;) {
      await waitAction(p, 'roll');
      const [a, b] = await rollDice(p);
      const dbl = a === b; if (dbl) doubles++;
      if (dbl && doubles === 3) { log(`${pL(p)} rolled three doubles in a row!`); await sendToClinic(p, true); break; }
      await walk(p, a + b);
      await resolveTile(p);
      if (G.turnOver) break;
      if (dbl) { log(`${pL(p)} earns a Meme card and rolls again`); await drawCard(p, 'meme'); if (G.turnOver) break; continue; }
      break;
    }
    if (!G.turnOver) await waitAction(p, 'end');
  } catch (e) {
    if (e instanceof Out) await eliminate(p); else throw e;
  }
}
// Optional house rule: every `creep` full rounds, everyone loses 1 Kewarasan ("hari-hari berat").
async function roundTick() {
  const n = G.settings.creep;
  if (!n || G.round % n !== 0) return;
  log(`<b>Burnout creep</b> — round ${G.round}: everyone loses 1 Kewarasan.`);
  toast('Burnout creep: everyone -1 Kewarasan', 'bad');
  await sleep(600);
  for (const p of alive()) {
    try { changeKew(p, -1, 'Burnout creep'); } catch (e) { if (e instanceof Out) await eliminate(p); else throw e; }
  }
}
async function eliminate(p) {
  p.alive = false; p.kew = 0;
  log(`💀 ${pL(p)} reaches 0 Kewarasan — <b>BURNOUT</b>. Out of the game.`);
  const props = ownedBy(p);
  G.bank += p.cash; p.cash = 0; p.loans = 0; p.paylater = []; p.skip = 0;
  p.hand.forEach(h => { if (!h.starter) G.decks.modern.discard.push(h.id); }); p.hand = [];
  renderAll();
  await notice(p, '💀 Burnout / Kehabisan Kewarasan', `<p>${pL(p)} is out. Their cash returns to the bank${props.length ? `, and their ${props.length} propert${props.length > 1 ? 'ies go' : 'y goes'} to auction at half price.` : '.'}</p>`, 2200);
  props.forEach(q => G.owners[q] = null);
  if (alive().length > 1) for (const q of props) await auction(q, p.id, 'Burnout liquidation');
  renderAll();
}
function checkEnd() {
  const al = alive();
  if (al.length <= 1) return { winner: al[0] || null, reason: 'last' };
  if (G.turnNo >= R.MAX_TURNS) return { winner: al.sort((a, b) => b.kew - a.kew || b.cash - a.cash)[0], reason: 'turns' };
  if (G.settings.timeLimit && G.elapsed >= R.TIME_LIMIT) return { winner: al.sort((a, b) => b.kew - a.kew || b.cash - a.cash)[0], reason: 'time' };
  return null;
}
async function loop() {
  while (G && !G.over) {
    save();
    await playTurn();
    if (!G) return;
    const end = checkEnd();
    if (end) { await gameOver(end); return; }
    const prev = G.cur;
    do { G.cur = (G.cur + 1) % G.players.length; } while (!G.players[G.cur].alive);
    if (G.cur <= prev) { G.round++; await roundTick(); const e2 = checkEnd(); if (e2) { await gameOver(e2); return; } while (!G.players[G.cur].alive) G.cur = (G.cur + 1) % G.players.length; }
    if (!AUTOTEST && G.turnNo % 8 === 0) await new Promise(r => setTimeout(r, 0));
    if (AUTOTEST && G.turnNo % 50 === 0) await new Promise(r => setTimeout(r, 0));
  }
}
async function gameOver(end) {
  G.over = true; clearSave(); closeModal();
  window.__result = { winner: end.winner && end.winner.name, reason: end.reason, turns: G.turnNo, players: G.players.map(p => ({ name: p.name, alive: p.alive, kew: p.kew, cash: p.cash })) };
  if (AUTOTEST) return;
  const w = end.winner;
  const reasonTxt = end.reason === 'last' ? 'Last one still sane.' : end.reason === 'time' ? '90 minutes are up: highest Kewarasan wins (cash breaks ties).' : 'Turn limit reached: highest Kewarasan wins.';
  const rows = G.players.slice().sort((a, b) => (b.alive - a.alive) || b.kew - a.kew || b.cash - a.cash).map(p =>
    `<tr><td>${pL(p)}</td><td>${p.alive ? p.kew + '/10' : '💀 out'}</td><td>${fmt(p.cash)}</td><td>${ownedBy(p).length}</td><td>${p.stats.kewLost}</td></tr>`).join('');
  $('#actions').innerHTML = '<div class="who">Game over</div>';
  await ask({
    title: 'Game over / Permainan selesai',
    body: `<div class="big-win">${w ? w.emoji : '🤷'}</div><h2 style="text-align:center;margin:0">${w ? esc(w.name) + ' stays sane!' : 'Nobody survived.'}</h2>
      <p style="text-align:center;color:var(--muted)">${reasonTxt}<br><i>${w ? 'Waras. Barely.' : 'Semua bangkrut mental.'}</i></p>
      <table class="res"><tr><th>Player</th><th>Kew.</th><th>Cash</th><th>Deeds</th><th>Kew. lost</th></tr>${rows}</table><p class="pitch">${G.turnNo} turns · ${fmtClock(G.elapsed)}</p>`,
    buttons: [{ label: 'Play again / Main lagi', value: 1 }, { label: 'Stay on board', value: 0, cls: 'alt' }], wide: true,
  }).then(v => { if (v) showSetup(); });
}

// ---------- save / load ----------
function save() {
  if (AUTOTEST || !G || G.over) return;
  try {
    const s = { ...G, decks: G.decks, saved: Date.now() };
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch (e) { /* storage may be unavailable */ }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
function loadSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.players && !s.over ? s : null; } catch (e) { return null; } }

// ---------- setup ----------
function newGame(cfg) {
  const decks = {};
  const keys = Object.keys(DECKS);
  keys.forEach(k => decks[k] = { draw: shuffle(CARDS.filter(c => c.deck === k).map(c => c.id)), discard: [] });
  const players = cfg.players.map((pc, i) => ({
    id: i, name: pc.name, human: pc.human, color: COLORS[i], emoji: EMOJI[i],
    cash: R.START_CASH, kew: R.START_KEW, pos: 0, skip: 0, loans: 0, paylater: [],
    // Setup step: 2 Self-Care cards each. The deck keeps its 6 Self-Care cards, so these are starter copies.
    hand: [0, 1].map(() => ({ id: SELFCARE[Math.floor(Math.random() * SELFCARE.length)], starter: true })),
    alive: true, stats: { kewLost: 0, paid: 0, rentPaid: 0, selfCare: 0 },
  }));
  return { players, owners: Array(40).fill(null), reno: Array(40).fill(0), decks, cur: Math.floor(Math.random() * players.length), turnNo: 0, elapsed: 0, bank: 0, over: false, turnOver: false, logCount: 0, settings: { fast: cfg.fast, timeLimit: cfg.timeLimit, creep: cfg.creep || 0 }, round: 0 };
}
function fmtClock(ms) { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function startGame(state) {
  G = state; window.__game = G;
  $('#setup').classList.add('hidden'); $('#game').classList.remove('hidden');
  buildBoard(); $('#log').innerHTML = ''; renderAll(); log('The game begins. Stay sane. / Permainan dimulai. Tetap waras.');
  loop();
}
function showSetup() {
  G = null; document.body.classList.remove('lowsanity');
  $('#game').classList.add('hidden'); $('#setup').classList.remove('hidden'); closeModal();
  const saved = loadSave();
  let n = 3; const slots = Array.from({ length: 6 }, (_, i) => ({ name: i === 0 ? 'Player 1' : BOT_NAMES[i], human: i === 0 }));
  const root = $('#setup');
  const draw = () => {
    root.innerHTML = `<h1>KEWARASAN</h1><p class="tag"><b>Last one still sane wins.</b> / Yang paling terakhir masih waras, dialah pemenangnya.<br>A satirical Monopoly-style game about money, work, politics and modern life. Ages 17+.</p>
      ${saved ? `<div class="card-panel"><h3>Saved game / Permainan tersimpan</h3><p class="pitch">${saved.players.length} players · turn ${saved.turnNo} · ${fmtClock(saved.elapsed)} played</p><div class="start-row"><button class="btn" id="cont">Continue / Lanjutkan</button><button class="btn alt" id="disc">Discard</button></div></div>` : ''}
      <div class="card-panel"><h3>Players / Pemain (3–6)</h3>
        <div class="seg" id="np">${[3, 4, 5, 6].map(k => `<button type="button" data-n="${k}" class="${k === n ? 'on' : ''}">${k}</button>`).join('')}</div>
        ${slots.slice(0, n).map((s, i) => `<div class="prow"><div class="tok">${EMOJI[i]}</div><input type="text" maxlength="14" value="${esc(s.name)}" data-i="${i}" aria-label="Player ${i + 1} name"><div class="seg" data-h="${i}"><button type="button" data-v="1" class="${s.human ? 'on' : ''}">Human</button><button type="button" data-v="0" class="${s.human ? '' : 'on'}">Bot</button></div></div>`).join('')}
        <p class="pitch">Pass-and-play: several humans can share one screen. Bots fill the empty seats.</p></div>
      <div class="card-panel"><h3>Options</h3>
        <label class="chk"><input type="checkbox" id="oTime" checked><span>90-minute time limit<small>When time runs out, highest Kewarasan wins (cash breaks ties).</small></span></label>
        <label class="chk"><input type="checkbox" id="oCreep" checked><span>Burnout creep (house rule, recommended)<small>Every ${creepFor(n)} full rounds, everyone loses 1 Kewarasan, so games finish in 60–90 minutes. Turn off for the pure rulebook, where games can run very long.</small></span></label>
        <label class="chk"><input type="checkbox" id="oFast" checked><span>Fast bots<small>Bots move and answer quickly.</small></span></label></div>
      <div class="start-row"><button class="btn big" id="start">Start game / Mulai</button><button class="btn alt big" id="rules">How to play / Cara main</button></div>`;
    root.querySelectorAll('#np button').forEach(b => b.onclick = () => { n = +b.dataset.n; keepNames(); draw(); });
    root.querySelectorAll('.seg[data-h] button').forEach(b => b.onclick = () => { const i = +b.parentElement.dataset.h; keepNames(); slots[i].human = b.dataset.v === '1'; if (!slots[i].human && /^Player \d$/.test(slots[i].name)) slots[i].name = BOT_NAMES[i]; if (slots[i].human && BOT_NAMES.includes(slots[i].name)) slots[i].name = 'Player ' + (i + 1); draw(); });
    $('#start').onclick = () => { keepNames(); clearSave(); startGame(newGame({ players: slots.slice(0, n).map(s => ({ ...s, name: s.name.trim() || 'Player' })), fast: $('#oFast').checked, timeLimit: $('#oTime').checked, creep: $('#oCreep').checked ? creepFor(n) : 0 })); };
    $('#rules').onclick = showRules;
    if (saved) { $('#cont').onclick = () => { const s = saved; s.logCount = 0; s.turnOver = false; startGame(s); }; $('#disc').onclick = () => { clearSave(); showSetup(); }; }
  };
  const keepNames = () => root.querySelectorAll('input[data-i]').forEach(inp => { slots[+inp.dataset.i].name = inp.value; });
  draw();
}
function showRules() {
  if (UI.modalOpen) return;
  ask({
    title: 'How to play / Cara main', wide: true, buttons: [{ label: 'Got it', value: 1 }],
    body: `<div class="rules">
    <h4>Goal</h4><p>Everyone starts with <b>10 Kewarasan</b> (Sanity) and Rp 15,000,000. Life wears Kewarasan down. At 0 you hit <b>Burnout</b> and you’re out. The last player above 0 wins. Money never eliminates you; when it runs out it turns into Kewarasan loss.</p>
    <h4>Your turn</h4><ul><li>Start: roll a die for each <b>Paylater</b> token (a 6 = due), then lose 1 Kewarasan per <b>Cicilan</b> loan.</li><li>Roll two dice, move, resolve the tile (buy, rent, card, tax).</li><li>Doubles: draw a Meme card and roll again. Three doubles in a row = Lembur Dulu.</li><li>Any time on your turn use <b>Manage</b>: play Self-Care cards, borrow/repay Cicilan, buy Renovasi.</li></ul>
    <h4>Kewarasan</h4><ul><li>Gain: pass GO (+1, plus Rp 2,000,000; landing exactly on GO gives +1 more), Rest Stop (+1), Self-Care cards, good cards. Capped at 10.</li><li>Lose: bad cards, loans, taxes, traffic, Burnout Clinic, unpaid debt (1 per Rp 500,000 you can’t cover).</li></ul>
    <h4>Property</h4><ul><li><b>Institutions</b>: buy or auction (opening at half price). Renovasi: Rp 500,000 each, +Rp 100,000 rent, max 3.</li><li><b>Transit</b>: rent grows with how many you own. Decline an unowned one and you’re stuck in traffic (-1).</li><li><b>Utilities</b>: fixed bills (PLN Rp 400,000, PDAM Rp 250,000), paid to the owner or the bank.</li><li>Tax tiles: pay money <i>or</i> Kewarasan, your choice.</li></ul>
    <h4>Short on cash?</h4><p>Renovasi tokens are sold back at half cost, then deeds at half price. Anything still unpaid becomes -1 Kewarasan per Rp 500,000, rounded up.</p>
    <h4>Winning</h4><p>Last player above 0. If the 90-minute clock runs out, highest Kewarasan wins, with cash as the tiebreak.</p>
    <h4>How this digital edition fills the rulebook’s gaps</h4><ul><li>Each player starts with 2 Self-Care cards in hand (the deck keeps its own 6). Self-Care cards you draw are kept and played from Manage.</li><li>“Move to any Institution” is a direct move (no GO bonus). “Move to next Institution” walks forward and can pass GO.</li><li>Lembur Dulu costs 2 Kewarasan, then the Clinic costs 1 more and you skip 2 turns.</li><li>On an unowned Utility you may buy it, otherwise you pay its bill to the bank. Declined Transit tiles aren’t auctioned.</li><li>Skipped turns are skipped entirely (no Paylater roll or Cicilan drain).</li><li><b>Trading</b> (Manage → Open trade): offer cash, deeds and Self-Care cards for the other player’s. A human partner accepts or declines; a bot accepts if it comes out ahead. Renovasi tokens stay on the deed.</li><li><b>Burnout creep</b> (optional, on by default): every few full rounds everyone loses 1 Kewarasan. It is not in the rulebook; it keeps games inside 60–90 minutes.</li></ul>
    <p class="pitch">Full text: <a href="docs/rulebook.md" style="color:var(--accent)">rulebook</a> · <a href="docs/cards.md" style="color:var(--accent)">card list</a></p></div>`,
  });
}

// ---------- boot ----------
setInterval(() => { if (G && !G.over && !document.hidden && !AUTOTEST) { G.elapsed += 1000; $('#clock').textContent = fmtClock(G.elapsed); } }, 1000);
$('#btnRules').onclick = showRules;
$('#btnNew').onclick = async () => {
  if (UI.modalOpen) return;
  if (G && !G.over) { const v = await ask({ title: 'Leave this game?', body: '<p>Your game is saved at the start of each turn, so you can continue it later.</p>', buttons: [{ label: 'Back to menu', value: 1 }, { label: 'Keep playing', value: 0, cls: 'alt' }] }); if (!v) return; G.over = true; save(); G.over = false; }
  G = null; UI.actionResolver = null; showSetup();
};

if (AUTOTEST) {
  const n = clamp(parseInt(params.get('autoplay')) || 4, 3, 6);
  window.__done = new Promise(res => {
    const t = setInterval(() => { if (window.__result) { clearInterval(t); res(window.__result); } }, 20);
  });
  buildBoard();
  startGame(newGame({ players: Array.from({ length: n }, (_, i) => ({ name: BOT_NAMES[i], human: false })), fast: true, timeLimit: false, creep: parseInt(params.get('creep')) || 0 }));
} else showSetup();
})();
