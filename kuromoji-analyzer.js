// Reads kanji with kuromoji (https://github.com/takuyaa/kuromoji.js, Apache-2.0) and its IPADIC
// dictionary. Both are loaded from a CDN the first time kanji need reading. The dictionary is about
// 17 MB, which the browser keeps afterwards. The text itself never leaves the browser.
// Gives Reading an analyzer: analyze(text) -> Promise<[{ text, kana, pron, attach, particle }]>.
const KuromojiAnalyzer = (() => {
  const Rom = typeof Romaji !== 'undefined' ? Romaji : require('./romaji.js');
  const SOURCES = ['https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/', 'https://unpkg.com/kuromoji@0.1.2/'];

  // The pronunciation differs from the reading in は (wa) and へ (e) used as particles or in greetings.
  // Other differences (long vowels written with ー) are ignored, so とうきょう stays toukyou.
  function pronunciation(reading, spoken) {
    if (!spoken || spoken.length !== reading.length) return Rom.toHiragana(reading);
    let out = '';
    for (let i = 0; i < reading.length; i++) {
      const r = reading[i], p = spoken[i];
      out += (r === 'ハ' && p === 'ワ') || (r === 'ヘ' && p === 'エ') ? p : r;
    }
    return Rom.toHiragana(out);
  }

  // Does this token stick to the word before it (the ます of 食べます, the 人 of 8万人)?
  const JOINING_PARTICLES = new Set(['て', 'で', 'ば', 'ながら']);
  const SEPARATE_AUXILIARIES = new Set(['だ', 'です', 'ござる']); // written as words of their own
  function attaches(t, prev) {
    const detail = t.pos_detail_1;
    switch (t.pos) {
      case '助動詞': return !SEPARATE_AUXILIARIES.has(t.basic_form); // "gakusei desu", "gozaimasu", but "tabemasu"
      case '助詞': return detail === '接続助詞' && JOINING_PARTICLES.has(t.surface_form);
      case '動詞': return detail === '非自立' || detail === '接尾';
      case '形容詞': return detail === '接尾';
      case '名詞': return detail === '接尾' || (detail === '数' && !!prev && prev.pos === '名詞' && prev.pos_detail_1 === '数');
      default: return false;
    }
  }

  // kuromoji tokens -> [{ text, kana, pron, attach, particle }]
  function toSegments(tokens) {
    return tokens.map((t, i) => {
      const known = t.reading && t.reading !== '*';
      const kana = Rom.toHiragana(known ? t.reading : t.surface_form);
      return {
        text: t.surface_form,
        kana,
        pron: known ? pronunciation(t.reading, t.pronunciation) : kana,
        attach: attaches(t, tokens[i - 1]),
        particle: t.pos === '助詞' || (t.surface_form === 'の' && t.pos_detail_1 === '非自立'),
      };
    });
  }

  let tokenizer = null;
  let loading = null;

  // The library is third-party code, so the browser checks it against this hash and refuses anything else.
  const SCRIPT_HASH = 'sha384-LCHxvFGxgpk9Bl+0+OaV6Rf24HQamJPrNHIo6VGkXkVgGWRvl68eqUwCW5PWqfwh';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.integrity = SCRIPT_HASH;
      el.crossOrigin = 'anonymous';
      el.onload = resolve;
      el.onerror = () => { el.remove(); reject(new Error('Could not load ' + src)); };
      document.head.append(el);
    });
  }

  const build = (base) => new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: base + 'dict/' }).build((err, t) => (err ? reject(err) : resolve(t)));
  });

  function load() {
    if (tokenizer) return Promise.resolve(tokenizer);
    if (!loading) {
      analyzer.loading = true;
      loading = (async () => {
        for (const base of SOURCES) {
          try {
            if (typeof kuromoji === 'undefined') await loadScript(base + 'build/kuromoji.js');
            tokenizer = await build(base);
            return tokenizer;
          } catch (e) { console.warn('Reading dictionary: ' + e.message); }
        }
        throw new Error('Could not load the reading dictionary. Check your connection and try again.');
      })().finally(() => { analyzer.loading = false; loading = null; });
    }
    return loading;
  }

  const analyzer = {
    live: true, // quick enough to run as people type, once it is loaded
    loading: false,
    loadingNote: 'Loading the reading dictionary (about 17 MB, first time only)…',
    credit: { name: 'kuromoji', url: 'https://github.com/takuyaa/kuromoji.js' },
    analyze: async (text) => toSegments((await load()).tokenize(text)),
  };

  if (typeof Reading !== 'undefined') Reading.setAnalyzer(analyzer);
  return { analyzer, toSegments, pronunciation, attaches };
})();
if (typeof module !== 'undefined') module.exports = KuromojiAnalyzer;
