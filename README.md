# Continent Quiz

A mobile-first geography quiz for families. Each question shows a **map of one continent with exactly one country highlighted**. You answer “Which country is highlighted?” from four country names.

No login, no API keys, and no paid map tiles. Country shapes are bundled in the repo, so a round keeps working after the page has loaded — including offline.

## Play locally

From this folder:

```bash
python3 -m http.server 8766
```

Then open `http://127.0.0.1:8766/`.

(Port 8766 avoids clashing with Capital & Flag Quiz on 8765. This repo does not change that other quiz.)

GitHub Pages can host these static files as-is (`index.html`, `styles.css`, `game.js`, `data.js`, `maps.js`).

## How a round works

- The map is one continent (Africa, Asia, Europe, North America, South America, or Oceania). Central America and the Caribbean are on the North America map.
- One country uses a bright orange fill and a dark outline so it stays obvious on a phone. If that country is small, the map zooms in and the caption says “zoomed in”.
- Four large name buttons. Tourist favors well-known countries and other familiar names. Globetrotter mixes familiarity. Cartographer uses less familiar countries and nearby, easy-to-confuse countries on the same continent.
- **Random** picks Tourist, Globetrotter, or Cartographer once for the whole round and shows that level on the score bar and the results.
- Each difficulty has a solid face avatar on the start screen (`assets/avatars/`). The score bar, results, and leaderboard reuse a small copy of that level’s face. The pictures are SVG files in this repo, so they do not need an image host.
- Round lengths: 5, 10, 15, 20, 40, or 50. If that difficulty does not have enough countries, the round is shortened (the screen says so). Cartographer has enough countries for 50.
- Score and streak while you play. At the end, the review lists right or wrong, the correct country, and your pick when you missed.
- **Leaderboard is localStorage on this device only.** Display name is trimmed to 20 characters, with HTML and control characters stripped. The board stores the score, difficulty, round length, and date. No account and no server.

## Map data

Shapes come from [Natural Earth](https://www.naturalearthdata.com/) 1:50m cultural vectors (admin-0 countries), which are public domain. `scripts/build_maps.py` simplifies them and writes `maps.js`. That file is already committed, so playing does not download a library or call a map service.

To regenerate after editing the country list in `data.js`:

```bash
python3 scripts/build_maps.py
```

The script downloads the GeoJSON once into `scripts/.cache/` (gitignored). Very small overseas pieces are left off the continent view (for example Hawaii on the United States, Svalbard on Norway) so the highlighted country stays recognizable. Countries without a drawable shape are omitted from rounds; the current Natural Earth extract includes the full country list.

## Files

- `index.html` — start, question, and results screens
- `styles.css` — mobile-first layout
- `game.js` — rounds, scoring, review, and leaderboard
- `data.js` — country names, continents, and difficulty tiers
- `maps.js` — bundled continent shapes and neighboring countries
- `assets/avatars/` — solid face pictures for Tourist, Globetrotter, Cartographer, Random, and the start-screen hero
- `scripts/build_maps.py` — optional rebuild of `maps.js`

## License

For personal and family use. Map shapes are public-domain Natural Earth data. No secrets in this repo.
