# Japanese ⇄ English Translator

A small website that translates between Japanese and English. It is plain HTML, CSS and JavaScript, so there is nothing to install or build.

## Features

- **Both directions.** The ⇄ button swaps Japanese → English and English → Japanese.
- **Type Japanese any way you like.** Kana and kanji work, and so does romaji (`konnichiwa`).
- **Hiragana and romaji, always.** Japanese text comes with both readings, whether you typed it or it is the translation. They show under the Japanese text and under each phrase in the word-by-word view. Tick or untick **Hiragana** and **Romaji** to show or hide a line.
- **Word by word.** After a translation, the phrases of the source and the matching words of the translation get the same color. Hover, tap or focus one to light up its partner. The *List* tab shows the same pairs one per row.
- Listen to either side, copy the result, dark mode, works on phones.

## Run it

Open `index.html` in a browser. Or serve the folder and open http://localhost:8000:

```
python3 -m http.server
```

To put it online for free, use GitHub Pages (Settings → Pages → deploy from the `main` branch).

## Translation service

By default the site uses [MyMemory](https://mymemory.translated.net): free, no key, but with a daily limit and uneven quality.

To use **Google Cloud Translation** instead, put an API key in `config.js`:

```js
const APP_CONFIG = {
  googleApiKey: 'your key here',
};
```

Getting a key (the Google Cloud Console menus change now and then, so treat these as a guide):

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project and turn on billing. Google asks for a billing account even if you stay within the free allowance.
2. Enable the **Cloud Translation API** for the project.
3. Create an **API key** under *APIs & Services → Credentials*.
4. Edit the key and restrict it. Under *Application restrictions* choose *Websites* and add your site's address (for example `https://your-name.github.io/*`, plus `http://localhost:*/*` if you test locally). Under *API restrictions* allow only the Cloud Translation API.
5. Set a daily quota and a budget alert, so a leaked key cannot cost much.

The key ends up in a public file, so the restrictions in step 4 and the limits in step 5 are what protect you. Check Google's pricing page for the current free allowance and prices.

## Readings: how Japanese is read

- **Romaji and kana** are read right in the page. Nothing is downloaded.
- **Kanji** need a dictionary. The page loads [kuromoji.js](https://github.com/takuyaa/kuromoji.js) (Apache-2.0) and its IPADIC dictionary from a CDN (jsDelivr, with unpkg as a backup) the first time kanji appear. That is about 17 MB, which the browser keeps afterwards, so the first reading takes a moment. The text itself never leaves your browser for this step. The script is pinned to one version and checked against a hash.
- **Spelling.** Romaji follows Hepburn, but long vowels are written out (`toukyou`, `raamen`) the same way the page reads them when you type them, so the output can be typed back in. The particles は, へ and を are written `wa`, `e` and `o`. Katakana words are shown in hiragana.
- **Limits.** A dictionary reads each word in context, which is right most of the time but not always (names, some counters, words with several readings). Numbers and Latin letters are left as they are.

## How "Word by word" works

The translation services here do not say which word became which, so the page works it out:

1. The source is split into phrases: a word together with its particles or small words (`watashi wa`, `jibun no`, `kataritai`).
2. Each phrase is translated on its own.
3. The page looks for the matching words in the real translation and links them.

This is best effort. A phrase is only linked when the service translates it about the same way alone and in the full sentence, so some words stay plain, for example *tell* when the phrase alone came back as *talk*. Long texts are limited to the first 30 phrases (60 with Google). It costs one extra request per phrase with MyMemory, or one extra batched request with Google. Untick **Word by word** to turn it off.

A service that returns the pairing itself (for example a language model) can be added by giving `Engine` an `align({ src, tgt, from, to })` function that returns links; see `align.js` for the format.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | The page and its look |
| `app.js` | Wires the page together |
| `romaji.js` | Romaji → kana and kana → romaji |
| `reading.js` | Hiragana and romaji readings of Japanese text |
| `kuromoji-analyzer.js` | Reads kanji with the kuromoji dictionary |
| `align.js` | Splits text into phrases and matches them to the translation |
| `engine.js` | Talks to MyMemory or Google |
| `config.js` | Optional settings (Google key) |
| `tests/` | Automated tests |

## Tests

Needs Node 18 or newer:

```
node --test tests/align.test.js tests/engine.test.js tests/reading.test.js tests/romaji.test.js
```
