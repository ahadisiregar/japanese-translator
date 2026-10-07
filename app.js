(() => {
  const $ = (id) => document.getElementById(id);
  const source = $('source'), target = $('target'), statusEl = $('status'), btn = $('translate'), hint = $('hint');
  const wbw = $('wbw'), card = $('aligned'), note = $('aligned-note');

  const LANGS = {
    ja: { name: 'Japanese', speech: 'ja-JP', placeholder: 'こんにちは、元気ですか？  or  konnichiwa, genki desu ka?' },
    en: { name: 'English', speech: 'en-US', placeholder: 'Type English here' },
  };
  const HUES = [215, 350, 150, 32, 275, 185, 52, 320]; // one per highlighted pair, then repeating

  let from = 'ja', to = 'en';
  let run = 0;     // bumped when a translation starts or is cancelled, so late answers are ignored
  let last = null; // the latest translation: { src, tgt, from, to, links }

  // localStorage can be missing or blocked, so every use is guarded.
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---- Input ---------------------------------------------------------------------------------

  // Japanese input may be romaji: Latin runs that read as valid Japanese become kana.
  const prepare = (text) => (from === 'ja' ? Romaji.toKana(text) : text);

  function updateHint() {
    const text = source.value;
    const kana = prepare(text);
    hint.hidden = !(from === 'ja' && kana !== text && text.trim());
    if (hint.hidden) return;
    const b = document.createElement('b');
    b.textContent = kana;
    hint.replaceChildren('Reading romaji as: ', b);
  }

  const updateCount = () => { $('count').textContent = source.value.length + ' / 5000'; };

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.className = isError ? 'error' : '';
  }

  function renderLangs() {
    $('from-name').textContent = $('source-label').textContent = LANGS[from].name;
    $('to-name').textContent = $('target-label').textContent = LANGS[to].name;
    source.lang = from;
    target.lang = to;
    source.placeholder = LANGS[from].placeholder;
    target.placeholder = 'Translation appears here';
    updateHint();
  }

  // ---- Translating ---------------------------------------------------------------------------

  // Forget the current translation (and its word-by-word view); late answers will be ignored.
  function cancelRun() {
    run++;
    last = null;
    card.hidden = true;
    btn.disabled = false;
  }

  async function translate() {
    if (btn.disabled) return;
    const typed = source.value;
    const text = prepare(typed).trim();
    cancelRun();
    if (!text) { target.value = ''; setStatus(''); return; }
    const id = run;
    btn.disabled = true;
    setStatus('Translating…');
    try {
      const out = await Engine.translate(text, from, to, (partial) => { if (id === run) target.value = partial; });
      if (id !== run) return;
      target.value = out;
      setStatus('');
      last = { src: typed, tgt: out, from, to };
      showAligned(last);
    } catch (e) {
      if (id === run) setStatus((e && e.message) || 'Translation failed', true);
    } finally {
      if (id === run) btn.disabled = false;
    }
  }

  // ---- Word by word ----------------------------------------------------------------------------

  let hovered = null, focused = null, pinned = null; // the highlighted pair: hover, then focus, then a click

  function setNote(msg, isError = false) {
    note.textContent = msg;
    note.className = 'aligned-note' + (isError ? ' error' : '');
  }

  function paint() {
    const k = hovered ?? focused ?? pinned;
    card.classList.toggle('has-active', k !== null);
    for (const el of card.querySelectorAll('.seg[data-link]')) el.classList.toggle('active', Number(el.dataset.link) === k);
  }

  function clearAligned() {
    hovered = focused = pinned = null;
    for (const id of ['flow-src', 'flow-tgt', 'aligned-list']) $(id).replaceChildren();
    paint();
  }

  const findLinks = (snap) => (Engine.align
    ? Engine.align(snap)
    : Align.probe({
      src: snap.src, tgt: snap.tgt, from: snap.from, to: snap.to,
      translateMany: Engine.translateMany, max: Engine.maxProbes, query: snap.from === 'ja' ? Romaji.toKana : undefined,
    }));

  async function showAligned(snap) {
    if (!wbw.checked || last !== snap) return;
    card.hidden = false;
    if (snap.links) { renderAligned(snap); return; }
    if (snap.pending) return;
    snap.pending = true;
    clearAligned();
    setNote('Matching words…');
    try {
      snap.links = await findLinks(snap);
    } catch (e) {
      console.error(e);
    }
    snap.pending = false;
    if (last !== snap || !wbw.checked) return;
    if (snap.links) renderAligned(snap);
    else setNote("Couldn't match the words this time. The translation above is still fine.", true);
  }

  function chip(text, link) {
    const el = document.createElement('span');
    el.className = link === null ? 'seg plain' : 'seg';
    el.textContent = text;
    if (link !== null) {
      el.dataset.link = link;
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.style.setProperty('--h', HUES[link % HUES.length]);
    }
    return el;
  }

  function fillFlow(box, text, links, side, lang) {
    box.lang = lang;
    box.replaceChildren(...Align.sideSegments(text, links, side).map((s) => (s.link === null ? document.createTextNode(s.text) : chip(s.text, s.link))));
  }

  function fillList(snap) {
    const part = (text, ranges) => ranges.map(([s, e]) => text.slice(s, e)).join(' … ');
    const title = (t) => Object.assign(document.createElement('div'), { className: 'col-title', textContent: t });
    const cell = (child, lang) => { const d = document.createElement('div'); d.className = 'cell'; d.lang = lang; d.append(child); return d; };
    const nodes = [title(LANGS[snap.from].name), document.createElement('div'), title(LANGS[snap.to].name)];
    snap.links.forEach((l, id) => {
      const linked = l.tgt.length > 0;
      const arrow = Object.assign(document.createElement('div'), { className: 'arrow', textContent: '→' });
      const right = linked ? chip(part(snap.tgt, l.tgt), id) : Object.assign(document.createElement('span'), { className: 'none', textContent: '—' });
      nodes.push(cell(chip(part(snap.src, l.src), linked ? id : null), snap.from), arrow, cell(right, snap.to));
    });
    $('aligned-list').replaceChildren(...nodes);
  }

  function renderAligned(snap) {
    clearAligned();
    $('flow-src-name').textContent = LANGS[snap.from].name;
    $('flow-tgt-name').textContent = LANGS[snap.to].name;
    fillFlow($('flow-src'), snap.src, snap.links, 'src', snap.from);
    fillFlow($('flow-tgt'), snap.tgt, snap.links, 'tgt', snap.to);
    fillList(snap);
    const matched = snap.links.some((l) => l.tgt.length);
    const more = snap.links.more ? ` Only the first ${snap.links.length} phrases were matched.` : '';
    setNote((matched ? 'Hover, tap or focus a phrase to see its match.' : 'No matching words found this time.') + more);
  }

  function setView(view) {
    const flow = view === 'flow';
    $('aligned-flow').hidden = !flow;
    $('aligned-list').hidden = flow;
    $('view-flow').setAttribute('aria-pressed', String(flow));
    $('view-list').setAttribute('aria-pressed', String(!flow));
    store.set('view', view);
  }

  function togglePin(el) {
    const k = el ? Number(el.dataset.link) : null;
    pinned = k === null || k === pinned ? null : k;
    paint();
  }

  const segOf = (e) => (e.target instanceof Element ? e.target.closest('.seg[data-link]') : null);
  card.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = segOf(e);
    hovered = el ? Number(el.dataset.link) : null;
    paint();
  });
  card.addEventListener('pointerleave', () => { hovered = null; paint(); });
  // Focus highlights a pair only when it comes from the keyboard; a mouse click also focuses the phrase.
  card.addEventListener('focusin', (e) => {
    const el = segOf(e);
    if (el && el.matches(':focus-visible')) { focused = Number(el.dataset.link); paint(); }
  });
  card.addEventListener('focusout', () => { focused = null; paint(); });
  card.addEventListener('click', (e) => togglePin(segOf(e)));
  card.addEventListener('keydown', (e) => {
    const el = segOf(e);
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); togglePin(el); }
  });
  $('view-flow').addEventListener('click', () => setView('flow'));
  $('view-list').addEventListener('click', () => setView('list'));

  wbw.addEventListener('change', () => {
    store.set('wbw', wbw.checked ? '1' : '0');
    if (!wbw.checked) card.hidden = true;
    else if (last && !btn.disabled) showAligned(last);
  });

  // ---- Everything else ---------------------------------------------------------------------------

  function speak(text, lang) {
    if (!text || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    speechSynthesis.speak(u);
  }

  btn.addEventListener('click', translate);
  source.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) translate(); });
  source.addEventListener('input', () => { updateCount(); updateHint(); });
  $('swap').addEventListener('click', () => {
    cancelRun();
    [from, to] = [to, from];
    source.value = target.value;
    target.value = '';
    updateCount();
    renderLangs();
    setStatus('');
  });
  $('clear').addEventListener('click', () => {
    cancelRun();
    source.value = target.value = '';
    updateCount();
    updateHint();
    setStatus('');
    source.focus();
  });
  $('copy').addEventListener('click', async () => {
    if (!target.value) return;
    try { await navigator.clipboard.writeText(target.value); setStatus('Copied!'); }
    catch { target.select(); document.execCommand('copy'); setStatus('Copied!'); }
  });
  $('speak-src').addEventListener('click', () => speak(source.value, LANGS[from].speech));
  $('speak-tgt').addEventListener('click', () => speak(target.value, LANGS[to].speech));

  const credit = $('credit');
  credit.append('Translations by ');
  if (Engine.credit.url) {
    const a = Object.assign(document.createElement('a'), { href: Engine.credit.url, target: '_blank', rel: 'noopener', textContent: Engine.credit.name });
    credit.append(a, '.');
  } else {
    credit.append(Engine.credit.name + '.');
  }

  wbw.checked = store.get('wbw') !== '0';
  setView(store.get('view') === 'list' ? 'list' : 'flow');
  renderLangs();
})();
