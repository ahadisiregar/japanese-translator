// Romaji (Latin letters) -> hiragana. Used so people can type Japanese without a Japanese keyboard.
const Romaji = (() => {
  const map = {};
  const rows = {
    '': 'あいうえお', k: 'かきくけこ', s: 'さしすせそ', t: 'たちつてと', n: 'なにぬねの',
    h: 'はひふへほ', m: 'まみむめも', r: 'らりるれろ', g: 'がぎぐげご', z: 'ざじずぜぞ',
    d: 'だぢづでど', b: 'ばびぶべぼ', p: 'ぱぴぷぺぽ',
  };
  const V = 'aiueo';
  for (const [c, kana] of Object.entries(rows)) [...kana].forEach((k, i) => { map[c + V[i]] = k; });
  Object.assign(map, { ya: 'や', yu: 'ゆ', yo: 'よ', wa: 'わ', wo: 'を', wi: 'うぃ', we: 'うぇ' });
  // Digraphs: kya, gyu, nyo, ...
  const small = { a: 'ゃ', u: 'ゅ', o: 'ょ' };
  for (const c of 'kgsztdnhbpmr') {
    for (const v of 'auo') map[c + 'y' + v] = rows[c][1] + small[v];
  }
  // Hepburn spellings and common alternates
  Object.assign(map, {
    shi: 'し', sha: 'しゃ', shu: 'しゅ', sho: 'しょ', she: 'しぇ',
    chi: 'ち', cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', che: 'ちぇ',
    ji: 'じ', ja: 'じゃ', ju: 'じゅ', jo: 'じょ', je: 'じぇ',
    tsu: 'つ', fu: 'ふ', fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
    si: 'し', ti: 'ち', tu: 'つ', hu: 'ふ', zi: 'じ',
    sya: 'しゃ', syu: 'しゅ', syo: 'しょ', tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ',
    zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ', jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
    di: 'ぢ', du: 'づ', dzu: 'づ', ti2: 'てぃ', thi: 'てぃ', dhi: 'でぃ',
  });
  delete map.ti2;
  const isVowel = (ch) => ch !== undefined && 'aiueo'.includes(ch);

  function convertWord(word) {
    const s = word.toLowerCase();
    let out = '';
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '-') { out += 'ー'; i++; continue; }
      let hit = null;
      for (const len of [3, 2, 1]) {
        const k = s.slice(i, i + len);
        if (k.length === len && map[k]) { hit = k; break; }
      }
      if (hit) { out += map[hit]; i += hit.length; continue; }
      if (ch === 'n') {
        // "n" not followed by a vowel or y is ん; "n'" is also ん.
        if (s[i + 1] === "'" || s[i + 1] === '’') { out += 'ん'; i += 2; continue; }
        if (!isVowel(s[i + 1]) && s[i + 1] !== 'y') { out += 'ん'; i++; continue; }
      }
      // Doubled consonant (kitte, zasshi) or "tch" (matcha) becomes small っ.
      if (ch === s[i + 1] && !isVowel(ch) && ch !== 'n') { out += 'っ'; i++; continue; }
      if (ch === 't' && s.slice(i + 1, i + 3) === 'ch') { out += 'っ'; i++; continue; }
      out += ch; i++;
    }
    return out;
  }

  // Written on their own, "wa", "o" and "e" are almost always the particles は, を and へ.
  const LONE_PARTICLES = { wa: 'は', o: 'を', e: 'へ' };

  // Convert every Latin run that turns into pure kana; leave anything else (e.g. English words) alone.
  function toKana(text) {
    return text.replace(/[A-Za-z'’-]+/g, (run) => {
      if (!/[A-Za-z]/.test(run)) return run;
      const lone = LONE_PARTICLES[run.toLowerCase()];
      if (lone) return lone;
      const kana = convertWord(run);
      return /[A-Za-z]/.test(kana) ? run : kana;
    });
  }

  return { toKana };
})();
if (typeof module !== 'undefined') module.exports = Romaji;
