const GAS_URL = 'https://script.google.com/macros/s/AKfycbzChLjhRfYfmnIjOUpobdsJBp8aALTco6RPZjjHgtVylE1ARXw3vPHZCPAx-cGUpTrOhw/exec';

/**
 * スコアを送信する (POST)
 */
async function postScore(gameName, playerName, playerScore) {
    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            // GAS側のCORS制限を回避するため、'application/json' ではなく 'text/plain' を指定
            headers: {
                'Content-Type': 'text/plain',
            },
            body: JSON.stringify({ 
                game: gameName,
                name: playerName, 
                score: playerScore 
            })
        });

        const result = await response.json();
        console.log('送信結果:', result);
        return result;
    } catch (error) {
        console.error('通信エラー (POST):', error);
    }
}

/**
 * スコアランキングを取得する (GET)
 */
async function fetchScores(gameName) {
    try {
        const response = await fetch(`${GAS_URL}?game=${encodeURIComponent(gameName)}`);
        const scores = await response.json();
        
        console.log('ランキングデータ:', scores);
        return scores;
    } catch (error) {
        console.error('通信エラー (GET):', error);
    }
}