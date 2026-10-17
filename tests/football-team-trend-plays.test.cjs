const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const api = load(path.join(root, 'lib/footballTeamTrendPlays.ts'));
const trends = load(path.join(root, 'lib/footballTeamTrends.ts'));
const season = load(path.join(root, 'lib/footballTeamSeasonHistory.ts'));
const today = '2026-10-22', kickoff = Date.parse(`${today}T17:00:00Z`), now = kickoff - 15 * 60_000;
const market = { date: today, game: 'NYJ @ BUF', gameTime: new Date(kickoff).toISOString(), market: 'Total',
  selection: 'Over', side: 'Over', line: 44.5, snapshotStatus: 'FINAL_PREGAME', tier: 'Pass', betsPct: 50, moneyPct: 50 };
function history(results = ['W', 'W', 'W', 'L']) {
  return trends.buildTeamTrendHistory('NFL', [], results.flatMap((result, i) => ['Total', 'Spread'].map(type => ({
    Date: `2026-09-${String(i + 1).padStart(2, '0')}`, Game: 'NYJ @ BUF', 'Bet Type': type,
    Selection: type === 'Total' ? 'Over 40' : 'NYJ +3.5', Result: result,
  }))));
}
const state = (changes = {}) => api.buildTeamTrendTestState({ sport: 'NFL', today, markets: [market],
  history: history(), storedRows: [], scheduleRows: [], capture: false, now, ...changes });
const final = (a, h, extra = {}) => ({ Date: today, 'Away Team': 'New York Jets', 'Home Team': 'Buffalo Bills',
  'Away Score': String(a), 'Home Score': String(h), Completed: true, ...extra });
const plain = value => JSON.parse(JSON.stringify(value));

test('score alone qualifies at the inclusive threshold, regardless of public betting signals or odds', () => {
  const result = state();
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].selection, 'Over 44.5');
  assert.equal(result.picks[0].teamTrendScore.score, 75);
  assert.equal(result.picks[0].threshold, 75);
  assert.equal(result.picks[0].odds, '-110');
  assert.equal(result.records.length, 0);
  assert.equal(result.changedRows.length, 0);
  assert.equal(result.picks[0].teamTrendScore.mode, 'preview');
  const varied = state({ markets: [{ ...market, odds: '+900', betsPct: 99, moneyPct: 1, tier: 'Unqualified', catalogEvaluation: {} }] });
  assert.deepEqual(plain(varied.picks), plain(result.picks));
  assert.equal(state({ history: history(['W', 'W', 'L']) }).picks.length, 0);
});

test('real complete ECU/UAB records select Under independently of the public Over pick', () => {
  const fixture = require('./fixtures/football-team-season-2026.json');
  const timestamp = Date.parse('2026-10-15T11:00:00Z');
  const cached = fixture.games.map(g => season.parseEspnTeamSeasonGame(g.summary, 'NCAAF', g.schedule, timestamp));
  const schedule = fixture.games.map(g => g.schedule);
  const input = { sport: 'NCAAF', today: '2026-10-15', now: timestamp,
    markets: [{ ...market, date: '2026-10-15', game: 'East Carolina @ UAB', line: 47.5, gameTime: '2026-10-15T23:30:00Z' }],
    history: trends.buildTeamTrendHistory('NCAAF', [], [], schedule, cached) };
  const result = state(input);
  assert.equal(result.picks[0].selection, 'Under 47.5');
  assert.equal(result.picks[0].teamTrendScore.score.toFixed(1), '81.3');
  assert.equal(result.records.length, 0);
  const missing = state({ ...input, history: trends.buildTeamTrendHistory('NCAAF', [], [], schedule, cached.slice(1)) });
  assert.equal(missing.picks.length, 0);
  assert.equal(missing.status.awaitingHistory, 1);
});

test('spread and total qualify independently with at most one side per game and market', () => {
  const spread = { ...market, market: 'Spread', selection: 'NYJ +3.5', selectionTeam: 'NYJ', side: '', line: 3.5 };
  const result = state({ markets: [market, market, { ...market, side: 'Under' }, spread,
    { ...spread, selection: 'BUF -3.5', selectionTeam: 'BUF', line: -3.5 }] });
  assert.deepEqual(Array.from(result.picks, p => p.selection).sort(), ['NYJ +3.5', 'Over 44.5']);
  assert.equal(result.picks[0].teamTrendScore.score, 75);
});

