// Word-by-word alignment: split the source into phrases and work out which part of the
// translation says the same thing, so the page can highlight the two together.
//
// The result is a list of "links". A link is { src: [[start, end], ...], tgt: [[start, end], ...] }
// where the ranges are character offsets into the source text and into the translation.
// A link with an empty `tgt` is a source phrase that has no counterpart.
const Align = (() => {
  const R = typeof Romaji !== 'undefined' ? Romaji : require('./romaji.js');

  const MAX_PHRASES = 60;     // default cap: longer texts are only matched up to this many phrases
  const MIN_SCORE = 0.4;      // how well a probe must match the translation to be linked
  const FUNCTION_WEIGHT = 0.3; // particles / articles count for less than content words

  // ---- Splitting text into words ------------------------------------------------------

  const segmenters = {};

  // Returns [{ text, start, end, word }]; `word` is true for letters and numbers.
  function tokenize(text, lang) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const seg = segmenters[lang] || (segmenters[lang] = new Intl.Segmenter(lang, { granularity: 'word' }));
      return Array.from(seg.segment(text), (s) => ({
        text: s.segment, start: s.index, end: s.index + s.segment.length, word: !!s.isWordLike,
      }));
    }
    // Older browsers: split by script. Coarser, but still gives usable chunks.
    const out = [];
    const re = /[A-Za-z0-9]+(?:['’][A-Za-z]+)?|[぀-ゟ]+|[゠-ヿ]+|[㐀-鿿々]+|\s+|[\s\S]/gu;
    let m;
    while ((m = re.exec(text))) {
      out.push({ text: m[0], start: m.index, end: m.index + m[0].length, word: /[\p{L}\p{N}]/u.test(m[0]) });
    }
    return out;
  }

  const isSpace = (t) => /^[ \t]+$/.test(t.text);

  // ---- Grouping words into phrases ----------------------------------------------------

  // Particles and endings that stick to the word before them (as in 私は, 行きます, "watashi wa").
  const JA_PARTICLES = new Set([
    'は', 'が', 'を', 'に', 'へ', 'で', 'と', 'も', 'の', 'や', 'か', 'ね', 'よ', 'から', 'まで', 'より',
    'ので', 'のに', 'けど', 'けれど', 'でも', 'だけ', 'しか', 'ほど', 'など', 'って', 'ば', 'たり', 'ても', 'なら',
  ]);
  const JA_ENDINGS = new Set([
    'です', 'ます', 'でした', 'ました', 'ません', 'ない', 'なかった', 'たい', 'たかった', 'て', 'た', 'だ', 'だった',
    'う', 'よう', 'し', 'した', 'い', 'いる', 'いた', 'てい', 'ま', 'まし', 'ませ', 'でし', 'ず', 'れる', 'られる',
    'せる', 'させる', 'ください', 'ましょう', 'でしょう', 'だろう', 'らしい', 'そう', 'ながら', 'なく', 'たく',
  ]);

  // Japanese (kana, kanji or romaji): a content word plus the particles and endings after it.
  function groupJapanese(tokens) {
    const phrases = [];
    let cur = null;
    for (const t of tokens) {
      if (!t.word) {
        if (!isSpace(t)) cur = null; // punctuation and line breaks end a phrase, spaces do not
        continue;
      }
      const kana = R.toKana(t.text.toLowerCase());
      if (cur && (JA_PARTICLES.has(kana) || JA_ENDINGS.has(kana))) {
        cur.end = t.end;
      } else {
        cur = { start: t.start, end: t.end };
        phrases.push(cur);
      }
    }
    return phrases;
  }

  // Small words that lead into the next word ("to tell", "my own", "in Tokyo").
  const EN_LEADING = new Set((
    'a an the to of in on at for with by from as into about over after before than my your his her its our ' +
    'their this that these those and or but if so is are was were be been am do does did will would can could ' +
    'shall should may might must have has had not no'
  ).split(' '));

  // English: each content word together with the small words just before it.
  function groupEnglish(tokens) {
    const phrases = [];
    let lead = null;
    for (const t of tokens) {
      if (!t.word) {
        if (isSpace(t)) continue;
        if (lead) phrases.push(lead);
        lead = null;
        continue;
      }
      if (EN_LEADING.has(t.text.toLowerCase())) {
        lead = lead ? { start: lead.start, end: t.end } : { start: t.start, end: t.end };
      } else {
        phrases.push({ start: lead ? lead.start : t.start, end: t.end });
        lead = null;
      }
    }
    if (lead) phrases.push(lead);
    return phrases;
  }

  // Phrases of `text` as [{ start, end }] in reading order.
  function phrases(text, lang) {
    const tokens = tokenize(text, lang);
    return lang === 'ja' ? groupJapanese(tokens) : groupEnglish(tokens);
  }

  // ---- Matching phrases to the translation ("probing") ----------------------------------
  //
  // Each source phrase is translated on its own (the "probe"). We then look for the run of
  // words in the real translation that best matches that probe. This needs no alignment data
  // from the translation service, so it works with any of them, but it only links words the
  // service happens to translate the same way in both places.

  const stem = (w) => {
    w = w.toLowerCase().replace(/['’]s$/, '');
    for (const suffix of ['ing', 'ed', 'es', 's']) {
      if (w.length > suffix.length + 2 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
    }
    return w;
  };

  // Words of `text` as matching units: { key, w (weight), start, end, breakAfter }.
  function units(text, lang) {
    const out = [];
    for (const t of tokenize(text, lang)) {
      if (t.word) {
        const small = lang === 'ja'
          ? JA_PARTICLES.has(t.text) || JA_ENDINGS.has(t.text)
          : EN_LEADING.has(t.text.toLowerCase());
        out.push({
          key: lang === 'ja' ? t.text : stem(t.text),
          w: small ? FUNCTION_WEIGHT : 1,
          start: t.start, end: t.end, breakAfter: false,
        });
      } else if (!isSpace(t) && out.length) {
        out[out.length - 1].breakAfter = true; // a window never runs across punctuation
      }
    }
    return out;
  }

  // How well a probe Q matches a window W of target words (0 to 1). Words they share count by
  // weight, and at least one must be a content word, so "the" or "は" alone never makes a link.
  function score(Q, W, qWeight) {
    const pool = new Map();
    for (const u of W) pool.set(u.key, (pool.get(u.key) || 0) + 1);
    let shared = 0;
    let content = false;
    for (const q of Q) {
      const n = pool.get(q.key);
      if (!n) continue;
      pool.set(q.key, n - 1);
      shared += q.w;
      if (q.w === 1) content = true;
    }
    if (!content) return 0;
    let wWeight = 0;
    for (const u of W) wWeight += u.w;
    return (2 * shared) / (qWeight + wWeight);
  }

  // matches[i] is the { start, end } range in `target` for probe i, or null.
  function matchProbes(target, probes, lang) {
    const T = units(target, lang);
    const Q = probes.map((p) => units(p.text, lang));
    const qWeight = Q.map((q) => q.reduce((sum, u) => sum + u.w, 0));
    const claimed = new Array(T.length).fill(false);
    const best = new Array(probes.length).fill(null);
    const matches = new Array(probes.length).fill(null);

    // Best unclaimed window of target words for probe i. Windows that sit where the phrase
    // sits in the source win ties, which helps when the same word occurs more than once.
    const findBest = (i) => {
      let found = null;
      const maxLen = Math.min(Q[i].length + 3, 10);
      for (let a = 0; a < T.length; a++) {
        for (let b = a; b < T.length && b - a < maxLen; b++) {
          if (claimed[b] || (b > a && T[b - 1].breakAfter)) break;
          let s = score(Q[i], T.slice(a, b + 1), qWeight[i]);
          if (s <= 0) continue;
          s -= 0.05 * Math.abs(a / T.length - probes[i].position);
          if (!found || s > found.score + 1e-9) found = { a, b, score: s };
        }
      }
      return found && found.score >= MIN_SCORE ? found : null;
    };

    const todo = new Set();
    probes.forEach((p, i) => { if (Q[i].length) { todo.add(i); best[i] = findBest(i); } });
    for (;;) {
      let pick = -1;
      for (const i of todo) {
        if (best[i] && (pick < 0 || best[i].score > best[pick].score + 1e-9)) pick = i;
      }
      if (pick < 0) break;
      const { a, b } = best[pick];
      for (let k = a; k <= b; k++) claimed[k] = true;
      matches[pick] = { start: T[a].start, end: T[b].end };
      todo.delete(pick);
      for (const i of todo) if (best[i] && best[i].a <= b && best[i].b >= a) best[i] = findBest(i);
    }

    // Phrases whose probes read the same (a repeated word) keep their order: the first one in the
    // source gets the first match in the translation.
    const groups = new Map();
    probes.forEach((p, i) => {
      if (matches[i]) groups.set(p.text, [...(groups.get(p.text) || []), i]);
    });
    for (const members of groups.values()) {
      const ranges = members.map((i) => matches[i]).sort((x, y) => x.start - y.start);
      members.forEach((i, k) => { matches[i] = ranges[k]; });
    }
    return matches;
  }

  // Link the phrases of `src` to the translation `tgt`.
  // translateMany(texts, from, to) must resolve to one translation per text ('' if one failed).
  // `query` turns a phrase into what is sent to the translator (e.g. romaji to kana).
  // Only the first `max` phrases are matched; the returned array's `more` is how many were left out.
  async function probe({ src, tgt, from, to, translateMany, query, max = MAX_PHRASES }) {
    const all = phrases(src, from);
    const found = all.slice(0, max);
    if (!found.length) return Object.assign([], { more: 0 });
    const texts = found.map((p) => (query ? query(src.slice(p.start, p.end)) : src.slice(p.start, p.end)));
    const unique = [...new Set(texts)];
    const done = await translateMany(unique, from, to);
    const byText = new Map(unique.map((t, i) => [t, done[i] || '']));
    const probes = found.map((p, i) => ({ text: byText.get(texts[i]), position: p.start / Math.max(src.length, 1) }));
    const matches = matchProbes(tgt, probes, to);
    const links = found.map((p, i) => ({ src: [[p.start, p.end]], tgt: matches[i] ? [[matches[i].start, matches[i].end]] : [] }));
    return Object.assign(links, { more: all.length - found.length });
  }

  // ---- Turning phrase pairs from a language model into links -----------------------------

  const overlaps = (list, start, end) => list.some(([s, e]) => start < e && end > s);
  const isAlnum = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch);

  // First free place in `text` where `needle` occurs at or after `from`.
  function findFree(text, needle, from, used, ignoreCase) {
    const hay = ignoreCase ? text.toLowerCase() : text;
    const pin = ignoreCase ? needle.toLowerCase() : needle;
    if (hay.length !== text.length) return findFree(text, needle, from, used, false);
    for (let i = hay.indexOf(pin, from); i >= 0; i = hay.indexOf(pin, i + 1)) {
      const end = i + pin.length;
      if (isAlnum(pin[0]) && isAlnum(text[i - 1])) continue;       // not the middle of a word
      if (isAlnum(pin[pin.length - 1]) && isAlnum(text[end])) continue;
      if (!overlaps(used, i, end)) return i;
    }
    return -1;
  }

  // pairs: [{ src: 'exact piece of the source', tgt: ['exact piece of the translation', ...] }]
  // Pieces that cannot be found in the text are skipped, so a sloppy answer cannot break the page.
  function anchorPairs(src, tgt, pairs) {
    const usedSrc = [];
    const usedTgt = [];
    const links = [];
    let cursor = 0;
    for (const pair of Array.isArray(pairs) ? pairs : []) {
      const piece = pair && typeof pair.src === 'string' ? pair.src.trim() : '';
      if (!piece) continue;
      let at = findFree(src, piece, cursor, usedSrc, false);
      if (at < 0) at = findFree(src, piece, 0, usedSrc, true);
      if (at < 0) continue;
      const srcRange = [at, at + piece.length];
      usedSrc.push(srcRange);
      cursor = srcRange[1];

      const wanted = [].concat(pair.tgt === undefined ? [] : pair.tgt).filter((t) => typeof t === 'string' && t.trim());
      const tgtRanges = [];
      for (const t of wanted) {
        const text = t.trim();
        let i = findFree(tgt, text, 0, usedTgt, false);
        if (i < 0) i = findFree(tgt, text, 0, usedTgt, true);
        if (i < 0) continue;
        const range = [i, i + text.length];
        usedTgt.push(range);
        tgtRanges.push(range);
      }
      links.push({ src: [srcRange], tgt: tgtRanges.sort((a, b) => a[0] - b[0]) });
    }
    return links;
  }

  // ---- Building what the page shows ---------------------------------------------------------

  // Cut `text` into consecutive pieces: [{ text, link }], link being null for plain text.
  // The pieces always join back into exactly `text`.
  function buildSegments(text, ranges) {
    const out = [];
    let pos = 0;
    for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
      if (r.start < pos || r.end <= r.start || r.end > text.length) continue;
      if (r.start > pos) out.push({ text: text.slice(pos, r.start), link: null });
      out.push({ text: text.slice(r.start, r.end), link: r.link });
      pos = r.end;
    }
    if (pos < text.length) out.push({ text: text.slice(pos), link: null });
    return out;
  }

  // Pieces of one side ('src' or 'tgt') for display. Phrases without a counterpart stay plain.
  function sideSegments(text, links, side) {
    const ranges = [];
    links.forEach((link, id) => {
      if (!link.tgt.length) return;
      for (const [start, end] of link[side]) ranges.push({ start, end, link: id });
    });
    return buildSegments(text, ranges);
  }

  return { tokenize, phrases, probe, anchorPairs, buildSegments, sideSegments, matchProbes };
})();
if (typeof module !== 'undefined') module.exports = Align;
