// Translation services. The app only talks to `Engine`:
//   Engine.translate(text, from, to, onPartial?)  -> Promise<string>
//   Engine.translateMany(texts, from, to)         -> Promise<string[]>   ('' for a text that failed)
//   Engine.credit                                 -> { name, url? }
//   Engine.maxProbes                              -> how many phrases word-by-word may translate separately
// Google Cloud Translation is used when APP_CONFIG.googleApiKey is set, otherwise MyMemory.
const Engine = (() => {
  const googleKey = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.googleApiKey) || '';

  // ---- helpers --------------------------------------------------------------------------

  const encoder = new TextEncoder();
  const byteLength = (s) => encoder.encode(s).length;

  // Split text into pieces of at most `maxBytes` UTF-8 bytes (MyMemory allows 500 per request),
  // breaking at sentence ends where possible.
  function chunk(text, maxBytes = 450) {
    const parts = text.match(/[^。！？.!?\n]+[。！？.!?\n]*|[。！？.!?\n]+/g) || [];
    const out = [];
    let cur = '';
    for (let p of parts) {
      if (cur && byteLength(cur + p) > maxBytes) { out.push(cur); cur = ''; }
      while (byteLength(p) > maxBytes) {
        let n = p.length;
        while (byteLength(p.slice(0, n)) > maxBytes) n--;
        out.push(p.slice(0, n));
        p = p.slice(n);
      }
      cur += p;
    }
    if (cur) out.push(cur);
    return out;
  }

  // MyMemory sometimes returns HTML entities such as &#39; in its text.
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()];
  });

  // Run fn over items with at most `limit` in flight. A failing item gives '' instead of
  // stopping the others; if every item fails the first error is thrown.
  async function mapSoft(items, limit, fn) {
    const out = new Array(items.length).fill('');
    let next = 0;
    let failed = 0;
    let firstError = null;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        try { out[i] = await fn(items[i]); } catch (e) { failed++; firstError = firstError || e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    if (items.length && failed === items.length) throw firstError;
    return out;
  }

  // ---- MyMemory (free, no key) ------------------------------------------------------------

  async function myMemory(q, from, to) {
    const res = await fetch('https://api.mymemory.translated.net/get?langpair=' + from + '|' + to + '&q=' + encodeURIComponent(q));
    if (!res.ok) throw new Error('Service error (' + res.status + ')');
    const data = await res.json();
    if (data.responseStatus != 200) throw new Error(data.responseDetails || 'Translation failed');
    return decode(data.responseData.translatedText);
  }

  async function myMemoryTranslate(text, from, to, onPartial) {
    let out = '';
    for (const c of chunk(text)) {
      const translated = c.trim() ? await myMemory(c.trim(), from, to) : '';
      const tail = c.match(/\s*$/)[0];
      // Put back the line breaks, and a space between English sentences.
      out += translated + (tail.includes('\n') ? tail : to === 'en' ? ' ' : '');
      if (onPartial) onPartial(out.trim());
    }
    return out.trim();
  }

  const myMemoryMany = (texts, from, to) => mapSoft(texts, 4, (t) => (t.trim() ? myMemory(t, from, to) : ''));

  // ---- Google Cloud Translation (needs an API key) -------------------------------------------

  async function google(texts, from, to) {
    const res = await fetch('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(googleKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, source: from, target: to, format: 'text' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || 'Service error (' + res.status + ')');
    return data.data.translations.map((t) => t.translatedText);
  }

  // Many texts in few requests (the API takes up to 128 per request); blank texts are skipped.
  async function googleMany(texts, from, to) {
    const out = new Array(texts.length).fill('');
    const idx = texts.map((t, i) => i).filter((i) => texts[i].trim());
    for (let k = 0; k < idx.length; k += 100) {
      const batch = idx.slice(k, k + 100);
      const done = await google(batch.map((i) => texts[i]), from, to);
      batch.forEach((i, n) => { out[i] = done[n]; });
    }
    return out;
  }

  if (googleKey) {
    return {
      name: 'Google',
      credit: { name: 'Google Cloud Translation', url: 'https://cloud.google.com/translate' },
      translate: async (text, from, to) => (await google([text], from, to))[0],
      translateMany: googleMany,
      maxProbes: 60,   // one batched request, so this is cheap
      chunk,
    };
  }
  return {
    name: 'MyMemory',
    credit: { name: 'MyMemory', url: 'https://mymemory.translated.net' },
    translate: myMemoryTranslate,
    translateMany: myMemoryMany,
    maxProbes: 30,     // one request each, so keep it modest
    chunk,
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
