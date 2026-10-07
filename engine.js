// Translation services. The app only talks to `Engine`:
//   Engine.translate(text, from, to, onPartial?)  -> Promise<string>
//   Engine.translateMany(texts, from, to)         -> Promise<string[]>   ('' for a text that failed)
//   Engine.credit                                 -> { name, url? }
//   Engine.maxProbes                              -> how many phrases word-by-word may translate separately
//   Engine.service()                              -> what is in use now, for the settings box
//   Engine.setKey(key)                            -> use Google with this key (kept in this browser); '' to stop
//   Engine.testKey(key)                           -> check a key; resolves with a sample translation
// Google Cloud Translation is used when there is an API key (one saved in this browser, otherwise
// APP_CONFIG.googleApiKey), and MyMemory when there is none.
const Engine = (() => {
  const STORAGE_NAME = 'googleApiKey';
  const configKey = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.googleApiKey) || '';

  // The browser's storage can be missing or blocked, so every use is guarded.
  const readStored = () => { try { return (localStorage.getItem(STORAGE_NAME) || '').trim(); } catch { return ''; } };
  const writeStored = (value) => {
    try {
      if (value) localStorage.setItem(STORAGE_NAME, value);
      else localStorage.removeItem(STORAGE_NAME);
    } catch { /* the key then only lasts until the page is closed */ }
  };

  let browserKey = readStored();
  const currentKey = () => browserKey || configKey;

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

  // Google's own error messages are written for programmers. Say what to do about the usual ones.
  function explainGoogle(status, error) {
    const message = String((error && error.message) || '');
    const reasons = ((error && error.details) || []).map((d) => d && d.reason).filter(Boolean).join(' ');
    const text = message + ' ' + reasons;
    // Google names the address it blocked ("Requests from referer https://you.github.io/ are blocked").
    const named = (message.match(/referer\s+(https?:\/\/[^\s/]+)/i) || [])[1];
    const here = typeof location !== 'undefined' && /^https?:/.test(location.origin) ? location.origin : '';
    const site = named || here ? (named || here) + '/*' : "this site's address";
    let advice = '';
    if (/API key not valid|API_KEY_INVALID/i.test(text)) advice = 'Google did not accept that key. Check that all of it was copied.';
    else if (/referer|referrer/i.test(text)) advice = 'The key is limited to other website addresses. In Google Cloud, add ' + site + ' to the key\'s website restrictions.';
    else if (/billing|BILLING_DISABLED/i.test(text)) advice = 'Billing is not turned on for the key\'s Google Cloud project. Turn it on in Google Cloud.';
    else if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(text)) advice = 'Cloud Translation API is switched off for the key\'s project. Turn it on in Google Cloud (APIs & Services → Library).';
    else if (/quota|rate limit|limit exceeded|RATE_LIMIT/i.test(text)) advice = 'The limit for this key was reached. Try again later, or raise the limit in Google Cloud.';
    if (!message) return advice || 'Google service error (' + status + ')';
    return advice ? advice + ' (Google said: ' + message + ')' : 'Google: ' + message;
  }

  async function google(texts, from, to, key = currentKey()) {
    const res = await fetch('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, source: from, target: to, format: 'text' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(explainGoogle(res.status, data.error));
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

  const backends = {
    google: {
      name: 'Google',
      credit: { name: 'Google Cloud Translation', url: 'https://cloud.google.com/translate' },
      translate: async (text, from, to) => (await google([text], from, to))[0],
      translateMany: googleMany,
      maxProbes: 60, // one batched request, so this is cheap
    },
    mymemory: {
      name: 'MyMemory',
      credit: { name: 'MyMemory', url: 'https://mymemory.translated.net' },
      translate: myMemoryTranslate,
      translateMany: myMemoryMany,
      maxProbes: 30, // one request each, so keep it modest
    },
  };
  const active = () => (currentKey() ? backends.google : backends.mymemory);

  // ---- Choosing the service ---------------------------------------------------------------------

  // What is in use: { id, label, keySource ('browser' | 'config' | null), keyEnd }
  function service() {
    const key = currentKey();
    return {
      id: key ? 'google' : 'mymemory',
      label: key ? 'Google Translate' : 'MyMemory (free)',
      keySource: !key ? null : browserKey ? 'browser' : 'config',
      keyEnd: key.slice(-4),
    };
  }

  // Use Google with this key, and remember it in this browser. An empty key goes back to the key in
  // config.js, or to MyMemory when there is none.
  function setKey(value) {
    browserKey = String(value || '').trim();
    writeStored(browserKey);
  }

  // Ask Google for a tiny translation to see whether the key works. Resolves with the translation.
  async function testKey(value) {
    const key = String(value || '').trim();
    if (!key) throw new Error('Paste a key first.');
    const [hello] = await google(['こんにちは'], 'ja', 'en', key);
    if (!hello) throw new Error('Google did not return a translation.');
    return hello;
  }

  return {
    chunk,
    get name() { return active().name; },
    get credit() { return active().credit; },
    get maxProbes() { return active().maxProbes; },
    translate: (text, from, to, onPartial) => active().translate(text, from, to, onPartial),
    translateMany: (texts, from, to) => active().translateMany(texts, from, to),
    service,
    setKey,
    testKey,
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
