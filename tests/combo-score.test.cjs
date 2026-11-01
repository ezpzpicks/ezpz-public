const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const scores = load(path.join(root, 'lib/comboScore.ts'));
const picks = load(path.join(root, 'lib/signalPicks.ts'));
const mcp = load(path.join(root, 'lib/ezpzMcpPicks.ts'));
const research = load(path.join(root, 'lib/signalCombinationResearch.ts'));
const capture = load(path.join(root, 'lib/footballSignals.ts'));
const date = '2026-11-01', previous = '2026-10-31', policy = capture.FOOTBALL_SIGNALS_VERSION;
const now = Date.parse(date + 'T17:45:00Z');
const plain = value => JSON.parse(JSON.stringify(value));
const cell = (market, sideGroup, combination, wins, losses) => ({ market, sideGroup, combination, phase: 'forward',
  stats: { wins, losses, pushes: 0, pending: 0, netUnits: 0, assumedPrices: 0, unknownPrices: 0 } });
function days(extra = []) {
  return { [previous]: { version: research.SIGNAL_RESEARCH_VERSION, policyVersion: policy, date: previous,
    cells: [cell('Spread', 'Favorite', '', 14, 6), cell('Spread', 'Underdog', 'move', 4, 6), ...extra] } };
}
function quartet(overrides = {}) {
  const base = { date, gameKey: date + '|alpha|beta', game: 'Alpha @ Beta', awayTeam: 'Alpha', homeTeam: 'Beta',
    gameTime: date + 'T18:00:00.000Z', snapshotAt: date + 'T17:45:00.000Z', status: 'FINAL_PREGAME', recorded: false,
    odds: '-110', candidate: false, selected: false, mixed: false, result: '', resultUpdated: '', sourceCount: 0,
    signals: ['money','move','system','team','model','sos'].map(key => ({ key, available: true, active: false, value: null, reason: '', level: 'Inactive' })),
    combination: '', policyVersion: policy, signalCount: 0,
    teamTrend: null, teamGames: [], publicMatches: [], marketContext: {}, modelContext: {}, sosContext: {}, ...overrides };
  return [
    { ...base, id: 'favorite', market: 'Spread', side: 'alpha', selection: 'Alpha -3.5', line: -3.5 },
    { ...base, id: 'underdog', market: 'Spread', side: 'beta', selection: 'Beta +3.5', line: 3.5,
      signals: base.signals.map(s => ({ ...s, active: s.key === 'move' })), signalCount: 1, combination: 'move' },
    { ...base, id: 'over', market: 'Total', side: 'Over', selection: 'Over 45.5', line: 45.5 },
    { ...base, id: 'under', market: 'Total', side: 'Under', selection: 'Under 45.5', line: 45.5 },
  ];
}
function frozen(history = days(), overrides = {}) {
  return scores.attachComboScores(quartet(overrides), 'NCAAF', history, policy, now).map(s => ({ ...s, recorded: true }));
}

test('combo-only score reproduces neutral, the 3-10 opponent example and the trial 70 score', () => {
  assert.equal(scores.comboScoreValue({ wins: 0, losses: 0 }, { wins: 0, losses: 0 }).score, 50);
  assert(Math.abs(scores.comboScoreValue({ wins: 0, losses: 0 }, { wins: 3, losses: 10 }).score - 65.90909090909) < 1e-9);
  assert.equal(scores.comboScoreValue({ wins: 14, losses: 6 }, { wins: 4, losses: 6 }).score, 70);
  assert.equal(scores.comboPickPolicy('NCAAF', previous), null);
  assert.equal(scores.comboPickPolicy('NCAAF', date).threshold, 65);
  assert.equal(scores.comboPickPolicy('NFL', date), null);
  assert.equal(scores.comboPickPolicy('NBA', date), null);
});

