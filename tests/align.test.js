// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const Romaji = require('../romaji.js');
const Align = require('../align.js');

const cut = (text, ranges) => ranges.map(([s, e]) => text.slice(s, e));
const phraseTexts = (text, lang) => Align.phrases(text, lang).map((p) => text.slice(p.start, p.end));

test('romaji: single particles and common words', () => {
  assert.equal(Romaji.toKana('konnichiwa'), 'こんにちわ');
  assert.equal(Romaji.toKana('watashi wa jibun no monogatari o kataritai.'), 'わたし は じぶん の ものがたり を かたりたい.');
  assert.equal(Romaji.toKana('Tokyo e ikimasu'), 'ときょ へ いきます');
  assert.equal(Romaji.toKana('toukyou'), 'とうきょう');
  assert.equal(Romaji.toKana('gakkou'), 'がっこう');
  assert.equal(Romaji.toKana('kon\'ichi'), 'こんいち');
  assert.equal(Romaji.toKana('hello world'), 'hello world');
});

test('phrases: romaji sentence groups particles with the word before', () => {
  assert.deepEqual(phraseTexts('Watashi wa jibun no monogatari o kataritai.', 'ja'),
    ['Watashi wa', 'jibun no', 'monogatari o', 'kataritai']);
});

test('phrases: Japanese script', () => {
  assert.deepEqual(phraseTexts('私は自分の物語を語りたい。', 'ja'), ['私は', '自分の', '物語を', '語りたい']);
  assert.deepEqual(phraseTexts('今日は天気がいいので、公園に散歩に行きます。', 'ja'),
    ['今日は', '天気が', 'いいので', '公園に', '散歩に', '行きます']);
  assert.deepEqual(phraseTexts('毎日学校で日本語を勉強しています。', 'ja'), ['毎日', '学校で', '日本語を', '勉強しています']);
  assert.deepEqual(phraseTexts('東京へ行きました', 'ja'), ['東京へ', '行きました']);
});

test('phrases: English', () => {
  assert.deepEqual(phraseTexts('I want to tell my own story.', 'en'), ['I', 'want', 'to tell', 'my own', 'story']);
  assert.deepEqual(phraseTexts('Where is the station?', 'en'), ['Where', 'is the station']);
});

test('buildSegments always joins back into the original text', () => {
  const text = 'I want to tell my own story.';
  const segs = Align.buildSegments(text, [{ start: 0, end: 1, link: 0 }, { start: 15, end: 21, link: 2 }, { start: 3, end: 6, link: 1 }]);
  assert.equal(segs.map((s) => s.text).join(''), text);
  assert.deepEqual(segs.filter((s) => s.link !== null).map((s) => [s.text, s.link]), [['I', 0], ['ant', 1], ['my own', 2]]);
  // overlapping or out-of-range ranges are ignored
  const odd = Align.buildSegments(text, [{ start: 0, end: 5, link: 0 }, { start: 2, end: 6, link: 1 }, { start: 90, end: 99, link: 2 }]);
  assert.equal(odd.map((s) => s.text).join(''), text);
});

// A stand-in for a translation service: it only knows a few phrases.
const lexicon = (table) => async (texts) => texts.map((t) => table[t] || '');

test('probe: the example sentence (romaji to English, with reordering)', async () => {
  const src = 'Watashi wa jibun no monogatari o kataritai.';
  const tgt = 'I want to tell my own story.';
  const links = await Align.probe({
    src, tgt, from: 'ja', to: 'en', query: Romaji.toKana,
    translateMany: lexicon({ 'わたし は': 'I', 'じぶん の': 'my own', 'ものがたり を': 'the story', 'かたりたい': 'I want to talk' }),
  });
  assert.deepEqual(links.map((l) => [cut(src, l.src)[0], cut(tgt, l.tgt)[0] || null]), [
    ['Watashi wa', 'I'],
    ['jibun no', 'my own'],
    ['monogatari o', 'story'],
    ['kataritai', 'want to'],
  ]);
});

test('probe: English to Japanese', async () => {
  const src = 'I want to tell my own story.';
  const tgt = '私は自分の物語を語りたい。';
  const links = await Align.probe({
    src, tgt, from: 'en', to: 'ja',
    translateMany: lexicon({ I: '私', want: '欲しい', 'to tell': '伝える', 'my own': '自分の', story: '物語' }),
  });
  const linked = links.filter((l) => l.tgt.length).map((l) => [cut(src, l.src)[0], cut(tgt, l.tgt)[0]]);
  assert.deepEqual(linked, [['I', '私'], ['my own', '自分の'], ['story', '物語']]);
  assert.equal(links.length, 5); // every phrase is still listed, linked or not
});

test('probe: a word is never linked twice and unknown phrases stay unlinked', async () => {
  const src = 'neko to inu';
  const tgt = 'A cat and a dog';
  const links = await Align.probe({
    src, tgt, from: 'ja', to: 'en', query: Romaji.toKana,
    translateMany: lexicon({ 'ねこ と': 'cat and', いぬ: 'dog' }),
  });
  assert.deepEqual(links.map((l) => cut(tgt, l.tgt)[0] || null), ['cat and', 'dog']);
});

