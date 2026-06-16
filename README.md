# Fabacus World Cup Sweepstake

Static CSV version. Deploy the whole folder to Netlify. The website reads these local files beside `index.html` and `standalone.html`:

- `teams.csv` - colleague and team allocations, pre-filled from the existing archive.
- `matches.csv` - fixtures/results. Add scheduled, live, or finished rows here.
- `probabilities.csv` - outright win probability percentages for the favourites widget.

## matches.csv columns

```csv
datetime,status,home,away,home_score,away_score,home_red_cards,away_red_cards
```

Examples:

```csv
2026-06-11 20:00,scheduled,Argentina,Norway,,,,
2026-06-12 17:00,finished,France,Germany,2,1,0,1
```

Use team names exactly as they appear in `teams.csv`. The dashboard refreshes every minute. To update Netlify, replace the CSV file and redeploy.

## Updating match results

`matches.csv` is pre-filled with the 2026 World Cup fixture list in UK local time. To update the sweepstake during the tournament, edit only these columns for the relevant match row:

- `status`: change `scheduled` to `finished` when the match is complete.
- `home_score` and `away_score`: enter the final score.
- `home_red_cards` and `away_red_cards`: enter red-card counts, or leave blank for zero.

For knockout placeholders, replace `Winner...`, `Loser...`, `1st Group...`, `2nd Group...`, or `3rd place finisher` with the actual country names once they are known.


## CSV allocation files
- `teams.csv` is the file the dashboard reads for colleague/team allocation.
- `participants.csv` is a human-friendly two-team-per-person check file generated from `teams.csv`.
- Costa Rica and Bolivia have been removed because they are not in this fixture list. Pete now has Senegal and Connor now has Ghana, so all 48 fixture teams are allocated exactly once.
- `probabilities.csv` has been refreshed to match the same 48 teams.


V13 notes
- Participants, flags and upcoming fixtures now render from local CSV files with embedded fallback data, so the page still displays even if the browser blocks local CSV fetches during preview.
- To update results, edit matches.csv and redeploy/replace the file.
- Kick-off times are displayed in GMT.

## OneDrive scores CSV setup

The dashboard now tries to load match scores from a OneDrive-hosted CSV first via the Netlify function:

`/.netlify/functions/onedrive-scores`

To use it:

1. Save `scores.csv` to OneDrive.
2. In OneDrive, share the CSV so anyone with the link can view it.
3. In Netlify, add an environment variable named `ONEDRIVE_SCORES_CSV_URL` with the OneDrive share link as the value.
4. Redeploy the site.

If the OneDrive URL is missing or temporarily unavailable, the site falls back to the bundled local `scores.csv` / `matches.csv` so the page still loads.

Visible match dates now use an unambiguous UK long-date format, for example `11 June 2026`, rather than short numeric dates that can be misread as 6 November.
