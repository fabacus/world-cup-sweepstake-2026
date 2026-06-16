function toDirectDownloadUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';

  // OneDrive sharing links usually work as direct CSV downloads when download=1 is present.
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('download')) parsed.searchParams.set('download', '1');
    return parsed.toString();
  } catch (_error) {
    return url;
  }
}

exports.handler = async function () {
  const sourceUrl = toDirectDownloadUrl(process.env.ONEDRIVE_SCORES_CSV_URL);

  if (!sourceUrl) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: 'ONEDRIVE_SCORES_CSV_URL is not set. Falling back to local scores.csv.'
    };
  }

  try {
    const response = await fetch(sourceUrl, { headers: { 'User-Agent': 'Fabacus-WC-Sweepstake/1.0' } });
    if (!response.ok) throw new Error(`OneDrive returned ${response.status}`);
    const csv = await response.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: csv
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: `Could not load OneDrive scores CSV: ${error.message}`
    };
  }
};