test('probe: failed translations (empty strings) leave phrases unlinked', async () => {
  const links = await Align.probe({
    src: 'neko to inu', tgt: 'cat and dog', from: 'ja', to: 'en', query: Romaji.toKana,
    translateMany: async (texts) => texts.map(() => ''),
  });
  assert.ok(links.every((l) => l.tgt.length === 0));
});

test('probe: repeated words match near where the phrase sits', async () => {
  const src = 'hon o yomimasu. hon o kaimasu.';
  const tgt = 'I read a book. I buy a book.';
  const links = await Align.probe({
    src, tgt, from: 'ja', to: 'en', query: Romaji.toKana,
    translateMany: lexicon({ 'ほん を': 'book', よみます: 'read', かいます: 'buy' }),
  });
  const pairs = links.filter((l) => l.tgt.length).map((l) => [cut(src, l.src)[0], l.tgt[0][0]]);
  const books = pairs.filter(([s]) => s === 'hon o').map(([, at]) => at);
  assert.equal(books.length, 2);
  assert.ok(books[0] < tgt.indexOf('buy') && books[1] > tgt.indexOf('buy'), 'first "hon o" links the first "book"');
});

test('probe: does not link across punctuation', async () => {
  const links = await Align.probe({
    src: 'kyou wa', tgt: 'Today, is', from: 'ja', to: 'en', query: Romaji.toKana,
    translateMany: lexicon({ 'きょう は': 'today is' }),
  });
  // "Today" and "is" are separated by a comma, so the window cannot cover both
  assert.deepEqual(cut('Today, is', links[0].tgt), ['Today']);
});

test('anchorPairs: maps phrase pairs onto the real texts', () => {
  const src = 'Watashi wa jibun no monogatari o kataritai.';
  const tgt = 'I want to tell my own story.';
  const links = Align.anchorPairs(src, tgt, [
    { src: 'Watashi wa', tgt: ['I'] },
    { src: 'jibun no', tgt: ['my own'] },
    { src: 'monogatari o', tgt: ['story'] },
    { src: 'kataritai', tgt: ['want to tell'] },
  ]);
  assert.deepEqual(links.map((l) => [cut(src, l.src)[0], cut(tgt, l.tgt)[0]]), [
    ['Watashi wa', 'I'], ['jibun no', 'my own'], ['monogatari o', 'story'], ['kataritai', 'want to tell'],
  ]);
});

test('anchorPairs: tolerates sloppy answers', () => {
  const src = 'neko wa inu desu';
  const tgt = 'The cat is a dog';
  const links = Align.anchorPairs(src, tgt, [
    { src: 'neko wa', tgt: 'cat' },              // tgt as a plain string
    { src: 'inu', tgt: ['A DOG'] },              // different case still matches
    { src: 'not in the text', tgt: ['cat'] },    // unknown source piece is dropped
    { src: 'desu', tgt: ['cat'] },               // "cat" is already used: the phrase stays unlinked
    { src: '', tgt: ['The'] },
    null,
  ]);
  assert.equal(links.length, 3);
  assert.deepEqual(links.map((l) => l.tgt.length), [1, 1, 0]);
  assert.deepEqual(links.map((l) => cut(tgt, l.tgt)[0] || null), ['cat', 'a dog', null]);
  assert.equal(Align.anchorPairs(src, tgt, 'nonsense').length, 0);
});

test('anchorPairs: a short word is not found inside a longer one', () => {
  const tgt = 'Is it fine? I think so';
  const links = Align.anchorPairs('watashi', tgt, [{ src: 'watashi', tgt: ['I'] }]);
  assert.equal(links[0].tgt[0][0], tgt.indexOf('I think')); // not the "I" at the start of "Is"
});

test('sideSegments: only linked phrases are highlighted, and text is preserved', () => {
  const src = 'neko to inu';
  const tgt = 'cat and dog';
  const links = [{ src: [[0, 7]], tgt: [[0, 7]] }, { src: [[8, 11]], tgt: [] }];
  const s = Align.sideSegments(src, links, 'src');
  assert.equal(s.map((x) => x.text).join(''), src);
  assert.deepEqual(s.filter((x) => x.link !== null).map((x) => x.text), ['neko to']);
  assert.equal(Align.sideSegments(tgt, links, 'tgt').map((x) => x.text).join(''), tgt);
});

test('probe: only the first `max` phrases are matched, and the rest are reported', async () => {
  const seen = [];
  const links = await Align.probe({
    src: 'neko to inu to tori to sakana', tgt: 'cat dog bird fish', from: 'ja', to: 'en', query: Romaji.toKana, max: 2,
    translateMany: async (texts) => { seen.push(...texts); return texts.map(() => ''); },
  });
  assert.equal(links.length, 2);
  assert.equal(links.more, 2);
  assert.deepEqual(seen, ['ねこ と', 'いぬ と']);
});
