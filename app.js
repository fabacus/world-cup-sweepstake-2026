const SCORING = { win: 3, draw: 1, knockoutProgress: 2, champion: 10 };

const CONFIG = {
  teamsCsv: './teams.csv',
  matchesCsv: '/.netlify/functions/openfootball-matches',
  redCardsCsv: '/.netlify/functions/red-cards',
  probabilitiesCsv: '/.netlify/functions/odds',
  refreshMs: 60 * 1000
};

const FALLBACK_CSV = {
  teamsCsv: "participant,country,code\nMiriam,Morocco,ma\nMiriam,Czechia,cz\nOscar,Canada,ca\nOscar,Saudi Arabia,sa\nMegan,Uruguay,uy\nMegan,Tunisia,tn\nJamie,Belgium,be\nJamie,Jordan,jo\nDennis,Ecuador,ec\nDennis,Scotland,gb-sct\nKatie,Egypt,eg\nKatie,Netherlands,nl\nSacha,Australia,au\nSacha,Croatia,hr\nAly,United States,us\nAly,Uzbekistan,uz\nSimon,Paraguay,py\nSimon,South Africa,za\nConnor,Germany,de\nConnor,Ghana,gh\nGus,France,fr\nGus,Curacao,cw\nNina,Mexico,mx\nNina,Bosnia and Herzegovina,ba\nJB,Portugal,pt\nJB,Iraq,iq\nPravan,Argentina,ar\nPravan,Norway,no\nSam,South Korea,kr\nSam,Austria,at\nEmma,Colombia,co\nEmma,Haiti,ht\nKaro,Japan,jp\nKaro,Sweden,se\nCraig,Switzerland,ch\nCraig,Iran,ir\nSteve,England,gb-eng\nSteve,Cape Verde,cv\nPete,Senegal,sn\nPete,Algeria,dz\nWaj,New Zealand,nz\nWaj,Spain,es\nScott,Brazil,br\nScott,Qatar,qa\nSwareena,Panama,pa\nSwareena,Turkiye,tr\nAndrew,Ivory Coast,ci\nAndrew,DR Congo,cd\n",
  probabilitiesCsv: "country,probability\nMorocco,2\nCzechia,0\nCanada,0\nSaudi Arabia,0\nUruguay,3\nTunisia,0\nBelgium,4\nJordan,0\nEcuador,0\nScotland,0\nEgypt,0\nNetherlands,5\nAustralia,0\nCroatia,2.5\nUnited States,1.2\nUzbekistan,0\nParaguay,0\nSouth Africa,0\nGermany,7\nGhana,0.4\nFrance,12\nCuracao,0\nMexico,1.2\nBosnia and Herzegovina,0\nPortugal,6\nIraq,0\nArgentina,13\nNorway,0\nSouth Korea,0\nAustria,0\nColombia,2\nHaiti,0\nJapan,1.5\nSweden,0\nSwitzerland,0\nIran,0\nEngland,9\nCape Verde,0\nSenegal,0.8\nAlgeria,0\nNew Zealand,0\nSpain,8\nBrazil,11\nQatar,0\nPanama,0\nTurkiye,0\nIvory Coast,0\nDR Congo,0\n"
};


const NAME_ALIASES = {
  'Czech Republic': 'Czechia',
  'Congo DR': 'DR Congo',
  'Democratic Republic of Congo': 'DR Congo',
  'Cote dIvoire': 'Ivory Coast',
  "Cote d'Ivoire": 'Ivory Coast',
  'Côte d’Ivoire': 'Ivory Coast',
  'USA': 'United States',
  'US': 'United States',
  'Korea Republic': 'South Korea',
  'Republic of Korea': 'South Korea',
  'Türkiye': 'Turkiye',
  'Turkey': 'Turkiye',
  'Curaçao': 'Curacao',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  'KOR': 'South Korea',
  'MEX': 'Mexico',
  'RSA': 'South Africa'
};

