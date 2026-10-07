# Japanese ⇄ English Translator

A small website that translates between Japanese and English. It is plain HTML, CSS and JavaScript, so there is nothing to install or build.

## Features

- **Both directions.** The ⇄ button swaps Japanese → English and English → Japanese.
- **Type Japanese any way you like.** Kana and kanji work, and so does romaji (`konnichiwa`).
- **Hiragana and romaji, always.** Japanese text comes with both readings, whether you typed it or it is the translation. They show under the Japanese text and under each phrase in the word-by-word view. Tick or untick **Hiragana** and **Romaji** to show or hide a line.
- **Word by word.** After a translation, the phrases of the source and the matching words of the translation get the same color. Hover, tap or focus one to light up its partner. The *List* tab shows the same pairs one per row.
- **Better translations with Google.** Paste a Google key into the page (see below). Without one, the free MyMemory service is used.
- Listen to either side, copy the result, dark mode, works on phones.

## Run it

Open `index.html` in a browser. Or serve the folder and open http://localhost:8000:

```
python3 -m http.server
```

To put it online for free, use GitHub Pages (Settings → Pages → deploy from the `main` branch).

## Translation service

By default the site uses [MyMemory](https://mymemory.translated.net): free and needs no key, but it has a daily limit and its translations are often poor.

**Google Translate** is much better. It needs your own Google key. Two ways to use one:

- **On the page (easiest, and private).** Open **Translation service** under the Translate button, paste the key and press **Save key**. The page checks the key with Google first. The key is kept only in that browser and is sent only to Google. Anyone else who opens the site still gets MyMemory.
- **For everyone who visits.** Put the key in `config.js` instead. The key then sits in a public file, so restrict it as described in step 6 below.

If both are set, the key saved in the browser is used.

### Getting a Google key

The Google Cloud Console menus change now and then, so treat these steps as a guide.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in with a Google account.
2. Create a project: click the project name at the top left, choose **New project**, give it a name (for example `japanese-translator`) and click **Create**. Make sure it is the selected project afterwards.
3. Turn on billing: menu (☰) → **Billing**, then link a billing account (this means adding a payment card). Google asks for it even when you stay inside the free allowance. Check Google's [pricing page](https://cloud.google.com/translate/pricing) for the current free amount and prices. As a safety net, create a budget with an alert under **Billing → Budgets & alerts**, so you get an email if charges ever start.
4. Turn on the API: open the [Cloud Translation API page](https://console.cloud.google.com/apis/library/translate.googleapis.com) and click **Enable**.
5. Create the key: menu (☰) → **APIs & Services** → **Credentials** → **Create credentials** → **API key**. Copy the key (it starts with `AIza`).
6. Restrict the key, so it cannot be used from other websites: click the key's name. Under *Application restrictions* choose **Websites**, add your site's address (for example `https://your-name.github.io/*`, and `http://localhost:*/*` if you test on your own computer). Under *API restrictions* choose **Restrict key** and tick **Cloud Translation API**. Save. It can take a few minutes to take effect.
7. Optional: under **APIs & Services → Cloud Translation API → Quotas & System limits** you can lower the daily limit.
8. Paste the key into the **Translation service** box on the site and press **Save key**.

If the page says the key was not accepted, it also says what to fix (a typo, the API not turned on, billing, or the website restriction).

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
