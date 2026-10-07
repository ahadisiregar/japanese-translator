const $ = (id) => document.getElementById(id);
const source = $('source'), target = $('target'), status = $('status'), btn = $('translate');

// MyMemory limits each request to 500 bytes of text, so split on sentence ends.
function chunk(text, max = 150) {
  const parts = text.match(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/g) || [];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + p).length > max) { out.push(cur); cur = ''; }
    cur += p;
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur) out.push(cur);
  return out;
}

async function translateChunk(q) {
  if (!q.trim()) return q;
  const res = await fetch('https://api.mymemory.translated.net/get?langpair=ja|en&q=' + encodeURIComponent(q));
  if (!res.ok) throw new Error('Service error (' + res.status + ')');
  const data = await res.json();
  if (data.responseStatus != 200) throw new Error(data.responseDetails || 'Translation failed');
  return data.responseData.translatedText;
}

function setStatus(msg, isError = false) {
  status.textContent = msg;
  status.className = isError ? 'error' : '';
}

async function translate() {
  const text = source.value.trim();
  if (!text) { target.value = ''; setStatus(''); return; }
  btn.disabled = true;
  setStatus('Translating…');
  try {
    const results = [];
    for (const c of chunk(text)) results.push(await translateChunk(c));
    target.value = results.join('');
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

btn.addEventListener('click', translate);
source.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) translate(); });
source.addEventListener('input', () => { $('count').textContent = source.value.length + ' / 5000'; });
$('clear').addEventListener('click', () => { source.value = target.value = ''; $('count').textContent = '0 / 5000'; setStatus(''); source.focus(); });
$('copy').addEventListener('click', async () => {
  if (!target.value) return;
  try { await navigator.clipboard.writeText(target.value); setStatus('Copied!'); }
  catch { target.select(); document.execCommand('copy'); setStatus('Copied!'); }
});
$('speak-src').addEventListener('click', () => speak(source.value, 'ja-JP'));
$('speak-tgt').addEventListener('click', () => speak(target.value, 'en-US'));
