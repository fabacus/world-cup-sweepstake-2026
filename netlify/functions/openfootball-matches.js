const OPENFOOTBALL_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

function mapStage(round) {
  if (!round) return 'Group stage';
  const r = round.toLowerCase();
  if (r.includes('matchday')) return 'Group stage';
  if (r.includes('round of 32')) return 'Round of 32';
  if (r.includes('round of 16')) return 'Round of 16';
  if (r.includes('quarter')) return 'Quarter-final';
  if (r.includes('semi')) return 'Semi-final';
  if (r.includes('third')) return 'Third-place match';
  if (r === 'final') return 'Final';
  return round;
}

function mapGroup(group) {
  return group ? group.replace(/^Group\s+/i, '') : '';
}

function toUtcDatetime(date, time) {
  if (!date) return '';
  if (!time) return `${date} 00:00`;
  const m = time.match(/^(\d{1,2}):(\d{2})\s*UTC([+-]\d+(?:\.\d+)?)$/);
  if (!m) return `${date} 00:00`;
  const localMinutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const offset = parseFloat(m[3]);
  const utcMinTotal = localMinutes - offset * 60;
  let utcH = Math.floor(utcMinTotal / 60);
  const utcM = ((utcMinTotal % 60) + 60) % 60;
  let d = new Date(date + 'T00:00:00Z');
  if (utcH >= 24) { d = new Date(d.getTime() + 86400000); utcH -= 24; }
  else if (utcH < 0) { d = new Date(d.getTime() - 86400000); utcH += 24; }
  const utcDate = d.toISOString().slice(0, 10);
  return `${utcDate} ${String(utcH).padStart(2, '0')}:${String(utcM).padStart(2, '0')}`;
}

function csvCell(v) {
  const s = String(v ?? '');
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
}

function scorePair(score, key) {
  return (score && Array.isArray(score[key]) && score[key].length === 2) ? score[key] : null;
}

function matchesToCsv(matches) {
  const headers = 'match_id,stage,group,datetime,status,home,away,home_score,away_score,extra_time,home_pens,away_pens,home_red_cards,away_red_cards,venue';
  const rows = [headers];

  matches.forEach((match, i) => {
    const ft = scorePair(match.score, 'ft');
    const et = scorePair(match.score, 'et');
    const pens = scorePair(match.score, 'p');
    // Knockout ties are decided after extra time, so report the ET score as final
    const finalScore = et || ft;
    rows.push([
      match.num || i + 1,
      csvCell(mapStage(match.round)),
      csvCell(mapGroup(match.group)),
      csvCell(toUtcDatetime(match.date, match.time)),
      finalScore ? 'finished' : 'scheduled',
      csvCell(match.team1 || ''),
      csvCell(match.team2 || ''),
      finalScore ? finalScore[0] : '',
      finalScore ? finalScore[1] : '',
      et ? 1 : 0,
      pens ? pens[0] : '',
      pens ? pens[1] : '',
      0,
      0,
      csvCell(match.ground || '')
    ].join(','));
  });

  return rows.join('\n');
}

exports.handler = async function () {
  try {
    const response = await fetch(OPENFOOTBALL_URL, { headers: { 'User-Agent': 'world-cup-sweepstake' } });
    if (!response.ok) throw new Error(`openfootball returned ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.matches)) throw new Error('unexpected response format');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*'
      },
      body: matchesToCsv(data.matches)
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
      body: `# openfootball fetch failed: ${err.message}`
    };
  }
};