test('only a pregame final snapshot in the capture window creates a tracked test play', () => {
  assert.equal(state({ capture: true, markets: [{ ...market, snapshotStatus: 'LIVE' }] }).records.length, 0);
  assert.equal(state({ capture: true, now: kickoff - 21 * 60_000 }).records.length, 0);
  assert.equal(state({ capture: true, now: kickoff }).records.length, 0);
  assert.equal(state({ capture: true, now: kickoff + 60_000 }).records.length, 0);
  const result = state({ capture: true });
  assert.equal(result.records.length, 1);
  assert.equal(result.changedRows.length, 1);
  assert.equal(result.records[0].savedAt, new Date(now).toISOString());
  assert.equal(result.records[0].teamTrendScore.mode, 'locked');
  assert.equal(result.status.record, '0-0-0');
  assert.equal(result.status.pending, 1);
  assert.equal(state({ capture: true, markets: [{ ...market, snapshotStatus: 'LIVE' }, market] }).records.length, 1);
});

test('ready team picks lock at 8 AM Eastern independently of the public snapshot', () => {
  const morning = Date.parse(`${today}T12:00:00Z`);
  const live = { ...market, snapshotStatus: 'LIVE' };
  const build = (overrides = {}) => state({ markets: [live], capture: true, earlyCapture: true, now: morning, ...overrides });
  assert.equal(build({ now: morning - 1 }).records.length, 0);
  assert.equal(build({ earlyCapture: false }).records.length, 0);
  assert.equal(build({ capture: false }).records.length, 0);
  assert.equal(build({ today: '2026-10-23', markets: [{ ...live, date: '2026-10-23', gameTime: '2026-10-23T17:00:00Z' }] }).records.length, 0);
  const saved = build();
  assert.equal(saved.records.length, 1);
  assert.equal(saved.records[0].snapshotStatus, 'FINAL_PREGAME');
  assert.equal(saved.records[0].capturePolicy, 'team-trend-ready-2026-10-17-v1');
  assert.equal(saved.records[0].savedAt, new Date(morning).toISOString());
  assert.equal(saved.records[0].teamTrendScore.capturedAt, saved.records[0].savedAt);
  const moved = build({ storedRows: saved.changedRows, markets: [{ ...live, line: 60 }],
    history: history(['L']), now: morning + 2 * 3600_000 });
  assert.equal(moved.changedRows.length, 0);
  assert.deepEqual(plain(moved.records[0]), plain(saved.records[0]));
  const graded = state({ markets: [], storedRows: saved.changedRows, scheduleRows: [final(20,25)], now: kickoff + 4 * 3600_000 });
  assert.equal(graded.records[0].result, 'W', 'grade the early 44.5 total, not a later 60');
  assert.equal(graded.records[0].selection, 'Over 44.5');
});

test('new qualifiers after the morning release lock without resaving previous picks', () => {
  const morning = Date.parse(`${today}T12:00:00Z`), live = { ...market, snapshotStatus: 'LIVE' };
  const initial = state({ markets: [live], capture: true, earlyCapture: true, now: morning, history: history(['W','L']) });
  assert.equal(initial.records.length, 0);
  const later = state({ markets: [live], capture: true, earlyCapture: true, now: morning + 3600_000 });
  assert.equal(later.records.length, 1);
  assert.equal(later.records[0].savedAt, new Date(morning + 3600_000).toISOString());
});

test('morning release follows Eastern daylight and standard time', () => {
  const posting = load(path.join(root, 'lib/teamTrendPosting.ts'));
  for (const [date, ready] of [['2026-10-22', '12:00:00Z'], ['2026-11-22', '13:00:00Z']]) {
    const clock = Date.parse(`${date}T${ready}`);
    assert.equal(posting.isTeamTrendPostingTime(date, clock - 1), false);
    assert.equal(posting.isTeamTrendPostingTime(date, clock), true);
    assert.equal(posting.isTeamTrendPostingTime('2026-10-23', clock), false);
  }
});

