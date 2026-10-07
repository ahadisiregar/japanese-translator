// Run with: node --test tests/reading.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Reading = require('../reading.js');
const Kuromoji = require('../kuromoji-analyzer.js');
const fixtures = require('./fixtures/kuromoji-tokens.json'); // real kuromoji output for a few sentences

const read = (i) => {
  const { text, tokens } = fixtures[i];
  const segs = Reading.normalize(text, Kuromoji.toSegments(tokens));
  return { text, segs, ...Reading.lines(segs) };
};

test('kuromoji tokens: segments cover the text and keep spelling hints', () => {
  for (let i = 0; i < fixtures.length; i++) {
    const { text, segs } = read(i);
    assert.equal(segs.map((s) => s.text).join(''), text);
    assert.deepEqual(segs.map((s) => s.start), segs.map((_, k) => segs.slice(0, k).reduce((n, s) => n + s.text.length, 0)));
  }
  const { segs } = read(0);
  const wa = segs.find((s) => s.text === 'は');
  assert.equal(wa.kana, 'は');
  assert.equal(wa.pron, 'わ'); // the particle is said "wa"
  assert.equal(wa.particle, true);
  assert.equal(segs.find((s) => s.text === 'たい').attach, true);
});

test('lines: the example sentence', () => {
  const r = read(0);
  assert.equal(r.kana, 'わたしは じぶんの ものがたりを かたりたい。');
  assert.equal(r.romaji, 'Watashi wa jibun no monogatari o kataritai.');
});

test('lines: greetings, particles, katakana, quotes and line breaks', () => {
  const r = read(3);
  assert.equal(r.kana, 'こんにちは、 とうきょうへ いきます。 らーめんを たべました！\n「ありがとう」 と いった。');
  assert.equal(r.romaji, 'Konnichiwa, toukyou e ikimasu. Raamen o tabemashita!\n"arigatou" to itta.');
});

test('lines: です after a noun is its own word', () => {
  const r = read(4);
  assert.equal(r.romaji, 'Watashi no te wa ookii no desu. Haha wa haha desu.');
});

test('lines: names, numbers, Latin letters and dashes', () => {
  const r = read(1);
  assert.ok(r.kana.startsWith('げろーら・ぶん・かるの・すたじあむの ないぶの くうきは、'));
  assert.ok(r.romaji.startsWith('Geroora bun karuno sutajiamu no naibu no kuuki wa, totemo noukou de,'));
  assert.ok(r.romaji.endsWith('kanjirareta.'));
  const r2 = read(2);
  assert.ok(r2.kana.startsWith('8まんにんの たましいが'));
  assert.ok(r2.romaji.includes('8mannin no tamashii ga kata o yoseai, ASEAN kappu wa indoneshia no'));
  assert.ok(r2.romaji.includes('sutoorii datta— 6do no kuyashii'));
});

test('range: the reading of one highlighted phrase', () => {
  const { segs } = read(0); // 私は自分の物語を語りたい。
  assert.deepEqual(Reading.range(segs, 0, 2), { kana: 'わたしは', romaji: 'watashi wa' });
  assert.deepEqual(Reading.range(segs, 2, 5), { kana: 'じぶんの', romaji: 'jibun no' });
  assert.deepEqual(Reading.range(segs, 8, 12), { kana: 'かたりたい', romaji: 'kataritai' });
  assert.deepEqual(Reading.range(segs, 0, 0), { kana: '', romaji: '' });
});

test('local: typed romaji is read as kana and respelled', () => {
  const text = 'Watashi wa jibun no monogatari o kataritai.';
  const segs = Reading.local(text);
  assert.equal(segs.map((s) => s.text).join(''), text);
  assert.deepEqual(Reading.lines(segs), { kana: 'わたしは じぶんの ものがたりを かたりたい.', romaji: 'Watashi wa jibun no monogatari o kataritai.' });
  assert.deepEqual(Reading.range(segs, 0, 10), { kana: 'わたしは', romaji: 'watashi wa' });
});

test('local: kana text, katakana and mixed Latin letters', () => {
  assert.deepEqual(Reading.lines(Reading.local('こんにちは')), { kana: 'こんにちは', romaji: 'Konnichiwa' });
  assert.deepEqual(Reading.lines(Reading.local('ありがとう ございます')), { kana: 'ありがとう ございます', romaji: 'Arigatou gozaimasu' });
  assert.equal(Reading.lines(Reading.local('ラーメン')).kana, 'らーめん');
  // with kana present, Latin letters are English words or names, not romaji
  assert.deepEqual(Reading.lines(Reading.local('iPhoneを かいました')), { kana: 'iPhone を かいました'.replace('iPhone を', 'iPhoneを'), romaji: 'IPhone o kaimashita' });
});

test('lines: punctuation sticks to the word before it, brackets hug what they hold', () => {
  const segs = Reading.local('「ねこ」と、いぬ！');
  assert.deepEqual(Reading.lines(segs), { kana: '「ねこ」 と、 いぬ！', romaji: '"neko" to, inu!' });
});

