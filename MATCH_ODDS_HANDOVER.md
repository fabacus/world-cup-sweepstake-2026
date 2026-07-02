# Handover: Adding per-match win probabilities to the app

## Goal
Show, for each World Cup game, the probability that the home team wins / it's a
draw / the away team wins — sourced live from OddsPapi and displayed on the
**Games** tab.

> **Important context:** OddsPapi does **not** provide a tournament *outright
> winner* market (chance a country wins the whole World Cup). See
> "What we learned" below. This handover is specifically about **per-match**
> probabilities, which OddsPapi *does* provide. The existing "winner takes all"
> country probabilities (`probabilities.csv` / `state.odds`) are a separate,
> static concern and are not addressed here.

---

## What we learned (verified against the live API, June 2026)

- Tournament **id=16 "World Cup"** is the real FIFA World Cup 2026. (The name
  matcher in the current `odds.js` is buggy — it grabs `id=13 "FIFA World Cup,
  Qualification CAF"` first, which 404s. **Hardcode id=16 instead.**)
- `odds-by-tournaments` returns **per-match** fixtures with markets keyed by
  numeric IDs. There is **no outright-winner market** anywhere (checked Pinnacle,
  bet365, William Hill; the "World Cup 2026 Novelties" tournament has no fixtures).
- Odds fixtures carry **no team names** — only `participant1Id` / `participant2Id`.
  Names come from a **separate** `/fixtures` endpoint; join on `fixtureId`.
- The moneyline market (**market `101`**) has exactly the 3 outcomes we need,
  labelled via `bookmakerOutcomeId`: `home` / `draw` / `away`.
- **Rate limits are tight** — ~2 rapid requests triggers HTTP 429. The plan is
  hourly/twice-daily and only makes 2 calls, so this is fine *as long as* we
  don't loop per-fixture.
- Only **upcoming** fixtures have odds (`hasOdds: true`, `statusId: 0`). Past
  fixtures return `hasOdds: false`. `odds-by-tournaments` already returns only
  the ones with odds (~11 at a time).

---

## API reference

Base URL: `https://api.oddspapi.io/v4`
Auth: append `apiKey=<ODDSPAPI_KEY>` as a **query-string** parameter (not a header).

### 1. Fixtures (gives names) — `GET /fixtures?tournamentId=16`
Returns ~104 fixtures for the tournament. Relevant fields per item:

```jsonc
{
  "fixtureId": "id1000001666456904",
  "participant1Id": 4781,
  "participant1Name": "Team A",      // <-- home team name
  "participant2Id": 4736,
  "participant2Name": "Team B",      // <-- away team name
  "startTime": "2026-06-11T19:00:00.000Z",
  "statusId": 2,                      // 0 = upcoming, 2 = finished
  "hasOdds": false
}
```
> Note: use singular `tournamentId` (plural `tournamentIds` is only for
> `odds-by-tournaments`).

### 2. Odds (gives prices) — `GET /odds-by-tournaments?tournamentIds=16&bookmaker=pinnacle`
Returns only fixtures that currently have odds. Shape:

```jsonc
{
  "fixtureId": "id1000001653452551",
  "participant1Id": 4698,
  "participant2Id": 4718,
  "startTime": "2026-07-02T19:00:00.000Z",
  "bookmakerOdds": {
    "pinnacle": {
      "markets": {
        "101": {                       // <-- moneyline / 1X2 market
          "outcomes": {
            "101": { "players": { "0": { "bookmakerOutcomeId": "home", "price": 1.303 } } },
            "102": { "players": { "0": { "bookmakerOutcomeId": "draw", "price": 5.65  } } },
            "103": { "players": { "0": { "bookmakerOutcomeId": "away", "price": 12.75 } } }
          }
        }
        // ... many other markets (over/under, correct score, etc.) — ignore
      }
    }
  }
}
```

### Converting prices → probability
`price` is **decimal odds**. Implied probability = `1 / price`. The three
outcomes include the bookmaker's margin ("vig"), so normalise them to sum to 1:

```
home=1.303, draw=5.65, away=12.75
implied = [1/1.303, 1/5.65, 1/12.75] = [0.767, 0.177, 0.078]  (sum 1.022)
de-vigged % = each / sum * 100 = [75.0%, 17.3%, 7.7%]
```

---

## How `odds.js` needs to change

The current `fetchWinnerOdds()` (outright-winner logic) should be **replaced**
with a match-odds fetch that joins the two endpoints. Concretely:

### a) Hardcode the tournament ID
Delete the name-search in `fetchWinnerOdds()` (lines ~61–79). Replace with:
```js
const WC_TOURNAMENT_ID = 16; // FIFA World Cup 2026 (verified). Name-matching is unreliable.
```

