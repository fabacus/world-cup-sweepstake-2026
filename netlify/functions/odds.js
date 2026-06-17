'use strict';

const { getStore } = require('@netlify/blobs');

const ODDSPAPI_BASE = 'https://api.oddspapi.io/v4';
const SOCCER_SPORT_ID = 10;

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

async function oddsFetch(path) {
  const key = process.env.ODDSPAPI_KEY;
  if (!key) throw new Error('ODDSPAPI_KEY environment variable not set');
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${ODDSPAPI_BASE}${path}${sep}apiKey=${key}`, {
    headers: { 'User-Agent': 'world-cup-sweepstake' },
  });
  if (!res.ok) throw new Error(`OddsPapi ${path} → ${res.status}`);
  return res.json();
}

function toImplied(decimal) {
  return (decimal && decimal > 1) ? 1 / decimal : 0;
}

async function fetchWinnerOdds() {
  // Find the World Cup 2026 tournament ID
  const tourData = await oddsFetch(`/tournaments?sportId=${SOCCER_SPORT_ID}`);
  const tournaments = Array.isArray(tourData.response) ? tourData.response
    : Array.isArray(tourData.data) ? tourData.data
    : Array.isArray(tourData) ? tourData : [];

  const wc = tournaments.find(t => {
    const n = (t.tournamentName || t.name || '').toLowerCase();
    return n.includes('world cup') && !n.includes('beach') && !n.includes('women')
      && !n.includes('u20') && !n.includes('u17');
  });
  if (!wc) {
    const names = tournaments.slice(0, 8).map(t => t.tournamentName || t.name);
    throw new Error(`World Cup not found in OddsPapi tournaments. Sample: ${JSON.stringify(names)}`);
  }

  const tournamentId = wc.tournamentId || wc.id;
  console.log(`OddsPapi: found "${wc.tournamentName || wc.name}" id=${tournamentId}`);

  // Fetch all odds for the tournament from Pinnacle (sharpest, best for fair odds)
  const oddsData = await oddsFetch(`/odds-by-tournaments?tournamentIds=${tournamentId}&bookmaker=pinnacle`);
  const fixtures = Array.isArray(oddsData.response) ? oddsData.response
    : Array.isArray(oddsData.data) ? oddsData.data
    : Array.isArray(oddsData) ? oddsData : [];

  if (!fixtures.length) {
    throw new Error('No odds returned by OddsPapi for this tournament');
  }

  // Collect implied probabilities per team across all outright-winner markets.
  // Outright markets have many outcomes (one per team); 1X2 markets have exactly 3.
  const teamProbs = {};

  for (const fixture of fixtures) {
    const bookmakers = fixture.bookmakerOdds || fixture.odds || {};
    const pinnacle = bookmakers.pinnacle || bookmakers.Pinnacle;
    if (!pinnacle) continue;

    const markets = pinnacle.markets || {};
    for (const [, market] of Object.entries(markets)) {
      const outcomes = market.outcomes || {};
      const entries = Object.entries(outcomes);
      if (entries.length < 10) continue; // Skip 1X2 and small markets

      for (const [, outcome] of entries) {
        const player = (outcome.players && outcome.players['0']) || outcome.player || outcome;
        const rawName = player.participantName || player.name || player.teamName || outcome.outcomeName || '';
        const price = player.price || outcome.price;
        if (!rawName || !price || price <= 1) continue;

        const team = normalizeTeam(rawName);
        const imp = toImplied(price);
        if (!teamProbs[team]) teamProbs[team] = [];
        teamProbs[team].push(imp);
      }
    }
  }

  if (Object.keys(teamProbs).length === 0) {
    throw new Error(
      `No outright winner odds found. Market IDs in first fixture: ${
        Object.keys(
          ((fixtures[0]?.bookmakerOdds?.pinnacle || fixtures[0]?.bookmakerOdds?.Pinnacle)?.markets) || {}
        ).join(', ')
      }`
    );
  }

  // Average across any duplicate sources, then remove bookmaker overround
  const averaged = Object.entries(teamProbs).map(([name, probs]) => ({
    name,
    implied: probs.reduce((s, p) => s + p, 0) / probs.length,
  }));
  const total = averaged.reduce((s, e) => s + e.implied, 0);

  const result = {};
  for (const { name, implied } of averaged) {
    result[name] = total > 0 ? (implied / total) * 100 : 0;
  }
  return result;
}

function toCsv(data) {
  const rows = ['country,probability'];
  for (const [country, prob] of Object.entries(data)) {
    rows.push(`${csvCell(country)},${Number(prob).toFixed(2)}`);
  }
  return rows.join('\n');
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'text/csv; charset=utf-8',
  };

  // GET: serve cached blob data
  if (event.httpMethod !== 'POST') {
    let csv = 'country,probability\n';
    try {
      const store = getStore('odds');
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

  // POST: scheduled update
  if (!process.env.ODDSPAPI_KEY) {
    console.log('ODDSPAPI_KEY not set — skipping odds update');
    return { statusCode: 200, body: 'ODDSPAPI_KEY not configured' };
  }

  try {
    const store = getStore('odds');

    const probabilities = await fetchWinnerOdds();

    await store.set('data', JSON.stringify(probabilities));
    await store.set('meta', JSON.stringify({ lastUpdated: Date.now(), teams: Object.keys(probabilities).length }));

    const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updated: true, teams: Object.keys(probabilities).length, top }),
    };
  } catch (err) {
    console.error('odds scheduled update failed:', err.message);
    return { statusCode: 500, body: `Error: ${err.message}` };
  }
};
