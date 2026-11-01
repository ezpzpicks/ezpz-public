const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const analysis = load(path.resolve(__dirname, '../lib/ncaamAnalysisCore.ts'));

const date = '2026-11-01', tipoff = Date.parse('2026-11-02T04:59:00Z');
const now = tipoff - 15 * 60000, iso = value => new Date(value).toISOString();
const game = { Date: date, 'Game ID': '401920409', 'Game Key': `${date}|ncaam|401920409`,
  'Game Time': iso(tipoff), 'Away Team': 'Liberty Flames', 'Home Team': 'High Point Panthers', Status: 'STATUS_SCHEDULED' };
const forecast = { gameId: game['Game ID'], away_team: game['Away Team'], home_team: game['Home Team'],
  tipoff: iso(tipoff), lockedAt: iso(now - 3600000), modelVersion: 'ncaam-v0.3-prior-rotation-2026-11-01',
  spread_grade: 'Research', total_grade: 'Research', fair_home_spread: -8, total: 151,
  market: { home_spread: -7.5, total: 155.5, source: 'ESPN', as_of: iso(now - 3601000), odds: -110,
    source_url: 'https://www.espn.com/mens-college-basketball/game/_/gameId/401920409' } };
const input = changes => ({ date, games: [game], splits: [], forecasts: [forecast], storedRows: [],
  state: analysis.emptyNcaamAnalysis(date), now, capture: true, ...changes });
const plain = value => JSON.parse(JSON.stringify(value));

test('Liberty–High Point displays the newest saved ESPN spreads, total and assumed prices without split coverage', () => {
  const older = { ...forecast, lockedAt: iso(now - 7200000), market: { ...forecast.market, as_of: iso(now - 7201000), home_spread: -6.5 } };
  for (const forecasts of [[forecast, older], [older, forecast]]) {
    const request = input({ forecasts }), original = JSON.stringify(request);
    for (const clock of [now, tipoff + 3600000]) {
      const result = analysis.buildNcaamSignals({ ...request, now: clock });
      const spreads = result.board.sides.filter(side => side.market === 'Spread');
      assert.deepEqual(plain(spreads.map(side => [side.selection, side.line]).sort()), [
        ['High Point Panthers -7.5', -7.5], ['Liberty Flames +7.5', 7.5],
      ]);
      assert(result.board.sides.filter(side => side.market === 'Total').every(side => side.line === 155.5));
      assert.equal(result.board.sides.length, 4);
      for (const side of result.board.sides) {
        assert.equal(side.odds, '-110'); assert.equal(side.oddsAssumed, true);
        assert.deepEqual(plain(side.lineSource), { name: 'ESPN', capturedAt: forecast.market.as_of, url: forecast.market.source_url });
        assert.equal(side.status, 'UNAVAILABLE');
        assert(!side.recorded && !side.selected && !side.candidate && !side.comboScore);
        for (const key of ['money', 'move', 'system']) assert.equal(side.signals.find(signal => signal.key === key).available, false);
        assert.equal(side.marketContext.bets, null); assert.equal(side.marketContext.money, null);
        assert.equal(side.marketContext.history.length, 0);
      }
      assert.equal(result.changedRows.length, 0);
      assert.equal(result.plays.length, 0, 'display fallbacks never become public betting split rows');
    }
    assert.equal(JSON.stringify(request), original);
  }
});

test('Covers and saved ScoresAndOdds forecasts also display, including pick’em and an independently available market', () => {
  for (const source of ['Covers', 'ScoresAndOdds']) {
    const result = analysis.buildNcaamSignals(input({ forecasts: [{ ...forecast, market: { ...forecast.market, source, home_spread: 0, total: null } }] }));
    const spreads = result.board.sides.filter(side => side.market === 'Spread');
    assert(spreads.every(side => side.line === 0 && side.lineSource.name === source));
    assert(result.board.sides.filter(side => side.market === 'Total').every(side => side.line === null && side.odds === ''));
  }
});

test('a real feed market and frozen observations take priority while a missing total uses the saved quote', () => {
  const spreadRows = ['Liberty Flames', 'High Point Panthers'].map((selection, index) => ({ ...game,
    Market: 'Spread', Selection: selection, Line: index ? '-8.5' : '8.5', Odds: '-110', Source: 'ScoresAndOdds',
    'Updated At': iso(now), 'Frozen At': iso(now), 'Snapshot Status': 'FINAL_PREGAME',
    'Current Bets %': index ? '60' : '40', 'Current Handle %': index ? '40' : '60',
    'Opening Line': index ? '-8.5' : '8.5', 'Opening Bets %': index ? '60' : '40', 'Opening Handle %': index ? '40' : '60' }));
  const result = analysis.buildNcaamSignals(input({ splits: spreadRows }));
  const spreads = result.board.sides.filter(side => side.market === 'Spread');
  assert(spreads.every(side => Math.abs(side.line) === 8.5 && !side.lineSource && !side.recorded));
  assert(result.board.sides.filter(side => side.market === 'Total').every(side => side.line === 155.5 && side.lineSource.name === 'ESPN'));
  assert.equal(result.changedRows.length, 0, 'an incomplete feed still cannot acquire a final capture');
  const totalRows = ['Over', 'Under'].map(selection => ({ ...spreadRows[0], Market: 'Total', Selection: selection,
    Line: '154.5', 'Opening Line': '154.5', 'Current Bets %': '50', 'Current Handle %': '50', 'Opening Bets %': '50', 'Opening Handle %': '50' }));
  const captured = analysis.buildNcaamSignals(input({ splits: [...spreadRows, ...totalRows] }));
  assert.equal(captured.changedRows.length, 4);
  const replay = analysis.buildNcaamSignals(input({ storedRows: captured.changedRows, now: tipoff + 1 }));
  assert(replay.board.sides.filter(side => side.market === 'Spread').every(side => Math.abs(side.line) === 8.5 && !side.lineSource));
  assert(replay.board.sides.filter(side => side.market === 'Total').every(side => side.line === 154.5 && !side.lineSource));
});

test('future, postgame, mismatched and unsupported quotes leave the line pending', () => {
  const invalid = [
    { gameId: 'different-game' }, { away_team: 'Other Team' }, { home_team: 'Other Team' },
    { tipoff: iso(tipoff + 60000) }, { lockedAt: '' }, { lockedAt: iso(now + 1) },
    { lockedAt: iso(tipoff + 1) }, { modelVersion: '' },
    { market: { ...forecast.market, as_of: '' } },
    { market: { ...forecast.market, as_of: iso(now) } },
    { market: { ...forecast.market, source: 'Unknown' } },
    { market: { ...forecast.market, home_spread: '', total: 0 } },
  ];
  for (const changes of invalid) {
    const result = analysis.buildNcaamSignals(input({ forecasts: [{ ...forecast, ...changes }] }));
    assert(result.board.sides.every(side => side.line === null && side.odds === ''), JSON.stringify(changes));
    assert.equal(result.changedRows.length, 0);
  }
});