let state = {
  participants: [],
  teams: [],
  teamOwner: {},
  teamCode: {},
  matches: [],
  odds: {}
};

function normalizeName(name) {
  const cleaned = String(name || '').trim();
  return NAME_ALIASES[cleaned] || cleaned;
}

function flag(code) {
  return `https://flagcdn.com/w80/${String(code || '').toLowerCase()}.png`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function flagEmoji(code) {
  const cc = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '🏳️';
  return cc.replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function flagMarkup(code, teamName) {
  const safeName = escapeHtml(teamName || 'team');
  const safeCode = String(code || '').toLowerCase();
  return `<span class="flag-wrap"><img src="${flag(safeCode)}" alt="${safeName} flag" loading="lazy" onerror="this.style.display='none'"><span class="flag-emoji" aria-hidden="true">${flagEmoji(safeCode)}</span></span>`;
}

function cacheBust(url) {
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}v=${Date.now()}`;
}

async function fetchText(url) {
  const response = await fetch(cacheBust(url), { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function fetchCsvOrFallback(urls, fallbackText) {
  const sources = Array.isArray(urls) ? urls : [urls];
  const errors = [];
  for (const url of sources) {
    try {
      const text = await fetchText(url);
      if (text && text.trim()) return text;
      errors.push(`${url} was empty`);
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  console.warn(`Using embedded fallback after CSV source errors: ${errors.join(' | ')}`);
  return fallbackText;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(value.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value.trim());
    if (row.some(cell => cell !== '')) rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map(header => header.trim().toLowerCase());
  return rows.slice(1).map(cells => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = (cells[index] || '').trim();
    });
    return item;
  });
}

function numberOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrZero(value) {
  const n = numberOrNull(value);
  return n === null ? 0 : n;
}

function normalizeStatus(status, homeScore, awayScore) {
  const s = String(status || '').trim().toUpperCase();
  if (['FINISHED', 'FT', 'FULL_TIME', 'COMPLETED', 'ENDED', 'PLAYED', 'FINAL'].includes(s)) return 'FINISHED';
  if (['LIVE', 'IN_PLAY', 'PLAYING', 'ONGOING', 'IN PROGRESS', 'IN_PROGRESS', 'CURRENTLY ONGOING', '1H', '2H', 'HT'].includes(s)) return 'LIVE';
  if (!s && homeScore !== null && awayScore !== null) return 'FINISHED';
  return 'SCHEDULED';
}

function parseDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)) return `${raw.replace(' ', 'T')}Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)) return `${raw}Z`;
  return raw;
}

function buildParticipants(teamRows) {
  const byPerson = new Map();
  const teams = [];

  for (const row of teamRows) {
    const participant = row.participant || row.colleague || row.name || '';
    const country = normalizeName(row.country || row.team || row.nation || '');
    const code = row.code || row.flag_code || row.flag || '';
    if (!participant || !country) continue;

    const team = { name: country, code };
    if (!byPerson.has(participant)) byPerson.set(participant, []);
    byPerson.get(participant).push(team);
    teams.push({ ...team, participant });
  }

  return {
    participants: Array.from(byPerson.entries()).map(([participant, personTeams]) => ({ participant, teams: personTeams })),
    teams
  };
}