test('normalize: a sloppy answer cannot lose or invent text', () => {
  const text = '私は学生です。';
  const segs = Reading.normalize(text, [
    { text: '私', kana: 'ワタシ' },
    { text: 'ありえない', kana: 'x' },        // not in the text: dropped
    { text: 'は' },                            // no reading: the text itself
    { text: 'です', kana: 'です' },            // skipped over 学生: the gap is kept as it is
    null,
    { text: '。', kana: '。' },
  ]);
  assert.equal(segs.map((s) => s.text).join(''), text);
  assert.deepEqual(segs.map((s) => s.kana), ['わたし', 'は', '学生', 'です', '。']);
  assert.deepEqual(Reading.normalize('', []), []);
  assert.equal(Reading.normalize('猫', 'nonsense')[0].text, '猫');
});

test('analyze: only text with kanji needs an analyzer, and answers are remembered', async () => {
  Reading.setAnalyzer(null);
  assert.equal(await Reading.analyze('私は学生です。'), null);
  assert.deepEqual(await Reading.analyze('   '), []);
  assert.equal((await Reading.analyze('ねこ'))[0].kana, 'ねこ'); // no kanji: no analyzer needed
  assert.equal(Reading.known('私は学生です。'), null);

  let calls = 0;
  Reading.setAnalyzer({ live: true, credit: { name: 'x' }, analyze: async (t) => { calls++; return [{ text: '私', kana: 'わたし' }, { text: t.slice(1), kana: 'は' }]; } });
  assert.deepEqual(Reading.status(), { available: true, live: true, loading: false, loadingNote: 'Finding readings…', credit: { name: 'x' } });
  const [a, b] = await Promise.all([Reading.analyze('私は学生です。'), Reading.analyze('私は学生です。')]);
  assert.equal(calls, 1, 'two requests at once share one analysis');
  assert.equal(a, b);
  await Reading.analyze('私は学生です。');
  assert.equal(calls, 1, 'and it is remembered afterwards');
  assert.equal(Reading.known('私は学生です。'), a);
});

test('analyze: a failure rejects and is not remembered', async () => {
  let fail = true;
  Reading.setAnalyzer({ live: false, analyze: async () => { if (fail) throw new Error('offline'); return [{ text: '猫', kana: 'ねこ' }]; } });
  await assert.rejects(Reading.analyze('猫を見る'), /offline/);
  assert.equal(Reading.known('猫を見る'), null);
  fail = false;
  assert.equal((await Reading.analyze('猫を見る'))[0].kana, 'ねこ');
  assert.equal(Reading.status().live, false);
});

test('needsAnalyzer: kanji and long runs of kana', () => {
  assert.equal(Reading.needsAnalyzer('猫'), true);
  assert.equal(Reading.needsAnalyzer('ありがとうございます'), true); // ten kana in a row
  assert.equal(Reading.needsAnalyzer('コンピューターサイエンス'), true);
  assert.equal(Reading.needsAnalyzer('ありがとう'), false);
  assert.equal(Reading.needsAnalyzer('ありがとう ございます'), false); // separated by a space
  assert.equal(Reading.needsAnalyzer('watashi wa gakusei desu'), false);
  assert.equal(Reading.needsAnalyzer(''), false);
});

test('spans: the phrases of read text as ranges', () => {
  assert.deepEqual(Reading.spans(read(0).segs), [{ start: 0, end: 2 }, { start: 2, end: 5 }, { start: 5, end: 8 }, { start: 8, end: 12 }]);
  const typed = 'Watashi wa jibun no monogatari o kataritai.';
  const spans = Reading.spans(Reading.local(typed));
  assert.deepEqual(spans.map((s) => typed.slice(s.start, s.end)), ['Watashi wa', 'jibun no', 'monogatari o', 'kataritai']);
  const two = read(3); // line breaks and punctuation end a phrase
  assert.deepEqual(Reading.spans(two.segs).map((s) => two.text.slice(s.start, s.end)),
    ['こんにちは', '東京へ', '行きます', 'ラーメンを', '食べました', 'ありがとう', 'と', '言った']);
});

test('lines: polite phrases and endings', () => {
  const thanks = read(5);
  assert.deepEqual({ kana: thanks.kana, romaji: thanks.romaji }, { kana: 'どうも ありがとう ございます。', romaji: 'Doumo arigatou gozaimasu.' });
  const more = read(6);
  assert.deepEqual({ kana: more.kana, romaji: more.romaji }, {
    kana: 'がくせいでは ありません。 たべて ください。 よんで いない。',
    romaji: 'Gakusei de wa arimasen. Tabete kudasai. Yonde inai.',
  });
});

test('local: です is a word of its own, ます sticks to its verb', () => {
  const desu = Reading.local('Watashi wa gakusei desu.');
  assert.deepEqual(Reading.lines(desu), { kana: 'わたしは がくせい です.', romaji: 'Watashi wa gakusei desu.' });
  const masu = Reading.local('Tabe masu. Ikimasu.');
  assert.deepEqual(Reading.lines(masu), { kana: 'たべます. いきます.', romaji: 'Tabemasu. Ikimasu.' });
});