### b) New fetch: fixtures + odds, joined on fixtureId
```js
async function fetchMatchOdds() {
  // 1. Names, keyed by fixtureId
  const fx = await oddsFetch(`/fixtures?tournamentId=${WC_TOURNAMENT_ID}`);
  const fixtures = Array.isArray(fx.response) ? fx.response
    : Array.isArray(fx.data) ? fx.data : Array.isArray(fx) ? fx : [];
  const nameById = {};
  for (const f of fixtures) {
    nameById[f.fixtureId] = {
      home: normalizeTeam(f.participant1Name),
      away: normalizeTeam(f.participant2Name),
      date: f.startTime,
    };
  }

  // 2. Odds (only fixtures that have them)
  const od = await oddsFetch(`/odds-by-tournaments?tournamentIds=${WC_TOURNAMENT_ID}&bookmaker=pinnacle`);
  const priced = Array.isArray(od.response) ? od.response
    : Array.isArray(od.data) ? od.data : Array.isArray(od) ? od : [];

  const rows = [];
  for (const f of priced) {
    const meta = nameById[f.fixtureId];
    if (!meta) continue; // odds fixture with no name match — skip
    const outcomes = f.bookmakerOdds?.pinnacle?.markets?.['101']?.outcomes || {};
    const prices = {};
    for (const o of Object.values(outcomes)) {
      const p = o.players?.['0'] || o;
      if (p.bookmakerOutcomeId && p.price > 1) prices[p.bookmakerOutcomeId] = p.price;
    }
    if (!prices.home || !prices.draw || !prices.away) continue; // no moneyline → skip

    const imp = { home: 1 / prices.home, draw: 1 / prices.draw, away: 1 / prices.away };
    const total = imp.home + imp.draw + imp.away;
    rows.push({
      home: meta.home,
      away: meta.away,
      date: meta.date,
      homeWin: (imp.home / total) * 100,
      draw:    (imp.draw / total) * 100,
      awayWin: (imp.away / total) * 100,
    });
  }
  if (!rows.length) throw new Error('No match odds found for tournament 16');
  return rows;
}
```

### c) New CSV shape
Replace `toCsv()` (`country,probability`) with a per-match schema:
```js
function toCsv(rows) {
  const out = ['home,away,date,home_win,draw,away_win'];
  for (const r of rows) {
    out.push([
      csvCell(r.home), csvCell(r.away), csvCell(r.date),
      r.homeWin.toFixed(1), r.draw.toFixed(1), r.awayWin.toFixed(1),
    ].join(','));
  }
  return out.join('\n');
}
```
The blob is now an **array** of match rows (not the country→prob object), so:
- The GET header default becomes `home,away,date,home_win,draw,away_win\n`.
- In the POST handler, `await store.set('data', JSON.stringify(await fetchMatchOdds()))`.
- The GET handler's `toCsv(JSON.parse(raw))` now receives that array — matches
  the new `toCsv` signature above.

### d) Everything else stays
`oddsFetch()`, `blobStore()`, `normalizeTeam()`/`TEAM_ALIASES`, the schedule in
`netlify.toml`, and the two-endpoints-only call pattern (rate-limit safe) are all
unchanged.

---

## Frontend changes (`app.js`) — needed for the data to show

The odds function now emits **match** rows, not country probabilities. Wire them
into matches the same way red cards are merged (join by `home|away`):

1. **CONFIG:** the existing `probabilitiesCsv: '/.netlify/functions/odds'` now
   returns match odds. Consider renaming to `matchOddsCsv` for clarity, and drop
   the old `normalizeOdds`/`state.odds` country usage (it falls back to
   `probabilities.csv`).
2. **Parse + merge** (mirror the red-cards merge at `app.js:270-280`):
   ```js
   const oddsRows = parseCsv(await fetchCsvOrFallback(CONFIG.matchOddsCsv, ''));
   const oddsMap = new Map();
   for (const r of oddsRows) {
     const home = normalizeName(r.home), away = normalizeName(r.away);
     if (home && away) oddsMap.set(`${home}|${away}`, {
       homeWin: numberOrZero(r.home_win), draw: numberOrZero(r.draw), awayWin: numberOrZero(r.away_win),
     });
   }
   state.matches = state.matches.map(m => {
     const o = oddsMap.get(`${m.home}|${m.away}`);
     return o ? { ...m, odds: o } : m;
   });
   ```
3. **Render** the three percentages in the game card (near the score/status in
   `renderMatch`, around `app.js:400`), e.g.
   `${match.odds.homeWin}% / ${match.odds.draw}% / ${match.odds.awayWin}%`.

### Team-name matching (watch out)
OddsPapi names won't always equal the app's `teams.csv` names (e.g. `USA`,
`Korea Republic`, `Turkey`). `normalizeTeam` (in `odds.js`) and `normalizeName`
(in `app.js`) already carry alias maps — **verify the actual OddsPapi
`participant*Name` values against `teams.csv`** and add any missing aliases,
otherwise the `home|away` join silently misses.

---

## Testing locally
Reusable probe scripts (need `ODDSPAPI_KEY` in env; they never print the key):
- `scratchpad/probe-oddspapi.mjs` — lists tournaments, confirms id=16.
- `scratchpad/probe5.mjs` — dumps the moneyline market + de-vig math.
- `scratchpad/probe6.mjs` — `/fixtures` name resolution.

Run: `ODDSPAPI_KEY=xxx node scratchpad/probeN.mjs`. Space calls ≥6s apart to
avoid 429. To test the real function end-to-end, deploy to master and
`curl -X POST https://fabacus-sweepstake.netlify.app/.netlify/functions/odds`.

---

## Open decisions / risks
1. **What happens to the country "winner takes all" probability?** It currently
   comes from `state.odds` via this same function. Once `odds.js` serves match
   odds, that display falls back to the static `probabilities.csv`. Decide
   whether that's acceptable or whether match odds should live in a **new**
   function (e.g. `match-odds.js`) leaving `odds.js` alone.
2. **Bookmaker choice** — Pinnacle is sharp/reliable but occasionally a fixture
   lacks it; consider a fallback bookmaker if `market 101` is missing.
3. **Rate limits** — keep to the 2-call pattern; never fetch per-fixture.
4. **Name normalization** — the biggest source of silent failure; validate
   against `teams.csv`.
5. **Env vars** — the Blobs fix (`NETLIFY_SITE_ID` + `NETLIFY_API_TOKEN`) must
   stay set on the Netlify site for read/write to work (see git history).