function normalizeMatches(rows) {
  return rows.map(row => {
    const home = normalizeName(row.home || row.home_team || row.team1 || row.team_a || '');
    const away = normalizeName(row.away || row.away_team || row.team2 || row.team_b || '');
    const homeScore = numberOrNull(row.home_score || row.homescore || row.home_goals || row.homegoals);
    const awayScore = numberOrNull(row.away_score || row.awayscore || row.away_goals || row.awaygoals);
    const status = normalizeStatus(row.status || row.match_status || row.state, homeScore, awayScore);
    const utcDate = parseDateTime(row.datetime || row.date_time || row.kickoff || row.date || row.time || '');
    const homeRed = numberOrZero(row.home_red_cards || row.home_red || row.red_cards_home || row.home_rc);
    const awayRed = numberOrZero(row.away_red_cards || row.away_red || row.red_cards_away || row.away_rc);
    const homePens = numberOrNull(row.home_pens);
    const awayPens = numberOrNull(row.away_pens);

    return {
      matchId: numberOrNull(row.match_id),
      stage: row.stage || '',
      home,
      away,
      homeScore,
      awayScore,
      extraTime: numberOrZero(row.extra_time) === 1,
      pens: homePens !== null && awayPens !== null ? { home: homePens, away: awayPens } : null,
      status,
      utcDate,
      venue: row.venue || '',
      redCards: { [home]: homeRed, [away]: awayRed }
    };
  }).filter(match => match.home && match.away);
}

function shortVenue(venue) {
  return String(venue || '').replace(/\s*\(.+\)\s*$/, '');
}

function isKnockoutStage(stage) {
  return Boolean(stage) && stage !== 'Group stage';
}

// Returns 'home' | 'away' | null for a finished match, counting penalty shoot-outs
function matchWinner(match) {
  if (match.status !== 'FINISHED' || match.homeScore === null || match.awayScore === null) return null;
  if (match.homeScore > match.awayScore) return 'home';
  if (match.awayScore > match.homeScore) return 'away';
  if (match.pens) return match.pens.home > match.pens.away ? 'home' : 'away';
  return null;
}

// Teams that can no longer win the cup: lost a knockout tie, or — once every
// Round of 32 slot is resolved — never reached the knockouts at all. The
// third-place play-off is ignored: both its teams are already out.
function eliminatedTeamSet(matches) {
  const knockout = matches.filter(m => isKnockoutStage(m.stage) && m.stage !== 'Third-place match');
  const out = new Set();

  const reachedKnockout = new Set();
  for (const m of knockout) {
    if (!placeholderLabel(m.home)) reachedKnockout.add(m.home);
    if (!placeholderLabel(m.away)) reachedKnockout.add(m.away);
  }

  const r32 = matches.filter(m => m.stage === 'Round of 32');
  const groupsDone = r32.length >= 16 && r32.every(m => !placeholderLabel(m.home) && !placeholderLabel(m.away));
  if (groupsDone) {
    for (const team of state.teams) {
      if (!reachedKnockout.has(team.name)) out.add(team.name);
    }
  }

  for (const m of knockout) {
    const winner = matchWinner(m);
    if (winner === 'home') out.add(m.away);
    else if (winner === 'away') out.add(m.home);
  }

  return out;
}

function normalizeRedCards(rows) {
  const map = new Map();
  for (const row of rows) {
    const home = normalizeName(row.home || row.team1 || '');
    const away = normalizeName(row.away || row.team2 || '');
    if (!home || !away) continue;
    map.set(`${home}|${away}`, {
      homeRed: numberOrZero(row.home_red_cards || row.home_rc || 0),
      awayRed: numberOrZero(row.away_red_cards || row.away_rc || 0),
    });
  }
  return map;
}

function normalizeOdds(rows) {
  return Object.fromEntries(rows.map(row => {
    const country = normalizeName(row.country || row.team || row.nation || '');
    const probability = numberOrZero(row.probability || row.percent || row.win_probability || row.odds);
    return [country, probability];
  }).filter(([country]) => country));
}

function allTeams() {
  return state.teams;
}

function refreshLookups() {
  state.teamOwner = Object.fromEntries(state.teams.map(team => [team.name, team.participant]));
  state.teamCode = Object.fromEntries(state.teams.map(team => [team.name, team.code]));
}

