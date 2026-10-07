// Romaji (Latin letters) <-> kana. Typing romaji lets people write Japanese without a Japanese keyboard;
// converting kana back to romaji lets the page show how Japanese text is read.
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
    di: 'ぢ', du: 'づ', dzu: 'づ', thi: 'てぃ', dhi: 'でぃ',
  });
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
  // Text that already has kana or kanji is left as it is: its Latin letters are names or English words.
  function toKana(text) {
    if (/[\u3040-\u30FF\u3400-\u9FFF]/.test(text)) return text;
    return text.replace(/[A-Za-z'’-]+/g, (run) => {
      if (!/[A-Za-z]/.test(run)) return run;
      const lone = LONE_PARTICLES[run.toLowerCase()];
      if (lone) return lone;
      const kana = convertWord(run);
      return /[A-Za-z]/.test(kana) ? run : kana;
    });
  }

  // ---- Kana -> romaji ----------------------------------------------------------------------------
  // Hepburn spelling, but long vowels are written out (とうきょう = toukyou), the same way
  // toKana reads them, so the result can be typed back in.

  const KANA = {};
  const gojuon = {
    '': 'あいうえお', k: 'かきくけこ', s: ['sa', 'shi', 'su', 'se', 'so', 'さしすせそ'], t: ['ta', 'chi', 'tsu', 'te', 'to', 'たちつてと'],
    n: 'なにぬねの', h: ['ha', 'hi', 'fu', 'he', 'ho', 'はひふへほ'], m: 'まみむめも', r: 'らりるれろ',
    g: 'がぎぐげご', z: ['za', 'ji', 'zu', 'ze', 'zo', 'ざじずぜぞ'], d: ['da', 'ji', 'zu', 'de', 'do', 'だぢづでど'],
    b: 'ばびぶべぼ', p: 'ぱぴぷぺぽ',
  };
  for (const [c, row] of Object.entries(gojuon)) {
    const kana = Array.isArray(row) ? row[5] : row;
    [...kana].forEach((k, i) => { KANA[k] = Array.isArray(row) ? row[i] : c + 'aiueo'[i]; });
  }
  Object.assign(KANA, {
    や: 'ya', ゆ: 'yu', よ: 'yo', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n', ゔ: 'vu',
    ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
  });
  const COMBO = {};
  const smallY = { ゃ: 'a', ゅ: 'u', ょ: 'o' };
  const comboRows = { き: 'ky', ぎ: 'gy', に: 'ny', ひ: 'hy', び: 'by', ぴ: 'py', み: 'my', り: 'ry', し: 'sh', じ: 'j', ぢ: 'j', ち: 'ch' };
  for (const [k, c] of Object.entries(comboRows)) for (const [y, v] of Object.entries(smallY)) COMBO[k + y] = c + v;
  Object.assign(COMBO, {
    ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', うぃ: 'wi', うぇ: 'we', うぉ: 'wo', しぇ: 'she', じぇ: 'je', ちぇ: 'che',
    てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du', てゅ: 'tyu', でゅ: 'dyu', ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
    つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso', いぇ: 'ye',
  });

  // Katakana to hiragana. The prolonged sound mark ー is left as it is.
  const toHiragana = (text) => text.replace(/[ァ-ヴ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  // The sound the kana at s[i] makes, and how many characters it takes: [romaji, length] or null.
  function sound(s, i) {
    const two = COMBO[s.slice(i, i + 2)];
    if (two) return [two, 2];
    const one = KANA[s[i]];
    return one && s[i] !== 'ん' ? [one, 1] : null;
  }

  // Kana (hiragana or katakana) to romaji. Anything that is not kana is passed through.
  // は, へ and を are spelled ha, he and o here; say so beforehand (as "わ", "え") for particles.
  function fromKana(text) {
    const s = toHiragana(text);
    let out = '';
    let geminate = false; // a small っ waiting to double the next consonant
    const put = (r) => {
      if (geminate && !'aiueo'.includes(r[0])) r = (r.startsWith('ch') ? 't' : r[0]) + r;
      geminate = false;
      out += r;
    };
    for (let i = 0; i < s.length;) {
      const snd = sound(s, i);
      if (snd) { put(snd[0]); i += snd[1]; continue; }
      const c = s[i];
      if (c === 'っ') { geminate = true; i++; continue; }
      if (c === 'ー') { out += (out.match(/[aiueo]$/) || [''])[0]; i++; continue; }
      if (c === 'ん') {
        const next = sound(s, i + 1);
        out += next && /^[aiueoy]/.test(next[0]) ? "n'" : 'n';
        geminate = false;
        i++;
        continue;
      }
      geminate = false;
      out += c.normalize('NFKC');
      i++;
    }
    return out;
  }

  return { toKana, fromKana, toHiragana };
})();
if (typeof module !== 'undefined') module.exports = Romaji;
