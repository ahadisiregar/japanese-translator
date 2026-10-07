(() => {
  const $ = (id) => document.getElementById(id);
  const source = $('source'), target = $('target'), statusEl = $('status'), btn = $('translate');
  const showKana = $('show-kana'), showRomaji = $('show-romaji'), wbw = $('wbw'), card = $('aligned'), note = $('aligned-note');

  const LANGS = {
    ja: { name: 'Japanese', speech: 'ja-JP', placeholder: 'こんにちは、元気ですか？  or  konnichiwa, genki desu ka?' },
    en: { name: 'English', speech: 'en-US', placeholder: 'Type English here' },
  };
  const HUES = [215, 350, 150, 32, 275, 185, 52, 320]; // one per highlighted pair, then repeating

  let from = 'ja', to = 'en';
  let run = 0;     // bumped when a translation starts or is cancelled, so late answers are ignored
  let last = null; // the latest finished translation: { src, tgt, from, to, links, segs }

  // localStorage can be missing or blocked, so every use is guarded.
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---- Input ---------------------------------------------------------------------------------

  // Japanese input may be romaji: Latin runs that read as valid Japanese become kana.
  const prepare = (text) => (from === 'ja' ? Romaji.toKana(text) : text);

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
    updateSourceReading();
  }

  // ---- Readings: hiragana and romaji under the Japanese text ----------------------------------------

  const boxes = { src: null, tgt: null }; // what each panel's reading box shows: { segs } | { note } | null

  function readingRow(label, text, lang) {
    const row = el('div', 'rd-row');
    const value = el('span', 'rd-text', text);
    value.lang = lang;
    row.append(el('span', 'rd-label', label), value);
    return row;
  }

  function drawBox(which) {
    const box = $('reading-' + which), content = boxes[which];
    if (!content || !(showKana.checked || showRomaji.checked)) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    if (content.note) { box.replaceChildren(el('div', 'rd-note', content.note)); return; }
    const { kana, romaji } = Reading.lines(content.segs);
    const rows = [];
    if (showKana.checked) rows.push(readingRow('Hiragana', kana, 'ja'));
    if (showRomaji.checked) rows.push(readingRow('Romaji', romaji, 'ja-Latn'));
    box.replaceChildren(...rows);
  }

  function setBox(which, content) {
    boxes[which] = content;
    drawBox(which);
  }

  const lookingNote = () => (Reading.status().loading ? Reading.status().loadingNote : 'Finding readings…');
  const failedNote = (e) => "Couldn't get the readings" + (e && e.message ? ': ' + e.message : '.');

  // Keep the reading under the source text up to date while typing. Text that needs a dictionary
  // is looked up shortly after typing stops, or (when that is costly) after the translation.
  let sourceTimer = 0, sourceRead = 0;
  function updateSourceReading() {
    clearTimeout(sourceTimer);
    const id = ++sourceRead;
    const text = source.value;
    if (from !== 'ja' || !text.trim()) { setBox('src', null); return; }
    const segs = Reading.known(text);
    if (segs) { setBox('src', { segs }); return; }
    const status = Reading.status();
    if (!status.available) { setBox('src', { note: 'Readings for this text are not available here.' }); return; }
    if (!status.live) { setBox('src', { note: 'Hiragana and romaji appear after you translate.' }); return; }
    setBox('src', { note: lookingNote() });
    sourceTimer = setTimeout(async () => {
      try {
        const pending = Reading.analyze(text);
        if (id === sourceRead && Reading.status().loading) setBox('src', { note: lookingNote() });
        const found = await pending;
        if (id === sourceRead) setBox('src', found ? { segs: found } : { note: 'Readings for this text are not available here.' });
      } catch (e) {
        if (id === sourceRead) setBox('src', { note: failedNote(e) });
      }
    }, 400);
  }

  // Read the Japanese side of a translation. The answer is kept on `snap` for the word-by-word view.
  function startReadings(snap, which, japanese) {
    snap.segs = Reading.known(japanese);
    if (snap.segs) { setBox(which, { segs: snap.segs }); return; }
    if (!Reading.status().available) { setBox(which, { note: 'Readings for this text are not available here.' }); return; }
    setBox(which, { note: lookingNote() });
    snap.readings = Reading.analyze(japanese).then(
      (segs) => { snap.segs = segs; return { segs }; },
      (e) => ({ note: failedNote(e) }),
    ).then((content) => {
      if (snap.id !== run) return;
      setBox(which, content.segs ? { segs: content.segs } : { note: content.note || 'Readings for this text are not available here.' });
      if (last === snap && snap.links) renderAligned(snap); // phrases get their readings
    });
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
    setBox('tgt', null);
    if (!text) { target.value = ''; setStatus(''); return; }
    const snap = { id: run, src: typed, tgt: '', from, to };
    btn.disabled = true;
    setStatus('Translating…');
    if (from === 'ja') startReadings(snap, 'src', typed); // alongside the translation
    try {
      const out = await Engine.translate(text, from, to, (partial) => { if (snap.id === run) target.value = partial; });
      if (snap.id !== run) return;
      target.value = out;
      setStatus('');
      snap.tgt = out;
      last = snap;
      if (to === 'ja') startReadings(snap, 'tgt', out);
      showAligned(snap);
    } catch (e) {
      if (snap.id === run) setStatus((e && e.message) || 'Translation failed', true);
    } finally {
      if (snap.id === run) btn.disabled = false;
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
    for (const node of card.querySelectorAll('.seg[data-link]')) node.classList.toggle('active', Number(node.dataset.link) === k);
  }

  function clearAligned() {
    hovered = focused = pinned = null;
    for (const id of ['flow-src', 'flow-tgt', 'aligned-list']) $(id).replaceChildren();
    paint();
  }

  async function findLinks(snap) {
    if (Engine.align) return Engine.align(snap);
    if (snap.readings) await snap.readings; // a dictionary cuts Japanese into phrases better than the built-in splitting
    return Align.probe({
      src: snap.src, tgt: snap.tgt, from: snap.from, to: snap.to,
      translateMany: Engine.translateMany, max: Engine.maxProbes,
      query: snap.from === 'ja' ? Romaji.toKana : undefined,
      spans: snap.from === 'ja' && snap.segs ? Reading.spans(snap.segs) : undefined,
    });
  }

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

  // Hiragana and romaji lines for a highlighted phrase, leaving out a line that repeats the phrase itself.
  const sameLetters = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  function readingLines(text, reading) {
    const out = [];
    if (!reading) return out;
    if (showKana.checked && reading.kana && !sameLetters(reading.kana, text)) out.push([reading.kana, 'ja']);
    if (showRomaji.checked && reading.romaji && !sameLetters(reading.romaji, text)) out.push([reading.romaji, 'ja-Latn']);
    return out;
  }

  // One phrase. `link` is its pair (null for none); `reading` is { kana, romaji } for Japanese phrases.
  function chip(text, link, reading, plain = false) {
    const lines = readingLines(text, reading);
    if (link === null && !plain && !reading) return document.createTextNode(text);
    const node = el('span', link !== null ? 'seg' : plain ? 'seg plain' : 'ann');
    if (reading) {
      node.classList.add('has-rd');
      node.append(el('span', 'main', text));
      for (const [line, lang] of lines) {
        const row = el('span', 'rd', line);
        row.lang = lang;
        node.append(row);
      }
    } else {
      node.textContent = text;
    }
    if (link !== null) {
      node.dataset.link = link;
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.style.setProperty('--h', HUES[link % HUES.length]);
    }
    return node;
  }

  const readRanges = (snap, ranges) => {
    if (!snap.segs) return null;
    const parts = ranges.map(([s, e]) => Reading.range(snap.segs, s, e));
    return { kana: parts.map((p) => p.kana).join(' … '), romaji: parts.map((p) => p.romaji).join(' … ') };
  };
  const part = (text, ranges) => ranges.map(([s, e]) => text.slice(s, e)).join(' … ');

  const CLOSING = /^[、。，．！？!?」』）】〉》…・]+$/;
  const OPENING = /^[「『（【〈《]+$/;

  function fillFlow(box, snap, side) {
    const text = snap[side], lang = side === 'src' ? snap.from : snap.to;
    box.lang = lang;
    const japanese = lang === 'ja';
    const extra = japanese ? (snap.segs ? Reading.spans(snap.segs) : Align.phrases(text, 'ja')) : [];
    const parts = Align.sideSegments(text, snap.links, side, extra);
    // Readings go under the phrases only if there is something to show under at least one of them.
    let readings = [];
    if (japanese && snap.segs && (showKana.checked || showRomaji.checked)) {
      readings = parts.map((s) => (s.phrase ? Reading.range(snap.segs, s.start, s.end) : null));
      if (!readings.some((r, i) => r && readingLines(parts[i].text, r).length)) readings = [];
    }
    const nodes = [];
    let opening = '';
    // Punctuation sticks to the phrase next to it (は、 and 「ありがとう」) instead of floating between phrases.
    const mainOf = (node) => (node && node.querySelector ? node.querySelector(':scope > .main') : null);
    parts.forEach((s, i) => {
      if (!s.phrase) {
        const previous = mainOf(nodes[nodes.length - 1]);
        if (readings.length && previous && CLOSING.test(s.text)) previous.textContent += s.text;
        else if (readings.length && OPENING.test(s.text)) opening += s.text;
        else { nodes.push(document.createTextNode(opening + s.text)); opening = ''; }
        return;
      }
      const node = chip(s.text, s.link, readings[i] || null);
      if (opening) {
        (mainOf(node) || node).textContent = opening + (mainOf(node) || node).textContent;
        opening = '';
      }
      nodes.push(node);
    });
    if (opening) nodes.push(document.createTextNode(opening));
    box.classList.toggle('annotated', readings.length > 0);
    box.replaceChildren(...nodes);
  }

  function fillList(snap) {
    const title = (t) => el('div', 'col-title', t);
    const cell = (child, lang) => { const d = el('div', 'cell'); d.lang = lang; d.append(child); return d; };
    const nodes = [title(LANGS[snap.from].name), el('div'), title(LANGS[snap.to].name)];
    snap.links.forEach((l, id) => {
      const linked = l.tgt.length > 0;
      const left = chip(part(snap.src, l.src), linked ? id : null, snap.from === 'ja' ? readRanges(snap, l.src) : null, true);
      const right = linked
        ? chip(part(snap.tgt, l.tgt), id, snap.to === 'ja' ? readRanges(snap, l.tgt) : null)
        : el('span', 'none', '—');
      nodes.push(cell(left, snap.from), el('div', 'arrow', '→'), cell(right, snap.to));
    });
    $('aligned-list').replaceChildren(...nodes);
  }

  function renderAligned(snap) {
    clearAligned();
    $('flow-src-name').textContent = LANGS[snap.from].name;
    $('flow-tgt-name').textContent = LANGS[snap.to].name;
    fillFlow($('flow-src'), snap, 'src');
    fillFlow($('flow-tgt'), snap, 'tgt');
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

  function togglePin(node) {
    const k = node ? Number(node.dataset.link) : null;
    pinned = k === null || k === pinned ? null : k;
    paint();
  }

  const segOf = (e) => (e.target instanceof Element ? e.target.closest('.seg[data-link]') : null);
  card.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const node = segOf(e);
    hovered = node ? Number(node.dataset.link) : null;
    paint();
  });
  card.addEventListener('pointerleave', () => { hovered = null; paint(); });
  // Focus highlights a pair only when it comes from the keyboard; a mouse click also focuses the phrase.
  card.addEventListener('focusin', (e) => {
    const node = segOf(e);
    if (node && node.matches(':focus-visible')) { focused = Number(node.dataset.link); paint(); }
  });
  card.addEventListener('focusout', () => { focused = null; paint(); });
  card.addEventListener('click', (e) => togglePin(segOf(e)));
  card.addEventListener('keydown', (e) => {
    const node = segOf(e);
    if (node && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); togglePin(node); }
  });
  $('view-flow').addEventListener('click', () => setView('flow'));
  $('view-list').addEventListener('click', () => setView('list'));

  wbw.addEventListener('change', () => {
    store.set('wbw', wbw.checked ? '1' : '0');
    if (!wbw.checked) card.hidden = true;
    else if (last && !btn.disabled) showAligned(last);
  });

  for (const [box, key] of [[showKana, 'kana'], [showRomaji, 'romaji']]) {
    box.addEventListener('change', () => {
      store.set(key, box.checked ? '1' : '0');
      drawBox('src');
      drawBox('tgt');
      if (last && last.links && !card.hidden) renderAligned(last);
    });
  }

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
  source.addEventListener('input', () => { updateCount(); updateSourceReading(); });
  $('swap').addEventListener('click', () => {
    cancelRun();
    [from, to] = [to, from];
    source.value = target.value;
    target.value = '';
    setBox('tgt', null);
    updateCount();
    renderLangs();
    setStatus('');
  });
  $('clear').addEventListener('click', () => {
    cancelRun();
    source.value = target.value = '';
    setBox('tgt', null);
    updateCount();
    updateSourceReading();
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

  // Credits for the services in use.
  function credit(prefix, who) {
    const out = [prefix];
    if (who.url) {
      const a = el('a', '', who.name);
      Object.assign(a, { href: who.url, target: '_blank', rel: 'noopener' });
      out.push(a);
    } else {
      out.push(who.name);
    }
    out.push('. ');
    return out;
  }
  $('credit').append(...credit('Translations by ', Engine.credit));
  const readingCredit = Reading.status().credit;
  if (readingCredit) $('credit').append(...credit('Readings by ', readingCredit));

  wbw.checked = store.get('wbw') !== '0';
  showKana.checked = store.get('kana') !== '0';
  showRomaji.checked = store.get('romaji') !== '0';
  setView(store.get('view') === 'list' ? 'list' : 'flow');
  renderLangs();
})();