async function loadData() {
  const errors = [];

  try {
    const teamRows = parseCsv(await fetchCsvOrFallback(CONFIG.teamsCsv, FALLBACK_CSV.teamsCsv));
    const built = buildParticipants(teamRows);
    state.participants = built.participants;
    state.teams = built.teams;
    refreshLookups();
  } catch (error) {
    errors.push(error.message);
  }

  try {
    state.matches = normalizeMatches(parseCsv(await fetchCsvOrFallback(CONFIG.matchesCsv, '')));
  } catch (error) {
    errors.push(error.message);
    state.matches = [];
  }

  try {
    const rcRows = parseCsv(await fetchCsvOrFallback(CONFIG.redCardsCsv, 'home,away,home_red_cards,away_red_cards\n'));
    const rcMap = normalizeRedCards(rcRows);
    state.matches = state.matches.map(m => {
      const rc = rcMap.get(`${m.home}|${m.away}`);
      if (!rc) return m;
      return { ...m, redCards: { [m.home]: rc.homeRed, [m.away]: rc.awayRed } };
    });
  } catch (error) {
    errors.push(error.message);
  }

  try {
    state.odds = normalizeOdds(parseCsv(await fetchCsvOrFallback(CONFIG.probabilitiesCsv, FALLBACK_CSV.probabilitiesCsv)));
  } catch (error) {
    errors.push(error.message);
    state.odds = {};
  }

  render(errors);
}

function compute(matches, odds) {
  const outTeams = eliminatedTeamSet(matches);
  const stats = Object.fromEntries(allTeams().map(team => [team.name, {
    ...team,
    points: 0,
    wins: 0,
    draws: 0,
    redCards: 0,
    probability: odds[team.name] || 0,
    played: 0,
    eliminated: outTeams.has(team.name)
  }]));

  for (const match of matches.filter(match => ['FINISHED', 'LIVE'].includes(match.status))) {
    const home = stats[match.home];
    const away = stats[match.away];
    if (!home || !away) continue;

    home.redCards += match.redCards[match.home] || 0;
    away.redCards += match.redCards[match.away] || 0;

    if (match.status !== 'FINISHED' || match.homeScore === null || match.awayScore === null) continue;

    home.played += 1;
    away.played += 1;

    if (match.homeScore > match.awayScore) {
      home.points += SCORING.win;
      home.wins += 1;
    } else if (match.awayScore > match.homeScore) {
      away.points += SCORING.win;
      away.wins += 1;
    } else {
      home.points += SCORING.draw;
      away.points += SCORING.draw;
      home.draws += 1;
      away.draws += 1;
    }

    if (isKnockoutStage(match.stage)) {
      const winnerSide = matchWinner(match);
      const winner = winnerSide === 'home' ? home : winnerSide === 'away' ? away : null;
      if (winner) {
        if (match.stage === 'Final') winner.points += SCORING.champion;
        else if (match.stage !== 'Third-place match') winner.points += SCORING.knockoutProgress;
      }
    }
  }

  const people = state.participants.map(person => {
    const teams = person.teams.map(team => stats[team.name]).filter(Boolean);
    return {
      participant: person.participant,
      teams,
      points: teams.reduce((sum, team) => sum + team.points, 0),
      redCards: teams.reduce((sum, team) => sum + team.redCards, 0),
      probability: teams.reduce((sum, team) => sum + team.probability, 0),
      knockedOut: teams.length > 0 && teams.every(team => team.eliminated)
    };
  }).sort((a, b) => b.points - a.points || a.redCards - b.redCards || b.probability - a.probability);

  return { stats: Object.values(stats).sort((a, b) => b.points - a.points || b.probability - a.probability), people };
}

function colleagueLine(teamName) {
  const owner = state.teamOwner[teamName];
  return owner ? `<span class="colleague">${owner}</span>` : '<span class="colleague">Unassigned/TBC</span>';
}

function parseMatchDate(value) {
  if (!value) return new Date(NaN);
  if (value instanceof Date) return value;
  const text = String(value).trim();
  const isoLike = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (isoLike) {
    const [, year, month, day, hour, minute] = isoLike;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  }
  return new Date(text);
}

