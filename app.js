const $ = (id) => document.getElementById(id);
const source = $('source'), target = $('target'), status = $('status'), btn = $('translate'), hint = $('hint');

const LANGS = {
  ja: { name: 'Japanese', speech: 'ja-JP', placeholder: 'こんにちは、元気ですか？  or  konnichiwa, genki desu ka?' },
  en: { name: 'English', speech: 'en-US', placeholder: 'Type English here' },
};
let from = 'ja', to = 'en';

// Split text into pieces of at most `maxBytes` UTF-8 bytes (MyMemory allows 500 per request),
// preferring sentence boundaries.
const enc = new TextEncoder();
const bytes = (s) => enc.encode(s).length;
function chunk(text, maxBytes = 450) {
  const parts = text.match(/[^。！？.!?\n]+[。！？.!?\n]*|[。！？.!?\n]+/g) || [];
  const out = [];
  let cur = '';
  for (let p of parts) {
    if (cur && bytes(cur + p) > maxBytes) { out.push(cur); cur = ''; }
    while (bytes(p) > maxBytes) {
      let n = p.length;
      while (bytes(p.slice(0, n)) > maxBytes) n--;
      out.push(p.slice(0, n));
      p = p.slice(n);
    }
    cur += p;
  }
  if (cur) out.push(cur);
  return out;
}

// BACKEND-START
async function translateChunk(q, f, t) {
  if (!q.trim()) return q;
  const res = await fetch('https://api.mymemory.translated.net/get?langpair=' + f + '|' + t + '&q=' + encodeURIComponent(q));
  if (!res.ok) throw new Error('Service error (' + res.status + ')');
  const data = await res.json();
  if (data.responseStatus != 200) throw new Error(data.responseDetails || 'Translation failed');
  return data.responseData.translatedText;
}
async function translateText(text, f, t) {
  const results = [];
  for (const c of chunk(text)) results.push(await translateChunk(c, f, t));
  return results.join('');
}
// BACKEND-END

// Japanese input may be romaji; convert Latin runs that read as valid Japanese.
function prepare(text) {
  return from === 'ja' ? Romaji.toKana(text) : text;
}

function updateHint() {
  const text = source.value;
  const kana = from === 'ja' ? Romaji.toKana(text) : text;
  if (from === 'ja' && kana !== text && text.trim()) {
    hint.hidden = false;
    hint.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = kana;
    hint.append('Reading romaji as: ', b);
  } else {
    hint.hidden = true;
  }
}

function setStatus(msg, isError = false) {
  status.textContent = msg;
  status.className = isError ? 'error' : '';
}

function renderLangs() {
  $('from-name').textContent = $('source-label').textContent = LANGS[from].name;
  $('to-name').textContent = $('target-label').textContent = LANGS[to].name;
  source.lang = from; target.lang = to;
  source.placeholder = LANGS[from].placeholder;
  target.placeholder = 'Translation appears here';
  updateHint();
}

async function translate() {
  const text = prepare(source.value).trim();
  if (!text) { target.value = ''; setStatus(''); return; }
  btn.disabled = true;
  setStatus('Translating…');
  try {
    target.value = await translateText(text, from, to);
    setStatus('');
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function speak(text, lang) {
  if (!text || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  speechSynthesis.speak(u);
}

function updateCount() { $('count').textContent = source.value.length + ' / 5000'; }

btn.addEventListener('click', translate);
source.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) translate(); });
source.addEventListener('input', () => { updateCount(); updateHint(); });
$('swap').addEventListener('click', () => {
  [from, to] = [to, from];
  const out = target.value;
  source.value = out; target.value = '';
  updateCount(); renderLangs(); setStatus('');
});
$('clear').addEventListener('click', () => { source.value = target.value = ''; updateCount(); updateHint(); setStatus(''); source.focus(); });
$('copy').addEventListener('click', async () => {
  if (!target.value) return;
  try { await navigator.clipboard.writeText(target.value); setStatus('Copied!'); }
  catch { target.select(); document.execCommand('copy'); setStatus('Copied!'); }
});
$('speak-src').addEventListener('click', () => speak(source.value, LANGS[from].speech));
$('speak-tgt').addEventListener('click', () => speak(target.value, LANGS[to].speech));

renderLangs();
