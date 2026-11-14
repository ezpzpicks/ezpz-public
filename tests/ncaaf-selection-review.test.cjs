const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const review = load(path.join(__dirname, '../lib/ncaafSelectionReview.ts'));
const factors = load(path.join(__dirname, '../lib/ncaafMatchupFactors.ts'));
const prices = load(path.join(__dirname, '../lib/modelSignalQuote.ts'));
const fixture = require('./fixtures/ncaaf_selection_review.json').cases;
const pick = name => fixture.find(c => c.name === name);

test('NCAAF spread preferences match Python at 21 changed quotes', () => {
  let checked = 0;
  for (const c of fixture) for (const q of c.quotes) {
    assert.deepEqual(Array.from(review.ncaafSpreadReviewReasons(c.spread.z, c.spread.side, q.line,
      c.spread.selection_review_policy)), q.blocked_reasons, `${c.name} ${q.line}`);
    checked++;
  }
  assert.equal(checked, 21);
  assert.equal(review.ncaafTotalReviewReasons(pick('pitt').total.z, 'Over', pick('pitt').total.selection_review_policy).length, 1);
});

test('Houston cap and Illinois Under remain subject to direction, source and publication clocks', () => {
  const c = pick('houston'), clock = Date.parse(c.spread.kickoff) - 900000;
  assert.equal(factors.ncaafMatchupQuoteReview(c.row, 'Spread', -11.5, 'houston', clock).valid, true);
  const blocked = factors.ncaafMatchupQuoteReview(c.row, 'Spread', -11.5001, 'houston', clock);
  assert.equal(blocked.valid, false); assert.match(blocked.reason, /ceiling/);
  assert.equal(factors.ncaafMatchupQuoteReview(c.row, 'Spread', -8.5, 'colorado', clock).valid, false);
  assert.equal(factors.ncaafMatchupQuoteReview(c.row, 'Spread', -8.5, 'houston', Date.parse(c.spread.as_of) - 1).valid, false);
  assert.equal(factors.ncaafMatchupQuoteReview(c.row, 'Spread', -8.5, 'houston', Date.parse(c.spread.kickoff)).valid, false);
  const u = pick('ucla'), asOf = Date.parse(u.total.kickoff) - 900000;
  assert.equal(factors.ncaafMatchupQuoteReview(u.row, 'Total', 47.5, 'Under', asOf).valid, true);
  assert.equal(factors.ncaafMatchupQuoteReview(u.row, 'Total', 40, 'Under', asOf).valid, false);
  const bad = { ...c.spread }; delete bad.selection_review_policy;
  assert.equal(factors.ncaafMatchupQuoteReview({ ...c.row, 'Matchup Spread JSON': JSON.stringify(bad) }, 'Spread', -8.5, 'houston', clock).valid, false);
});

test('SP+ repricing keeps factor grades instead of restoring the former point-edge ladder', () => {
  const c = pick('houston');
  const q = { sport: 'NCAAF', market: 'Spread', side: 'houston', version: c.row['Model Version'],
    policy: c.spread.policy_version, savedLine: -8.5, line: -8.5, savedEdge: c.spread.edge,
    savedGrade: 'B Spread', probability: .60, odds: '-110', matchupValidation: { valid: true, reason: 'Qualified' } };
  assert.equal(prices.regradeModelQuote(q).grade, 'B Spread');
  assert.equal(prices.regradeModelQuote(q).active, true);
  assert.equal(prices.regradeModelQuote({ ...q, line: 0 }).grade, 'B Spread');
  assert.equal(prices.regradeModelQuote({ ...q, matchupValidation: undefined }).active, false);
  assert.equal(prices.regradeModelQuote({ ...q, line: -11.6, odds: '+150', matchupValidation: { valid: false, reason: 'Ceiling' } }).active, false);
  assert.equal(prices.regradeModelQuote({ ...q, savedGrade: 'No Play' }), null);
});

test('historical v1 captured factors remain readable and separate from v2 records', () => {
  const row = { ...pick('houston').row, 'Grading Policy Version': 'ncaaf-sp-matchup-2026-11-13-v1' };
  for (const key of ['Matchup Spread JSON', 'Matchup Total JSON']) {
    const g = JSON.parse(row[key]); g.policy_version = row['Grading Policy Version'];
    delete g.selection_review_policy; delete g.selection_review; row[key] = JSON.stringify(g);
  }
  assert.ok(factors.ncaafMatchupContext(row));
  assert.equal(factors.ncaafMatchupRecordSummary([{...row,Grade:'B Spread',Result:'Win','Bet Type':'Spread'}], '2026-11-13').overall.totalBets, 0);
});

test('the football signals flow cannot bypass the Houston ceiling at a favorable price', () => {
  const signals = load(path.join(__dirname, '../lib/footballSignals.ts'));
  const c = pick('houston'), r = c.row, now = Date.parse(c.spread.kickoff) - 900000;
  function board(line, odds) {
    const base = { date: r.Date, game: 'Houston @ Colorado', gameTime: c.spread.kickoff,
      awayTeam: r['Away Team'], homeTeam: r['Home Team'], market: 'Spread', odds,
      snapshotStatus: 'LIVE', updatedAt: new Date(now).toISOString(), betsPct: 50, moneyPct: 50,
      openingBetsPct: 50, openingMoneyPct: 50, openingOdds: odds, movementHistory: [] };
    return signals.buildFootballSignalsState({ sport: 'NCAAF', now, capture: false, storedRows: [],
      history: new Map(), leaderboard: [], core: { today: r.Date, slateToday: [r], trendRecordRows: [],
        trendPlays: [{ ...base, selection: 'Houston', selectionTeam: 'Houston', side: 'Houston', line, openingLine: line },
          { ...base, selection: 'Colorado', selectionTeam: 'Colorado', side: 'Colorado', line: -line, openingLine: -line }],
        bestPlays: [{ game: 'Houston @ Colorado', gameTime: c.spread.kickoff, awayTeam: 'Houston', homeTeam: 'Colorado',
          role: 'Spread', play: 'Houston -8.5', playType: 'B Spread', selectedProbability: '.60',
          oddsLine: '-110', modelVersion: r['Model Version'] }] } }).board;
  }
  const original = board(-8.5, '-110').sides.find(s => s.side === 'houston');
  assert.equal(original.signals.find(s => s.key === 'model').active, true);
  const changed = board(-11.6, '+150').sides.find(s => s.side === 'houston');
  assert.equal(changed.signals.find(s => s.key === 'model').active, false);
  assert.match(changed.modelContext.reason, /ceiling/);
});
