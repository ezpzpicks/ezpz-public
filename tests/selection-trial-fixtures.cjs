const path = require('node:path');
const api = require('./load-typescript.cjs')(path.resolve(__dirname, '../lib/selectionTrial.ts'));
const signalKeys = ['money', 'move', 'system', 'team', 'model', 'sos'];
function game(date, index = 0, changes = {}) {
  const start = api.trialDayStart(date) + 18 * 3600000 + index * 1000;
  const marketPair = (market, names) => names.map((name, i) => ({
    id: `${date}|game-${index}|${market}|${name}`, date, gameKey: `${date}|game-${index}`, game: `Away ${index} @ Home ${index}`,
    gameTime: new Date(start).toISOString(), market, side: name,
    selection: market === 'Total' ? `${name} 220.5` : `${name} ${i ? '+3.5' : '-3.5'}`,
    line: market === 'Total' ? 220.5 : i ? 3.5 : -3.5, odds: '-110', oddsAssumed: true,
    status: 'FINAL_PREGAME', recorded: true, snapshotAt: new Date(start - 15 * 60000).toISOString(),
    policyVersion: 'nba-signals-nba-grouped-test-v1',
    signals: signalKeys.map(key => ({ key, available: true, active: !i && ['money', 'model', 'system'].includes(key),
      value: key === 'money' ? (i ? -35 : 35) : key === 'model' ? (i ? -8 : 8) : null })),
    result: '', resultUpdated: '', ...changes,
  }));
  return [...marketPair('Spread', ['Home', 'Away']), ...marketPair('Total', ['Over', 'Under'])];
}
function history(days = 12, perDay = 12) {
  const all = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.parse('2026-10-20T12:00:00Z') + d * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < perDay; i++) {
      const sides = game(date, i);
      sides.forEach((side, j) => { side.result = (j % 2 === 0) === (i % 8 !== 0) ? 'W' : 'L';
        side.resultUpdated = new Date(Date.parse(side.gameTime) + 3 * 3600000).toISOString(); });
      all.push(...sides);
    }
  }
  return all;
}
const plain = value => JSON.parse(JSON.stringify(value));
module.exports = { api, game, history, plain };