test('NCAAF selects a zero-signal side by frozen score and compares both markets once', () => {
  const sides = frozen(), original = JSON.stringify(sides);
  const result = picks.selectSignalEzpzPicks(sides, 'NCAAF', now);
  assert.equal(result.length, 1); assert.equal(result[0].selection, 'Alpha -3.5');
  assert.equal(result[0].signalCount, 0); assert.equal(result[0].comboScore.score, 70);
  assert.equal(JSON.stringify(sides), original);
  assert.equal(picks.selectSignalEzpzPicks(sides.slice(0, 2), 'NCAAF', now).length, 0);
  assert.equal(picks.selectSignalEzpzPicks(sides.map((s, i) => i === 3 ? { ...s, recorded: false } : s), 'NCAAF', now).length, 0);
  const strongerTotal = frozen(days([cell('Total', 'Over', '', 20, 0)]));
  assert.equal(picks.selectSignalEzpzPicks(strongerTotal, 'NCAAF', now)[0].market, 'Total');
  const tie = frozen(days([cell('Total', 'Over', '', 14, 6), cell('Total', 'Under', '', 4, 6)]));
  for (const sidesWithResults of [tie, tie.map(s => ({ ...s, result: s.market === 'Total' ? 'W' : 'L' }))]) {
    assert.equal(picks.selectSignalEzpzPicks(sidesWithResults, 'NCAAF', now)[0].market, 'Spread');
  }
});

test('same-day and future records cannot affect a score and recorded inputs never change later', () => {
  const original = frozen();
  const polluted = { ...days(), [date]: { ...days()[previous], date,
    cells: [cell('Spread', 'Favorite', '', 0, 999)] }, '2026-11-02': { ...days()[previous], date: '2026-11-02',
      cells: [cell('Spread', 'Favorite', '', 0, 999)] } };
  assert.deepEqual(plain(frozen(polluted)), plain(original));
  const changed = days(); changed[previous].cells[0].stats.wins = 0; changed[previous].cells[0].stats.losses = 100;
  assert.deepEqual(plain(scores.attachComboScores(original, 'NCAAF', changed, policy, now + 60_000)), plain(original));
});

test('a corrected kickoff rejects the one-hour-early quote; stale previews and incomplete pairs stay unavailable', () => {
  const early = quartet({ scheduledGameTime: date + 'T19:00:00.000Z' });
  assert(scores.attachComboScores(early, 'NCAAF', days(), policy, now).every(s => !s.comboScore));
  assert(scores.attachComboScores(quartet().slice(0, 1), 'NCAAF', days(), policy, now).every(s => !s.comboScore));
  const live = quartet({ status: 'LIVE' });
  assert(scores.attachComboScores(live, 'NCAAF', days(), policy, now, false).every(s => !s.comboScore));
  assert(scores.attachComboScores(live, 'NCAAF', days(), policy, now).every(s => s.comboScore?.mode === 'preview'));
});

test('threshold comparison uses unrounded scores and validates all persisted scoring inputs', () => {
  const exact = days(); exact[previous].cells = [cell('Spread', 'Favorite', '', 10, 10), cell('Spread', 'Underdog', 'move', 0, 5)];
  const atThreshold = frozen(exact);
  assert.equal(picks.selectSignalEzpzPicks(atThreshold, 'NCAAF', now).length, 1);
  exact[previous].cells[0] = cell('Spread', 'Favorite', '', 9999, 10001);
  const below = frozen(exact);
  assert.equal(below[0].comboScore.score.toFixed(1), '65.0');
  assert.equal(picks.selectSignalEzpzPicks(below, 'NCAAF', now).length, 0);
  const original = frozen()[0];
  for (const change of [{ score: 99 }, { sport: 'NFL' }, { own: null }, { opponent: null },
    { historyDates: [date] }, { historyAsOf: date + 'T18:01:00Z' },
    { opponent: { ...original.comboScore.opponent, snapshotAt: 'invalid' } }]) {
    assert.equal(scores.validComboScore({ ...original, comboScore: { ...original.comboScore, ...change } }, 'NCAAF'), false);
  }
});

