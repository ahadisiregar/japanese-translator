// How Japanese text is read: hiragana and romaji, for text that was typed or translated.
//
// A reading is a list of segments that together cover the text:
//   { text, start, kana, pron?, attach?, particle? }
// `kana` is the hiragana reading of that stretch (or the text itself when it has no reading).
// The optional fields help with spelling: `pron` is the hiragana as pronounced (は as a particle is
// "wa"), `attach` says the segment sticks to the word before it (the ます of 食べます) and
// `particle` says it is a particle (は, を, ...).
//
// Text without kanji is read right here. Kanji need a dictionary, which an "analyzer" provides
// (see kuromoji-analyzer.js): an object with analyze(text) -> Promise<[{ text, kana, ... }]>.
const Reading = (() => {
  const Rom = typeof Romaji !== 'undefined' ? Romaji : require('./romaji.js');
  const Al = typeof Align !== 'undefined' ? Align : require('./align.js');

  const KANJI = /[\p{Script=Han}々〆〇]/u;
  const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const LONG_KANA_RUN = /[\p{Script=Hiragana}\p{Script=Katakana}ー]{9,}/u; // probably several words with no spaces
  const hasKanji = (text) => KANJI.test(text);
  // Kanji have no reading of their own, and long runs of kana cannot be cut into words without a dictionary.
  const needsAnalyzer = (text) => hasKanji(text) || LONG_KANA_RUN.test(text);
  const isBlank = (s) => /^\s+$/.test(s.text);
  const isWord = (s) => /[\p{L}\p{N}]/u.test(s.text);

  // ---- Segments ----------------------------------------------------------------------------------

  // Read text without kanji or long kana runs. Latin letters are romaji only when the text has no kana
  // of its own. A run of hiragana (or of katakana) is kept as one word: without a dictionary, cutting
  // it up would often cut it in the wrong place.
  const HIRAGANA_WORD = /^\p{Script=Hiragana}+$/u;
  const KATAKANA_WORD = /^[\p{Script=Katakana}ー]+$/u;
  function local(text) {
    const romaji = !KANA.test(text);
    const tokens = [];
    for (const t of Al.tokenize(text, 'ja')) {
      const prev = tokens[tokens.length - 1];
      const kind = !t.word ? null : HIRAGANA_WORD.test(t.text) ? 'hiragana' : KATAKANA_WORD.test(t.text) ? 'katakana' : null;
      if (prev && kind && prev.kind === kind && prev.end === t.start) {
        prev.text += t.text;
        prev.end = t.end;
      } else {
        tokens.push({ ...t, kind });
      }
    }
    return tokens.map((t) => {
      let kana = t.text;
      if (t.word) {
        const converted = romaji && /[A-Za-z]/.test(t.text) ? Rom.toKana(t.text.toLowerCase()) : t.text;
        kana = Rom.toHiragana(/[A-Za-z]/.test(converted) ? t.text : converted);
      }
      return { text: t.text, kana, start: t.start };
    });
  }

  // Make an analyzer's answer into segments that cover `text` exactly. Pieces that are not in the
  // text are dropped and stretches nobody mentioned are kept as they are, so a sloppy answer
  // cannot lose or invent text.
  function normalize(text, items) {
    const out = [];
    let pos = 0;
    const plain = (end) => { if (end > pos) out.push({ text: text.slice(pos, end), start: pos, kana: Rom.toHiragana(text.slice(pos, end)) }); };
    for (const item of Array.isArray(items) ? items : []) {
      const piece = item && typeof item.text === 'string' ? item.text : '';
      if (!piece) continue;
      const at = text.startsWith(piece, pos) ? pos : text.indexOf(piece, pos);
      if (at < 0) continue;
      plain(at);
      const seg = { text: piece, start: at, kana: Rom.toHiragana(typeof item.kana === 'string' && item.kana.trim() ? item.kana.trim() : piece) };
      if (typeof item.pron === 'string' && item.pron) seg.pron = Rom.toHiragana(item.pron);
      if (typeof item.attach === 'boolean') seg.attach = item.attach;
      if (typeof item.particle === 'boolean') seg.particle = item.particle;
      out.push(seg);
      pos = at + piece.length;
    }
    plain(text.length);
    return out;
  }

  // ---- Spelling the reading out -------------------------------------------------------------------

  // Without an analyzer's hints, particles and endings are recognised by their spelling. です and its
  // forms are written as words of their own (gakusei desu), unlike ます (tabemasu).
  const SEPARATE = new Set(['です', 'でした', 'でし', 'でしょう', 'だ', 'だった', 'だろう']);
  const particleOf = (s) => (typeof s.particle === 'boolean' ? s.particle : Al.particles.has(s.kana));
  const attachOf = (s) => (typeof s.attach === 'boolean' ? s.attach : Al.endings.has(s.kana) && !SEPARATE.has(s.kana));

  const GREETINGS = new Set(['こんにちは', 'こんばんは']);
  function pronunciation(s) {
    if (s.pron) return s.pron;
    if (s.kana === 'は') return 'わ'; // as a word on its own, は is the particle
    if (s.kana === 'へ') return 'え';
    if (GREETINGS.has(s.kana)) return s.kana.slice(0, -1) + 'わ';
    return s.kana;
  }

  // Romaji for the segments of one phrase: particles are spaced off (watashi wa), endings stick (tabemasu).
  function romajiOf(segs) {
    const words = [];
    let prev = null;
    for (const s of segs) {
      if (prev && attachOf(s) && !particleOf(prev)) words[words.length - 1] += pronunciation(s);
      else words.push(pronunciation(s));
      prev = s;
    }
    return words.map(Rom.fromKana).join(' ').replace(/・/g, ' ');
  }

  // Cut word segments into phrases: a word together with the particles and endings after it.
  // An ending does not stick to a particle (食べて ください), but another particle does (では).
  function phrasesOf(words) {
    const out = [];
    let prev = null;
    for (const s of words) {
      if (out.length && (particleOf(s) || (attachOf(s) && !particleOf(prev)))) out[out.length - 1].push(s);
      else out.push([s]);
      prev = s;
    }
    return out;
  }

  const ROMAJI_PUNCTUATION = {
    '。': '.', '、': ',', '，': ',', '．': '.', '！': '!', '？': '?', '：': ':', '；': ';', '「': '"', '」': '"', '『': '"', '』': '"',
    '（': '(', '）': ')', '［': '[', '］': ']', '【': '[', '】': ']', '〜': '~', '～': '~', '…': '...', '　': ' ',
  };
  const OPENING = new Set(['「', '『', '（', '［', '【', '(', '[']);

  // Join the parts of a line: a space between words, punctuation sticking to the word before it.
  function assemble(parts, key) {
    let out = '';
    let space = false; // a space is due before the next word
    for (const p of parts) {
      if (p.t === 'br') { out += '\n'; space = false; continue; }
      if (p.t === 'w') { out += (space ? ' ' : '') + p[key]; space = true; continue; }
      if (p.mid) { if (key === 'kana') { out += p.kana; space = false; } else space = true; continue; }
      if (p.open) { out += (space ? ' ' : '') + p[key]; space = false; continue; }
      out += p[key];
      space = true;
    }
    return out;
  }

  const capitalize = (s) => s.replace(/(^|[.!?]\s+|\n)(\p{Ll})/gu, (m, before, letter) => before + letter.toUpperCase());

  // The hiragana and romaji lines for some segments: { kana, romaji }.
  function lines(segs, { capital = true } = {}) {
    const parts = [];
    let run = [];
    const flush = () => {
      for (const phrase of phrasesOf(run)) {
        parts.push({ t: 'w', kana: phrase.map((s) => s.kana.replace(/\s+/g, '')).join(''), romaji: romajiOf(phrase) });
      }
      run = [];
    };
    for (const s of segs) {
      if (isBlank(s)) {
        if (s.text.includes('\n')) { flush(); parts.push({ t: 'br' }); }
        continue;
      }
      if (isWord(s)) { run.push(s); continue; }
      flush();
      parts.push({
        t: 'p', kana: s.text, mid: s.text === '・', open: OPENING.has(s.text[0]),
        romaji: [...s.text].map((c) => ROMAJI_PUNCTUATION[c] ?? c.normalize('NFKC')).join(''),
      });
    }
    flush();
    const romaji = assemble(parts, 'romaji');
    return { kana: assemble(parts, 'kana'), romaji: capital ? capitalize(romaji) : romaji };
  }

  // The phrases of read text as ranges ({ start, end }): a word with the particles and endings after it.
  function spans(segs) {
    const out = [];
    let run = [];
    const flush = () => {
      for (const phrase of phrasesOf(run)) {
        const last = phrase[phrase.length - 1];
        out.push({ start: phrase[0].start, end: last.start + last.text.length });
      }
      run = [];
    };
    for (const s of segs) {
      if (isBlank(s)) { if (s.text.includes('\n')) flush(); continue; }
      if (isWord(s)) run.push(s); else flush();
    }
    flush();
    return out;
  }

  // The reading of one stretch of the text (a highlighted phrase): the segments that start inside it.
  const range = (segs, start, end) => lines(segs.filter((s) => s.start >= start && s.start < end), { capital: false });

  // ---- Getting readings ------------------------------------------------------------------------------

  let analyzer = null;
  const pending = new Map();  // text -> Promise<segments>, while being worked out
  const finished = new Map(); // text -> segments, kept for the next time
  const KEEP = 40;

  const setAnalyzer = (a) => { analyzer = a; };
  // What can be done here: { available, live (cheap enough to run while typing), loading, loadingNote, credit }
  const status = () => ({
    available: !!analyzer,
    live: !!(analyzer && analyzer.live),
    loading: !!(analyzer && analyzer.loading),
    loadingNote: (analyzer && analyzer.loadingNote) || 'Finding readings…',
    credit: analyzer && analyzer.credit,
  });

  // Segments for `text`, or null when it needs an analyzer and there is none. Rejects if the analyzer fails.
  function analyze(text) {
    if (!text.trim()) return Promise.resolve([]);
    if (!needsAnalyzer(text)) return Promise.resolve(local(text));
    if (finished.has(text)) return Promise.resolve(finished.get(text));
    if (pending.has(text)) return pending.get(text);
    if (!analyzer) return Promise.resolve(null);
    const p = Promise.resolve(analyzer.analyze(text))
      .then((items) => {
        const segs = normalize(text, items);
        finished.set(text, segs);
        if (finished.size > KEEP) finished.delete(finished.keys().next().value);
        return segs;
      })
      .finally(() => pending.delete(text));
    pending.set(text, p);
    return p;
  }

  // The same, right now, if it is already known (no analyzer needed): segments or null.
  function known(text) {
    if (!text.trim()) return [];
    return needsAnalyzer(text) ? finished.get(text) || null : local(text);
  }

  return { hasKanji, needsAnalyzer, local, normalize, lines, range, spans, analyze, known, setAnalyzer, status };
})();
if (typeof module !== 'undefined') module.exports = Reading;