function formatDateTime(value) {
  const d = parseMatchDate(value);
  if (Number.isNaN(d.getTime())) return 'Date TBC';
  const when = d.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const tz = Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'short' })
    .formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? 'BST';
  return `${when} ${tz}`;
}

function formatDateOnly(value) {
  const d = parseMatchDate(value);
  if (Number.isNaN(d.getTime())) return 'Date TBC';
  return d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });
}

// Openfootball uses "W83"/"L101" placeholders for undecided knockout slots
function placeholderLabel(teamName) {
  const m = String(teamName || '').match(/^([WL])(\d+)$/);
  if (!m) return null;
  return `${m[1] === 'W' ? 'Winner' : 'Loser'} of M${m[2]}`;
}

function teamBlock(teamName) {
  const placeholder = placeholderLabel(teamName);
  if (placeholder) {
    return `<span class="team-side"><span class="country tbd-country">TBC</span><span class="colleague">${escapeHtml(placeholder)}</span></span>`;
  }
  const code = state.teamCode[teamName] || '';
  const owner = state.teamOwner[teamName] || 'Unassigned/TBC';
  return `<span class="team-side"><span class="country">${escapeHtml(teamName)}</span>${flagMarkup(code, teamName)}<span class="colleague">${escapeHtml(owner)}</span></span>`;
}

function scoreNote(match) {
  if (match.pens) return `${match.pens.home}–${match.pens.away} pens`;
  if (match.extraTime) return 'after extra time';
  return '';
}

function renderMatch(match, upcoming = false) {
  const note = scoreNote(match);
  const scoreOrTime = upcoming
    ? `<span class="fixture-time"><span>Kick-off</span>${formatDateTime(match.utcDate)}</span>`
    : `<span class="score-wrap"><b class="score-number">${match.homeScore}-${match.awayScore}</b>${note ? `<span class="score-note">${escapeHtml(note)}</span>` : ''}</span>`;
  const statusLabel = match.status === 'LIVE' ? 'Ongoing' : match.status === 'FINISHED' ? 'Finished' : 'Scheduled';
  const stageLabel = isKnockoutStage(match.stage) ? ` · ${escapeHtml(match.stage)}` : '';
  const venueLabel = match.venue ? ` · 📍 ${escapeHtml(shortVenue(match.venue))}` : '';
  const homeReds = match.redCards?.[match.home] || 0;
  const awayReds = match.redCards?.[match.away] || 0;

  return `<article class="match ${upcoming ? 'upcoming-match' : 'result-match'} ${match.status === 'LIVE' ? 'live-match' : ''}">
    <div class="match-meta">${upcoming ? 'Upcoming fixture' : formatDateOnly(match.utcDate)}${stageLabel} · ${escapeHtml(statusLabel)}${venueLabel}</div>
    <div class="score">
      ${teamBlock(match.home)}
      ${scoreOrTime}
      ${teamBlock(match.away)}
    </div>
    ${upcoming ? '' : `<div class="match-meta red-card-line">Red cards: ${escapeHtml(match.home)} ${homeReds} · ${escapeHtml(match.away)} ${awayReds}</div>`}
  </article>`;
}

