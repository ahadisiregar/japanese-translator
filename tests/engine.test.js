// Run with: node --test tests/engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

// A stand-in for the browser's localStorage.
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

// storage: a fake (default), or null for a browser with no localStorage at all.
function load(config, storage = fakeStorage()) {
  delete require.cache[require.resolve('../engine.js')];
  global.APP_CONFIG = config;
  if (storage === null) delete global.localStorage;
  else global.localStorage = storage;
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

test('service: MyMemory without a key, Google with one, and the key is remembered', () => {
  const storage = fakeStorage();
  const Engine = load({ googleApiKey: '' }, storage);
  assert.deepEqual(Engine.service(), { id: 'mymemory', label: 'MyMemory (free)', keySource: null, keyEnd: '' });
  Engine.setKey('  abcd1234  ');
  assert.deepEqual(Engine.service(), { id: 'google', label: 'Google Translate', keySource: 'browser', keyEnd: '1234' });
  assert.equal(Engine.name, 'Google');
  assert.equal(Engine.credit.name, 'Google Cloud Translation');
  assert.equal(storage.data.googleApiKey, 'abcd1234');
  Engine.setKey('');
  assert.equal(Engine.service().id, 'mymemory');
  assert.equal(Engine.name, 'MyMemory');
  assert.deepEqual(storage.data, {});
});

test('service: a key saved earlier is used when the page loads', () => {
  const Engine = load({ googleApiKey: '' }, fakeStorage({ googleApiKey: 'saved-9876' }));
  assert.deepEqual(Engine.service(), { id: 'google', label: 'Google Translate', keySource: 'browser', keyEnd: '9876' });
});

test('service: the key in this browser wins over config.js, and removing it falls back to config.js', async () => {
  const urls = [];
  global.fetch = async (url) => { urls.push(url); return json({ data: { translations: [{ translatedText: 'x' }] } }); };
  const Engine = load({ googleApiKey: 'from-config' }, fakeStorage({ googleApiKey: 'from-browser' }));
  assert.equal(Engine.service().keySource, 'browser');
  await Engine.translate('犬', 'ja', 'en');
  Engine.setKey('');
  assert.equal(Engine.service().keySource, 'config');
  await Engine.translate('犬', 'ja', 'en');
  assert.deepEqual(urls.map((u) => u.split('key=')[1]), ['from-browser', 'from-config']);
});

test('service: the service follows the key at the moment of each call', async () => {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url.split('?')[0]);
    return url.includes('mymemory')
      ? json({ responseStatus: 200, responseData: { translatedText: 'from MyMemory' } })
      : json({ data: { translations: [{ translatedText: 'from Google' }] } });
  };
  const Engine = load({ googleApiKey: '' });
  assert.equal(await Engine.translate('犬', 'ja', 'en'), 'from MyMemory');
  Engine.setKey('k');
  assert.equal(await Engine.translate('犬', 'ja', 'en'), 'from Google');
  assert.deepEqual(await Engine.translateMany(['猫'], 'ja', 'en'), ['from Google']);
  Engine.setKey('');
  assert.equal(await Engine.translate('犬', 'ja', 'en'), 'from MyMemory');
  assert.deepEqual(urls, [
    'https://api.mymemory.translated.net/get', 'https://translation.googleapis.com/language/translate/v2',
    'https://translation.googleapis.com/language/translate/v2', 'https://api.mymemory.translated.net/get',
  ]);
});

test('service: storage that is missing or fails does not break the key', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  const Engine = load({ googleApiKey: '' }, broken);
  assert.equal(Engine.service().id, 'mymemory');
  Engine.setKey('abc');                      // cannot be remembered, but works for now
  assert.equal(Engine.service().id, 'google');
  Engine.setKey('');
  assert.equal(Engine.service().id, 'mymemory');
  const Bare = load({ googleApiKey: '' }, null); // no storage at all
  assert.equal(typeof localStorage, 'undefined');
  assert.equal(Bare.service().id, 'mymemory');
  Bare.setKey('abc');
  assert.equal(Bare.service().id, 'google');
  Bare.setKey('');
  assert.equal(Bare.service().id, 'mymemory');
});

test('testKey: a working key gives a sample translation, using the key that was passed in', async () => {
  const calls = [];
  global.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return json({ data: { translations: [{ translatedText: 'Hello' }] } }); };
  const Engine = load({ googleApiKey: '' });
  assert.equal(await Engine.testKey('  my key  '), 'Hello');
  assert.equal(calls[0].url, 'https://translation.googleapis.com/language/translate/v2?key=my%20key');
  assert.deepEqual(calls[0].body, { q: ['こんにちは'], source: 'ja', target: 'en', format: 'text' });
  assert.equal(Engine.service().id, 'mymemory', 'testing does not switch anything on');
  await assert.rejects(Engine.testKey('   '), /Paste a key first/);
});

test('testKey: Google\'s errors come with what to do about them', async () => {
  const Engine = load({ googleApiKey: '' });
  const fail = (status, error) => { global.fetch = async () => json({ error }, status); return Engine.testKey('k').then(() => assert.fail('should fail'), (e) => e.message); };

  let m = await fail(400, { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] });
  assert.match(m, /did not accept that key.*Check that all of it was copied/);
  assert.match(m, /Google said: API key not valid/);

  m = await fail(403, { message: 'Requests from referer https://someone.github.io/ are blocked.', details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] });
  assert.match(m, /limited to other website addresses.*add https:\/\/someone\.github\.io\/\* to the key's website restrictions/);
  m = await fail(403, { message: 'Requests from referer <empty> are blocked.' });
  assert.match(m, /add this site's address to the key's website restrictions/);

  m = await fail(403, { message: 'Cloud Translation API has not been used in project 123 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] });
  assert.match(m, /Cloud Translation API is switched off.*APIs & Services/);

  m = await fail(403, { message: 'This API method requires billing to be enabled.', details: [{ reason: 'BILLING_DISABLED' }] });
  assert.match(m, /Billing is not turned on/);

  m = await fail(429, { message: 'Rate Limit Exceeded' });
  assert.match(m, /limit for this key was reached/);

  m = await fail(500, { message: 'Backend Error' });
  assert.equal(m, 'Google: Backend Error');

  global.fetch = async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
  await assert.rejects(Engine.testKey('k'), /Google service error \(502\)/);

  global.fetch = async () => json({ data: { translations: [{ translatedText: '' }] } });
  await assert.rejects(Engine.testKey('k'), /did not return a translation/);
});
