# Continent Quiz

A mobile-first geography quiz: match countries to continents (and the reverse). Built for phones, kids, and family play — no login, no API keys.

## Play

Run locally from this folder:

```bash
python3 -m http.server 8766
```

Then visit `http://127.0.0.1:8766/`.

(Port 8766 avoids clashing with Capital & Flag Quiz on 8765.)

## What's included

- 170+ countries with flag emoji and a Tourist, Globetrotter, or Cartographer tier across Africa, Asia, Europe, North America, South America, and Oceania (Antarctica omitted; Central America / Caribbean map to North America)
- Two question types in one app: **country → continent** and **continent → country** (exactly 4 multiple-choice options each). Default mix interleaves both; the start screen can lock to one type
- Difficulty: Tourist, Globetrotter, Cartographer, or Random. Random picks one level for the whole round and shows it on the HUD and results
- Tourist uses well-known countries and clearer continent distractors. Globetrotter mixes familiarity. Cartographer uses less familiar countries and tougher continent / neighboring-continent distractors
- Round lengths: 5, 10, 15, 20, 40, or 50. A round is shortened if that difficulty does not have enough countries (shown on screen). Cartographer supports 50
- Score and streak HUD; end-of-round review lists right/wrong, the correct answer, and your pick when wrong
- **Leaderboard is localStorage on this device only**: display name (trimmed ≤20, HTML/controls stripped), score, difficulty label, round length, and date. No account and no server

## Files

- `index.html` — screens
- `styles.css` — mobile-first UI
- `game.js` — quiz flow, review, and leaderboard
- `data.js` — country → continent data and difficulty pools

## License

For personal / family use. No secrets in this repo.