function renderDetailedLeaderboard(people) {
  if (!people.length) return '<p class="empty-state">No participants loaded</p>';

  return people.map((person, i) => {
    const rank = i + 1;
    const rankClass = rank === 1 ? 'lb-rank-gold' : rank === 2 ? 'lb-rank-silver' : rank === 3 ? 'lb-rank-bronze' : '';
    const totalWins = person.teams.reduce((s, t) => s + (t.wins || 0), 0);
    const totalDraws = person.teams.reduce((s, t) => s + (t.draws || 0), 0);
    const totalPlayed = person.teams.reduce((s, t) => s + (t.played || 0), 0);
    const totalLosses = Math.max(0, totalPlayed - totalWins - totalDraws);

    const teamRows = person.teams.map(team => {
      const losses = Math.max(0, (team.played || 0) - (team.wins || 0) - (team.draws || 0));
      return `<div class="lb-team-row${team.eliminated ? ' lb-row-out' : ''}">
        ${flagMarkup(team.code, team.name)}
        <span class="lb-team-name">${escapeHtml(team.name)}${team.eliminated ? '<span class="lb-mini-out">out</span>' : ''}</span>
        <span class="lb-stat"><span class="lb-stat-label">W</span>${team.wins || 0}</span>
        <span class="lb-stat"><span class="lb-stat-label">D</span>${team.draws || 0}</span>
        <span class="lb-stat"><span class="lb-stat-label">L</span>${losses}</span>
        <span class="lb-stat lb-stat-rc"><span class="lb-stat-label">RC</span>${team.redCards || 0}</span>
        <span class="lb-stat lb-stat-prob">${(team.probability || 0).toFixed(1)}%</span>
      </div>`;
    }).join('');

    return `<div class="lb-card">
      <div class="lb-header">
        <span class="lb-rank ${rankClass}">#${rank}</span>
        <span class="lb-name">${escapeHtml(person.participant)}${person.knockedOut ? '<span class="lb-out-tag">Knocked out</span>' : ''}</span>
        <span class="lb-points">${person.points}<span>pts</span></span>
      </div>
      ${teamRows}
      <div class="lb-totals-row">
        <span class="lb-total-label">Total</span>
        <span class="lb-stat"><span class="lb-stat-label">W</span>${totalWins}</span>
        <span class="lb-stat"><span class="lb-stat-label">D</span>${totalDraws}</span>
        <span class="lb-stat"><span class="lb-stat-label">L</span>${totalLosses}</span>
        <span class="lb-stat lb-stat-rc"><span class="lb-stat-label">RC</span>${person.redCards}</span>
        <span class="lb-stat lb-stat-prob">${person.probability.toFixed(1)}%</span>
      </div>
    </div>`;
  }).join('');
}