test('MCP and saved feeds retain score, threshold, exact line and stable integration identity', () => {
  const side = picks.selectSignalEzpzPicks(frozen(), 'NCAAF', now)[0];
  const feed = picks.signalPickForFeed(side, 'NCAAF');
  assert(picks.isSignalFeedPick(feed, 'NCAAF', now));
  const output = mcp.normalizeMcpPick('NCAAF', feed, now);
  assert.equal(output.score, 70); assert.equal(output.threshold, 65); assert.equal(output.scoreThreshold, 65);
  assert.equal(output.selectionMethod, 'combo_score'); assert.equal(output.pickLabel, 'EZPZ Signal Pick');
  assert.equal(output.signalCount, 0); assert.equal(output.pickCategory, 'signals');
  assert.equal(output.line, -3.5); assert.equal(output.eligibleForPosting, true);
  assert.equal(mcp.normalizeMcpPick('NCAAF', { ...feed, score: 99 }, now), null);
  assert.equal(mcp.normalizeMcpPick('NCAAF', feed, Date.parse(side.gameTime)).eligibleForPosting, false);
  for (const sport of ['NFL', 'NBA']) {
    assert.equal(picks.selectSignalEzpzPicks(frozen(), sport, now).length, 0, 'calibration cannot promote zero-signal official picks');
  }
});

test('collector saves the score inputs before the pick feed and replays only the saved score on settlement', () => {
  const time = date + 'T18:00:00.000Z';
  const trendPlays = [
    { market: 'Spread', selection: 'Alpha', selectionTeam: 'Alpha', line: -3.5, openingLine: -3.5 },
    { market: 'Spread', selection: 'Beta', selectionTeam: 'Beta', line: 3.5, openingLine: 4 },
    { market: 'Total', selection: 'Over', side: 'Over', line: 45.5, openingLine: 45.5 },
    { market: 'Total', selection: 'Under', side: 'Under', line: 45.5, openingLine: 45.5 },
  ].map(s => ({ ...s, date, game: 'Alpha @ Beta', gameTime: time, awayTeam: 'Alpha', homeTeam: 'Beta',
    odds: '-110', openingOdds: '-110', betsPct: 50, moneyPct: 50, snapshotStatus: 'FINAL_PREGAME',
    frozenAt: date + 'T17:45:00.000Z', updatedAt: date + 'T17:45:00.000Z' }));
  const input = { sport: 'NCAAF', now, capture: true, storedRows: [], history: new Map(), leaderboard: [], researchDays: days(),
    core: { today: date, trendPlays, slateToday: [], trendRecordRows: [] } };
  const first = capture.buildFootballSignalsState(input);
  assert.equal(first.changedRows.length, 4);
  assert(first.changedRows.every(row => JSON.parse(row['Details JSON']).comboScore));
  const selected = picks.selectSignalEzpzPicks(first.board.sides, 'NCAAF', now);
  assert.equal(selected.length, 1); assert.equal(selected[0].selection, 'Alpha -3.5');
  const scoreBefore = JSON.stringify(selected[0].comboScore);
  const corrected = capture.buildFootballSignalsState({ ...input, capture: false, storedRows: first.changedRows,
    core: { ...input.core, teamTrendScheduleRows: [{ Date: date, 'Away Team': 'Alpha', 'Home Team': 'Beta',
      'Game Time': date + 'T19:00:00.000Z' }] } });
  assert.equal(corrected.board.summary.pending, 0, 'a corrected clock applies to summary and displayed selection equally');
  assert(corrected.board.sides.every(s => !s.selected));
  assert.equal(corrected.changedRows.length, 0, 'schedule corrections cannot rewrite frozen inputs');
  const later = capture.buildFootballSignalsState({ ...input, now: now + 4 * 3600_000, capture: false, storedRows: first.changedRows,
    researchDays: {}, core: { ...input.core, trendPlays: [], teamTrendScheduleRows: [{ Date: date,
      'Away Team': 'Alpha', 'Home Team': 'Beta', 'Game Time': time, Completed: 'TRUE',
      'Away Score': '30', 'Home Score': '20', 'Result Updated': new Date(now + 3 * 3600_000).toISOString() }] } });
  const winner = later.board.sides.find(s => s.selection === 'Alpha -3.5');
  assert.equal(winner.result, 'W'); assert.equal(JSON.stringify(winner.comboScore), scoreBefore);
  assert.equal(later.board.summary.record, '1-0-0');
});
