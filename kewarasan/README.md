# Kewarasan — Edition 1 (browser game)

*Last one still sane wins. / Yang paling terakhir masih waras, dialah pemenangnya.*

A satirical Monopoly-style game for 3–6 players (17+), implemented as a static website from the Edition 1 rulebook and card list.

## Play

Open `index.html` through any static server (the repo root works too):

```bash
python3 -m http.server 8000   # then visit http://localhost:8000/kewarasan/
```

- Pass-and-play: any seat can be Human or Bot.
- Progress is saved at the start of every turn; use **Continue** on the menu.
- All 160 cards and 40 tiles are bilingual (EN / ID) and come straight from `docs/`.

## Files

| File | What it is |
|---|---|
| `index.html`, `style.css`, `game.js` | The game (vanilla JS, no build step) |
| `data.js` | Board + cards, generated from `docs/*.md` by `tools/gen-data.js` |
| `docs/` | Rulebook, card list, and original design brief |

Regenerate the data after editing the markdown: `node kewarasan/tools/gen-data.js`.

## Where the digital edition interprets or extends the rulebook

- **Burnout creep (optional house rule, on by default):** every 4 full rounds (3 with 5–6 players) everyone loses 1 Kewarasan. Bot simulations of the pure rules gave 250–1,500 turns per game, far beyond 90 minutes, because GO, Rest Stop and Self-Care roughly cancel the losses. With creep, a game is about 100–300 turns. Untick it on the menu for the pure rulebook.
- Each player starts with two Self-Care cards in hand; the deck keeps its own six. Drawn Self-Care cards are kept and played from **Manage**.
- "Move to any Institution" is a direct move (no GO bonus); "next Institution" walks forward and can pass GO.
- Lembur Dulu costs 2 Kewarasan, then the Clinic costs 1 more and 2 skipped turns.
- An unowned Utility can be bought; if declined, its bill goes to the bank. Declined Transit tiles are not auctioned (traffic penalty only).
- Skipped turns skip Paylater rolls and Cicilan drain.
- Player-to-player trading is not implemented yet.

## Testing

`?autoplay=N` (3–6) runs an all-bot game with no UI delays and exposes the result on `window.__done`; add `&creep=4` to enable creep.