// Official FIFA 2026 bracket: which two matches feed each knockout tie.
// Verified against openfootball placeholders (e.g. M93 = W83 v W84) and
// resolved results (e.g. M89 Paraguay v France = winners of M74 and M77).
const KNOCKOUT_FEEDS = {
  89: [74, 77], 90: [73, 75], 91: [76, 78], 92: [79, 80],
  93: [83, 84], 94: [81, 82], 95: [86, 88], 96: [85, 87],
  97: [89, 90], 98: [93, 94], 99: [91, 92], 100: [95, 96],
  101: [97, 98], 102: [99, 100],
  104: [101, 102]
};
const THIRD_PLACE_MATCH = 103;
const FINAL_MATCH = 104;
const BRACKET_ROUND_TITLES = ['Round of 32', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'];

// Walk back from the final so every column lists matches in bracket order,
// with each pair of feeder matches adjacent to the tie they feed.
function bracketColumns() {
  const columns = [[FINAL_MATCH]];
  while (true) {
    const feeders = columns[0].flatMap(id => KNOCKOUT_FEEDS[id] || []);
    if (!feeders.length) break;
    columns.unshift(feeders);
  }
  return columns;
}

function bracketTeamRow(match, side) {
  const name = side === 'home' ? match.home : match.away;
  const score = side === 'home' ? match.homeScore : match.awayScore;
  const pens = match.pens ? (side === 'home' ? match.pens.home : match.pens.away) : null;
  const placeholder = placeholderLabel(name);
  const winner = matchWinner(match) === side;

  if (placeholder) {
    return `<div class="bk-team bk-tbd"><span class="bk-flag-slot"></span><span class="bk-copy"><span class="bk-name">${escapeHtml(placeholder)}</span></span><span class="bk-score"></span></div>`;
  }

  const owner = state.teamOwner[name];
  const scoreHtml = score === null ? '' : `${score}${pens !== null ? `<span class="bk-pens">(${pens})</span>` : ''}`;
  return `<div class="bk-team ${winner ? 'bk-winner' : ''}">
    ${flagMarkup(state.teamCode[name] || '', name)}
    <span class="bk-copy"><span class="bk-name">${escapeHtml(name)}</span>${owner ? `<span class="bk-owner">${escapeHtml(owner)}</span>` : ''}</span>
    <span class="bk-score">${scoreHtml}</span>
  </div>`;
}

function bracketMatchCard(match, matchId) {
  if (!match) {
    return `<article class="bk-match bk-empty"><div class="bk-meta"><span>M${matchId}</span><span>TBC</span></div></article>`;
  }
  const d = parseMatchDate(match.utcDate);
  const hasDate = !Number.isNaN(d.getTime());
  const dateLabel = hasDate ? d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' }) : 'Date TBC';
  const timeLabel = hasDate ? d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) : '';
  const kickoffLabel = timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel;
  const statusLabel = match.status === 'LIVE' ? 'LIVE' : match.status === 'FINISHED' ? (match.pens ? 'Pens' : match.extraTime ? 'AET' : 'FT') : kickoffLabel;
  const venueHtml = match.venue ? `<div class="bk-venue">📍 ${escapeHtml(shortVenue(match.venue))}</div>` : '';
  return `<article class="bk-match ${match.status === 'LIVE' ? 'bk-live' : ''}">
    <div class="bk-meta"><span>M${match.matchId ?? matchId}</span><span>${escapeHtml(statusLabel)}</span></div>
    ${bracketTeamRow(match, 'home')}
    ${bracketTeamRow(match, 'away')}
    ${venueHtml}
  </article>`;
}

function renderRaceSection(people) {
  if (!people.length) return '';
  const topScore = people[0].points;
  const stillIn = people.filter(person => !person.knockedOut || person.points === topScore);
  const out = people.filter(person => person.knockedOut && person.points < topScore);

  const row = person => `<div class="race-row">
    <span class="race-points">${person.points}<span>pts</span></span>
    <span class="race-name">${escapeHtml(person.participant)}${person.knockedOut ? '<span class="race-note">no teams left</span>' : ''}</span>
    <span class="race-teams">${person.teams.map(team => `<span class="${team.eliminated ? 'race-flag-out' : ''}">${flagMarkup(team.code, team.name)}</span>`).join('')}</span>
  </div>`;

  return `<section class="panel">
    <div class="section-title"><h2>Who can still win?</h2><p>Out completely = both teams eliminated and not top of the pot</p></div>
    <div class="race-grid">
      <div class="race-col"><div class="race-col-title"><span>Still in the running</span><span>${stillIn.length}</span></div>${stillIn.map(row).join('')}</div>
      <div class="race-col race-out"><div class="race-col-title"><span>Out completely</span><span>${out.length}</span></div>${out.map(row).join('') || '<div class="race-row race-empty">Nobody is out yet</div>'}</div>
    </div>
  </section>`;
}

