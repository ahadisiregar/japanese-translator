// Run with: node --test tests/engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

function load(config) {
  delete require.cache[require.resolve('../engine.js')];
  global.APP_CONFIG = config;
  return require('../engine.js');
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('MyMemory: picks the service and builds the request', async () => {
  const Engine = load({ googleApiKey: '' });
  const urls = [];
  global.fetch = async (url) => { urls.push(url); return json({ responseStatus: 200, responseData: { translatedText: 'Hello' } }); };
  assert.equal(Engine.name, 'MyMemory');
  assert.equal(await Engine.translate('こんにちは', 'ja', 'en'), 'Hello');
  assert.equal(urls[0], 'https://api.mymemory.translated.net/get?langpair=ja|en&q=' + encodeURIComponent('こんにちは'));
});

test('chunk: splits at sentence ends and never exceeds the byte limit', () => {
  const Engine = load({ googleApiKey: '' });
  const enc = new TextEncoder();
  assert.deepEqual(Engine.chunk('はい。いいえ。\nたぶん', 25), ['はい。いいえ。\n', 'たぶん']);
  const long = 'あ'.repeat(500) + '。';
  const parts = Engine.chunk(long, 100);
  assert.equal(parts.join(''), long);
  assert.ok(parts.every((p) => enc.encode(p).length <= 100));
});

test('MyMemory: long text goes out in pieces that are put back together properly', async () => {
  const Engine = load({ googleApiKey: '' });
  // Each sentence is ~300 bytes, so two of them cannot share a request.
  const first = 'あ'.repeat(100) + '。';
  const second = 'い'.repeat(100) + '。';
  const requests = [];
  global.fetch = async (url) => {
    const q = decodeURIComponent(url.split('&q=')[1]);
    requests.push(q);
    return json({ responseStatus: 200, responseData: { translatedText: q[0] === 'あ' ? 'First.' : 'Second.' } });
  };
  assert.equal(await Engine.translate(first + '\n' + second, 'ja', 'en'), 'First.\nSecond.');
  assert.equal(await Engine.translate(first + second, 'ja', 'en'), 'First. Second.');
  assert.equal(requests.length, 4);
  // into Japanese there are no spaces between sentences
  const eFirst = 'a'.repeat(300) + '.';
  const eSecond = 'b'.repeat(300) + '.';
  global.fetch = async (url) => {
    const q = decodeURIComponent(url.split('&q=')[1]);
    return json({ responseStatus: 200, responseData: { translatedText: q[0] === 'a' ? '一。' : '二。' } });
  };
  assert.equal(await Engine.translate(eFirst + eSecond, 'en', 'ja'), '一。二。');
});

test('MyMemory: HTML entities in the answer are decoded', async () => {
  const Engine = load({ googleApiKey: '' });
  global.fetch = async () => json({ responseStatus: 200, responseData: { translatedText: 'I&#39;m &quot;fine&quot; &amp; well &#x41;' } });
  assert.equal(await Engine.translate('x', 'ja', 'en'), 'I\'m "fine" & well A');
});

test('MyMemory: a service error becomes a readable message', async () => {
  const Engine = load({ googleApiKey: '' });
  global.fetch = async () => json({ responseStatus: 429, responseDetails: 'QUOTA REACHED' });
  await assert.rejects(Engine.translate('x', 'ja', 'en'), /QUOTA REACHED/);
  global.fetch = async () => json({}, 503);
  await assert.rejects(Engine.translate('x', 'ja', 'en'), /503/);
});

test('MyMemory translateMany: one failure leaves a blank, total failure throws', async () => {
  const Engine = load({ googleApiKey: '' });
  global.fetch = async (url) => {
    const q = decodeURIComponent(url.split('&q=')[1]);
    if (q === 'bad') return json({ responseStatus: 500, responseDetails: 'boom' });
    return json({ responseStatus: 200, responseData: { translatedText: q.toUpperCase() } });
  };
  assert.deepEqual(await Engine.translateMany(['a', 'bad', '  ', 'c'], 'ja', 'en'), ['A', '', '', 'C']);
  await assert.rejects(Engine.translateMany(['bad', 'bad'], 'ja', 'en'), /boom/);
  assert.deepEqual(await Engine.translateMany([], 'ja', 'en'), []);
});

test('Google: used when a key is set, one batched POST for many phrases', async () => {
  const Engine = load({ googleApiKey: 'abc 123' });
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return json({ data: { translations: calls[calls.length - 1].body.q.map((q) => ({ translatedText: '<' + q + '>' })) } });
  };
  assert.equal(Engine.name, 'Google');
  assert.equal(await Engine.translate('犬', 'ja', 'en'), '<犬>');
  assert.equal(calls[0].url, 'https://translation.googleapis.com/language/translate/v2?key=abc%20123');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].body, { q: ['犬'], source: 'ja', target: 'en', format: 'text' });

  calls.length = 0;
  assert.deepEqual(await Engine.translateMany(['猫', ' ', '鳥'], 'ja', 'en'), ['<猫>', '', '<鳥>']);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.q, ['猫', '鳥']);

  calls.length = 0;
  const many = Array.from({ length: 230 }, (_, i) => 'w' + i);
  const out = await Engine.translateMany(many, 'en', 'ja');
  assert.equal(calls.length, 3); // 100 + 100 + 30
  assert.equal(out[229], '<w229>');
});

test('Google: API errors show Google\'s own message', async () => {
  const Engine = load({ googleApiKey: 'bad' });
  global.fetch = async () => json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400);
  await assert.rejects(Engine.translate('x', 'ja', 'en'), /API key not valid/);
  global.fetch = async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
  await assert.rejects(Engine.translate('x', 'ja', 'en'), /502/);
});
