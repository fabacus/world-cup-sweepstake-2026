const SOURCES = [
  "https://worldcup26.ir/get/games",
  "https://wheniskickoff.com/data/v1/matches.json"
];

exports.handler = async function () {
  const errors = [];
  for (const url of SOURCES) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "Fabacus-WC-Sweepstake/1.0" } });
      if (!response.ok) {
        errors.push(`${url} returned ${response.status}`);
        continue;
      }
      const data = await response.json();
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=45",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(data)
      };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  return {
    statusCode: 502,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ error: "All World Cup data sources failed", details: errors })
  };
};
