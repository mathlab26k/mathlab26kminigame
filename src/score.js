const GAS_URL = 'https://script.google.com/macros/s/AKfycbzChLjhRfYfmnIjOUpobdsJBp8aALTco6RPZjjHgtVylE1ARXw3vPHZCPAx-cGUpTrOhw/exec';

async function postScore(
  gameName,
  playerName,
  playerScore,
  options = {}
) {
  const payload = {
    game: gameName,
    name: playerName,
    score: playerScore
  };

  if (options.mode !== undefined) {
    payload.mode = options.mode;
  }

  if (options.limit !== undefined) {
    payload.limit = options.limit;
  }

  const response = await fetch(GAS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('スコア送信に失敗しました。HTTP ' + response.status);
  }

  const result = await response.json();

  if (!result || result.status !== 'success') {
    throw new Error(result?.message || 'スコアを保存できませんでした');
  }

  return result;
}

async function fetchScores(gameName, options = {}) {
  const params = new URLSearchParams({
    game: gameName
  });

  if (options.mode !== undefined) {
    params.set('mode', options.mode);
  }

  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }

  const response = await fetch(GAS_URL + '?' + params.toString());

  if (!response.ok) {
    throw new Error('ランキング取得に失敗しました。HTTP ' + response.status);
  }

  const result = await response.json();

  if (!Array.isArray(result)) {
    throw new Error(result?.message || 'ランキングを取得できませんでした');
  }

  return result;
}