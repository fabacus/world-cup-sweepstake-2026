'use strict';

const { getStore } = require('@netlify/blobs');

// Manual Blobs config: CLI deploys don't auto-inject the Blobs context, so
// pass siteID/token explicitly when available. Falls back to implicit
// configuration for local dev / auto-injected environments.
function blobStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  return (siteID && token) ? getStore({ name, siteID, token }) : getStore(name);
}

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const WC_LEAGUE = 1;
const WC_SEASON = 2026;

// Map API-Football team names to the canonical names used in this app
const TEAM_ALIASES = {
  'United States': 'United States',
  'USA': 'United States',
  'Korea Republic': 'South Korea',
  'Republic of Korea': 'South Korea',
  'Turkey': 'Turkiye',
  'Türkiye': 'Turkiye',
  "Côte d'Ivoire": 'Ivory Coast',
  "Cote d'Ivoire": 'Ivory Coast',
  'Cote dIvoire': 'Ivory Coast',
  'Congo DR': 'DR Congo',
  'Democratic Republic of Congo': 'DR Congo',
  'Curaçao': 'Curacao',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  'Czech Republic': 'Czechia',
};

function normalizeTeam(name) {
  const s = String(name || '').trim();
  return TEAM_ALIASES[s] || s;
}

function csvCell(v) {
  const s = String(v ?? '');
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

async function apiFetch(path) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY environment variable not set');
  const res = await fetch(`${API_FOOTBALL_BASE}${path}`, {
    headers: { 'x-apisports-key': key, 'User-Agent': 'world-cup-sweepstake' }
  });
  if (!res.ok) throw new Error(`API-Football ${path} → ${res.status}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football errors: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

function toCsv(data) {
  const rows = ['home,away,home_red_cards,away_red_cards'];
  for (const entry of Object.values(data)) {
    rows.push([csvCell(entry.home), csvCell(entry.away), entry.homeRed, entry.awayRed].join(','));
  }
  return rows.join('\n');
}

function getRedCards(statBlock) {
  if (!statBlock) return 0;
  const rc = (statBlock.statistics || []).find(s => s.type === 'Red Cards');
  return (rc && rc.value !== null && rc.value !== undefined) ? Number(rc.value) || 0 : 0;
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'text/csv; charset=utf-8',
  };

  // GET: serve cached blob data
  if (event.httpMethod !== 'POST') {
    let csv = 'home,away,home_red_cards,away_red_cards\n';
    try {
      const store = blobStore('red-cards');
      const raw = await store.get('data', { type: 'text' });
      if (raw) csv = toCsv(JSON.parse(raw));
    } catch (err) {
      console.log('Blobs unavailable (local dev):', err.message);
    }
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=300, s-maxage=1800' },
      body: csv,
    };
  }

  // POST: scheduled incremental update
  if (!process.env.API_FOOTBALL_KEY) {
    console.log('API_FOOTBALL_KEY not set — skipping red-cards update');
    return { statusCode: 200, body: 'API_FOOTBALL_KEY not configured' };
  }

  try {
    const store = blobStore('red-cards');

    // Load previously stored data
    let existing = {};
    try {
      const raw = await store.get('data', { type: 'text' });
      if (raw) existing = JSON.parse(raw);
    } catch {}

    // Fetch all finished WC fixtures (1 API call)
    const { response: fixtures } = await apiFetch(
      `/fixtures?league=${WC_LEAGUE}&season=${WC_SEASON}&status=FT`
    );
    if (!Array.isArray(fixtures)) throw new Error('Unexpected fixtures response');

    let newCount = 0;
    for (const f of fixtures) {
      const fixtureId = String(f.fixture.id);
      if (existing[fixtureId]) continue; // Already processed — skip to save API quota

      try {
        const { response: stats } = await apiFetch(`/fixtures/statistics?fixture=${fixtureId}`);
        existing[fixtureId] = {
          home: normalizeTeam(f.teams.home.name),
          away: normalizeTeam(f.teams.away.name),
          homeRed: getRedCards(stats.find(s => s.team.id === f.teams.home.id)),
          awayRed: getRedCards(stats.find(s => s.team.id === f.teams.away.id)),
        };
        newCount++;
      } catch (err) {
        console.error(`Stats failed for fixture ${fixtureId}: ${err.message}`);
      }
    }

    if (newCount > 0) {
      await store.set('data', JSON.stringify(existing));
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newMatches: newCount, total: Object.keys(existing).length }),
    };
  } catch (err) {
    console.error('red-cards scheduled update failed:', err.message);
    return { statusCode: 500, body: `Error: ${err.message}` };
  }
};
