// The reported Kentucky/Tennessee records, expressed as distinct prior games.
module.exports = function neutralOpponentFixture(sport = 'NCAAF') {
  const names = sport === 'NFL' ? ['NYJ', 'BUF', 'NE', 'MIA']
    : sport === 'NBA' ? ['DAL', 'BOS', 'ORL', 'TOR'] : ['Kentucky', 'Tennessee', 'Vanderbilt', 'Florida'];
  const [selected, opponent, firstRival, secondRival] = names;
  const selectedGames = [
    ['Home', 3, 'W'], ['Home', 3, 'L'], ['Home', 3, 'W'], ['Away', 3, 'W'],
    ['Home', 3, 'W'], ['Away', -3, 'W'], ['Home', -3, 'W'], ['Away', -3, 'W'],
  ];
  const opponentGames = [
    ['Home', -3, 'W'], ['Away', -3, 'L'], ['Away', -3, 'L'], ['Home', -3, 'L'],
    ['Away', -3, 'W'], ['Home', 3, 'W'], ['Home', 3, 'L'], ['Home', 3, 'W'],
  ];
  const prior = (team, rival, games) => games.map(([venue, line, result], i) => ({
    Date: `2026-10-${String(i + 1).padStart(2, '0')}`, Game: venue === 'Home' ? `${rival} @ ${team}` : `${team} @ ${rival}`,
    'Bet Type': 'Spread', Selection: `${team} ${line > 0 ? '+' : ''}${line}`, Result: result,
    'Result Updated': `2026-10-${String(i + 1).padStart(2, '0')}T20:00:00Z`,
  }));
  const pick = { date: '2026-11-07', game: `${selected} @ ${opponent}`, awayTeam: selected, homeTeam: opponent,
    gameTime: '2026-11-08T00:00:00Z', market: 'Spread', selection: `${selected} +6`, selectionTeam: selected,
    line: 6, odds: '-110', snapshotStatus: 'LIVE' };
  return { pick, names, rows: [...prior(selected, firstRival, selectedGames), ...prior(opponent, secondRival, opponentGames)] };
};