function renderKnockout(people) {
  const byId = new Map(state.matches.filter(m => m.matchId !== null).map(m => [m.matchId, m]));
  const knockoutLoaded = [...byId.keys()].some(id => id >= 73);

  if (!knockoutLoaded) {
    return '<section class="panel"><div class="section-title"><h2>Knockout bracket</h2></div><p class="empty-state">Knockout fixtures are not available yet</p></section>';
  }

  const final = byId.get(FINAL_MATCH);
  const championSide = final ? matchWinner(final) : null;
  const championName = championSide ? (championSide === 'home' ? final.home : final.away) : null;
  const championBanner = championName
    ? `<div class="champion-banner">🏆 ${escapeHtml(championName)} are world champions${state.teamOwner[championName] ? ` — ${escapeHtml(state.teamOwner[championName])} takes the pot!` : ''}</div>`
    : '';

  const thirdPlace = byId.get(THIRD_PLACE_MATCH) || null;
  const thirdPlaceHtml = `<div class="bracket-third-inline">
      <span class="bracket-third-tag">3rd place</span>
      ${bracketMatchCard(thirdPlace, THIRD_PLACE_MATCH)}
    </div>`;

  const semiColumnIndex = BRACKET_ROUND_TITLES.indexOf('Semi-finals');
  const columns = bracketColumns().map((matchIds, index) => `
    <div class="bracket-round">
      <h3 class="bracket-round-title">${BRACKET_ROUND_TITLES[index] || ''}</h3>
      <div class="bracket-matches">${matchIds.map(id => bracketMatchCard(byId.get(id), id)).join('')}</div>
      ${index === semiColumnIndex ? thirdPlaceHtml : ''}
    </div>`).join('');

  return `<section class="panel">
    <div class="section-title"><h2>Knockout bracket</h2><p>Winners advance right — extra time and penalties included</p></div>
    ${championBanner}
    <div class="bracket-scroll"><div class="bracket">${columns}</div></div>
  </section>
  ${renderRaceSection(people)}`;
}

function setHtml(id, html) {
  const element = document.getElementById(id);
  if (element) element.innerHTML = html;
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function render(errors = []) {
  const { stats, people } = compute(state.matches, state.odds);
  const hasPeople = people.length > 0;

  setText('dataSource', errors.length ? `Check CSV files: ${errors.join(' | ')}` : '');
  setText('potLeader', hasPeople && people[0].points > 0 ? `${people[0].participant} leads` : 'No points yet');

  setHtml('leaderboard', hasPeople
    ? people.slice(0, 7).map(person => `<li><b>${person.participant}</b> · ${person.points} pts · ${person.teams.map(team => team.name).join(' / ')}</li>`).join('')
    : '<li>Add teams to teams.csv</li>');

  const reds = hasPeople ? [...people].sort((a, b) => b.redCards - a.redCards)[0] : null;
  const likely = hasPeople ? [...people].sort((a, b) => b.probability - a.probability)[0] : null;

  setHtml('redCards', reds ? `<div class="metric">${reds.redCards}</div><div class="sub">${reds.participant}</div><p>Discipline danger zone.</p>` : '<p>Add matches to matches.csv</p>');
  setHtml('mostLikely', likely ? `<div class="metric">${likely.probability.toFixed(1)}%</div><div class="sub">${likely.participant}</div><p>Combined outright probability.</p>` : '<p>Add probabilities to probabilities.csv</p>');

  setHtml('detailedLeaderboard', renderDetailedLeaderboard(people));
  setHtml('tab-knockout', renderKnockout(people));

  const results = state.matches
    .filter(match => ['FINISHED', 'LIVE'].includes(match.status) && match.homeScore !== null && match.awayScore !== null)
    .sort((a, b) => {
      if (a.status === 'LIVE' && b.status !== 'LIVE') return -1;
      if (b.status === 'LIVE' && a.status !== 'LIVE') return 1;
      return parseMatchDate(b.utcDate) - parseMatchDate(a.utcDate);
    })
    .slice(0, 6);
  const upcoming = state.matches
    .filter(match => match.status === 'SCHEDULED')
    .sort((a, b) => parseMatchDate(a.utcDate || '9999-12-31') - parseMatchDate(b.utcDate || '9999-12-31'))
    .slice(0, 3);

  setHtml('results', results.map(match => renderMatch(match)).join('') || '<p class="empty-state">No results yet</p>');
  setHtml('upcoming', upcoming.map(match => renderMatch(match, true)).join('') || '<p class="empty-state">Upcoming fixtures are not available yet</p>');
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

loadData();
setInterval(loadData, CONFIG.refreshMs);
