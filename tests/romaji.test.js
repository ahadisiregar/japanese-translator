// Run with: node --test tests/romaji.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Romaji = require('../romaji.js');

test('toKana: single particles and common words', () => {
  assert.equal(Romaji.toKana('konnichiwa'), 'こんにちわ');
  assert.equal(Romaji.toKana('watashi wa jibun no monogatari o kataritai.'), 'わたし は じぶん の ものがたり を かたりたい.');
  assert.equal(Romaji.toKana('Tokyo e ikimasu'), 'ときょ へ いきます');
  assert.equal(Romaji.toKana('toukyou'), 'とうきょう');
  assert.equal(Romaji.toKana('gakkou'), 'がっこう');
  assert.equal(Romaji.toKana("kon'ichi"), 'こんいち');
  assert.equal(Romaji.toKana('hello world'), 'hello world');
});

test('toKana: leaves text that already has kana or kanji alone', () => {
  assert.equal(Romaji.toKana('ASEANカップ'), 'ASEANカップ');
  assert.equal(Romaji.toKana('iPhone を かいました'), 'iPhone を かいました');
  assert.equal(Romaji.toKana('東京 desu'), '東京 desu');
});

test('toHiragana: katakana becomes hiragana, the long mark stays', () => {
  assert.equal(Romaji.toHiragana('ラーメンとゴースト'), 'らーめんとごーすと');
  assert.equal(Romaji.toHiragana('ヴァイオリン'), 'ゔぁいおりん');
  assert.equal(Romaji.toHiragana('ひらがなABC漢字'), 'ひらがなABC漢字');
});

test('fromKana: spelling', () => {
  const cases = [
    ['わたし', 'watashi'], ['きょう', 'kyou'], ['とうきょう', 'toukyou'], ['おおきい', 'ookii'], ['ありがとうございます', 'arigatougozaimasu'],
    ['しち', 'shichi'], ['つき', 'tsuki'], ['ふじ', 'fuji'], ['ぢ', 'ji'], ['じゅうしょ', 'juusho'], ['ちゃいろ', 'chairo'], ['にゃんこ', 'nyanko'],
    ['がっこう', 'gakkou'], ['ざっし', 'zasshi'], ['まっちゃ', 'matcha'], ['きって', 'kitte'], ['あっ', 'a'],
    ['しんぶん', 'shinbun'], ['こんいち', "kon'ichi"], ['こんや', "kon'ya"], ['ほん', 'hon'],
    ['ラーメン', 'raamen'], ['ファイル', 'fairu'], ['ティー', 'tii'], ['チェック', 'chekku'], ['ヴァイオリン', 'vaiorin'],
    ['を', 'o'], ['は', 'ha'], ['へ', 'he'], // particles are respelled by the caller
  ];
  for (const [kana, romaji] of cases) assert.equal(Romaji.fromKana(kana), romaji, kana);
});

test('fromKana: anything that is not kana passes through', () => {
  assert.equal(Romaji.fromKana('ゲローラ・ブン'), 'geroora・bun');
  assert.equal(Romaji.fromKana('ＡＳＥＡＮ８'), 'ASEAN8');
  assert.equal(Romaji.fromKana('東京 ok'), '東京 ok');
  assert.equal(Romaji.fromKana(''), '');
});

test('fromKana and toKana round-trip for plain words', () => {
  for (const w of ['わたし', 'がっこう', 'しんぶん', 'とうきょう', 'ありがとう', 'きょう', 'じゅうしょ', 'ちゃいろ', 'ふぁいる']) {
    assert.equal(Romaji.toKana(Romaji.fromKana(w)), w);
  }
});