test('saved pregame picks retain the original side, line, score and evidence across feed changes', () => {
  const saved = state({ capture: true });
  const next = state({ capture: true, storedRows: saved.changedRows,
    markets: [{ ...market, line: 60 }], history: history(['L', 'L', 'L', 'W']), now: now + 60_000 });
  assert.equal(next.records.length, 1);
  assert.deepEqual(plain(next.records[0]), plain(saved.records[0]));
  assert.equal(next.picks[0].selection, 'Over 44.5');
  assert.equal(next.changedRows.length, 0);
  const unavailable = state({ storedRows: saved.changedRows, history: new Map(), markets: [], now: kickoff + 60_000 });
  assert.equal(unavailable.picks[0].teamTrendScore.score, 75);
  assert.equal(unavailable.records[0].result, '');
});

for (const [side, outcomes] of [['Over', [[20, 25, 'W'], [20, 23, 'L'], [20, 24, 'P']]],
  ['Under', [[20, 25, 'L'], [20, 23, 'W'], [20, 24, 'P']]]]) {
  test(`${side} grades against the captured total and applies -110 unit accounting`, () => {
    const initial = state({ capture: true, markets: [{ ...market, line: 44 }], history: history(side === 'Over' ? ['W'] : ['L']) });
    assert.equal(initial.records[0].side, side);
    for (const [a,h,expected] of outcomes) {
      const result = state({ markets: [], storedRows: initial.changedRows, scheduleRows: [final(a,h)], now: kickoff + 4 * 3600_000 });
      assert.equal(result.records[0].result, expected);
      assert.equal(result.status.units, expected === 'W' ? 0.91 : expected === 'L' ? -1 : 0);
      assert.equal(result.status.roiPct, expected === 'W' ? 90.9 : expected === 'L' ? -100 : 0);
      const repeated = state({ markets: [], storedRows: result.changedRows, scheduleRows: [final(a,h)], now: kickoff + 5 * 3600_000 });
      assert.equal(repeated.changedRows.length, 0);
    }
  });
}

test('spread grading handles either team, signed spreads, pushes and corrected finals', () => {
  const spread = { ...market, market: 'Spread', selection: 'NYJ +3', selectionTeam: 'NYJ', line: 3, side: '' };
  const away = state({ capture: true, markets: [spread], history: history(['W']) });
  assert.equal(away.records[0].selection, 'NYJ +3');
  const grade = (initial, a,h) => state({ markets: [], storedRows: initial.changedRows,
    scheduleRows: [final(a,h)], now: kickoff + 4 * 3600_000 });
  assert.equal(grade(away, 20,22).records[0].result, 'W');
  assert.equal(grade(away, 20,23).records[0].result, 'P');
  const loss = grade(away, 20,24);
  assert.equal(loss.records[0].result, 'L');
  assert.equal(grade(loss, 20,22).records[0].result, 'W');
  const home = state({ capture: true, markets: [spread], history: history(['L']) });
  assert.equal(home.records[0].selection, 'BUF -3');
  assert.equal(grade(home, 20,24).records[0].result, 'W');
});

test('unfinished, wrong-date and missing scores remain pending; no postgame picks are invented', () => {
  const saved = state({ capture: true });
  for (const scores of [[], [final(20,31,{ Completed: false })], [final(20,31,{ Completed: 'FALSE' })],
    [final(20,31,{ Date: '2026-10-21' })], [final(20,31,{ 'Home Score': '' })]]) {
    const result = state({ storedRows: saved.changedRows, scheduleRows: scores, now: kickoff + 4 * 3600_000, capture: true });
    assert.equal(result.records[0].result, '');
    assert.equal(result.changedRows.length, 0);
  }
  assert.equal(state({ capture: true, scheduleRows: [final(20,31)], now: kickoff + 4 * 3600_000 }).records.length, 0);
});

test('saved history survives date rollover and never accepts other strategy rows or late captures', () => {
  const saved = state({ capture: true });
  const invalid = plain(saved.changedRows[0]);
  const pick = JSON.parse(invalid['Details JSON']);
  pick.savedAt = new Date(kickoff + 1).toISOString();
  invalid['Details JSON'] = JSON.stringify(pick);
  const result = state({ today: '2026-10-23', markets: [], storedRows: [saved.changedRows[0], invalid,
    { 'Details JSON': JSON.stringify({ ...pick, strategyVersion: 'official-ezpz' }) }, { 'Details JSON': 'broken' }],
    scheduleRows: [final(20,31)], now: kickoff + 24 * 3600_000 });
  assert.equal(result.picks.length, 0);
  assert.equal(result.records.length, 1);
  assert.equal(result.status.record, '1-0-0');
});
