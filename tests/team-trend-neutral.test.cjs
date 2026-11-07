const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const trends = load(path.resolve(__dirname, '../lib/footballTeamTrends.ts'));
const policy = load(path.resolve(__dirname, '../lib/teamTrendScorePolicy.ts'));
const signals = load(path.resolve(__dirname, '../lib/footballSignals.ts'));
const fixture = require('./fixtures/team-trend-neutral.cjs');
const effective = Date.parse(policy.SPREAD_TEAM_TREND_EFFECTIVE_AT);
const now = effective + 60000;

for (const sport of ['NCAAF', 'NFL', 'NBA', 'NCAAM']) {
  test(`${sport}: strong team against an even opponent qualifies without dilution`, () => {
    const { pick, names, rows } = fixture(sport);
    const history = trends.buildTeamTrendHistory(sport, [], rows);
    const before = trends.scoreFootballTeamTrends(pick, sport, history, effective - 1);
    assert.equal(before.score, 70);
    const score = trends.scoreFootballTeamTrends(pick, sport, history, now);
    assert.deepEqual(Array.from(score.teams, team => team.score), [90, 50]);
    assert.deepEqual(Object.values(score.teams[0].records).map(record => record.record), ['4-1-0', '3-0-0', '5-0-0']);
    assert.deepEqual(Object.values(score.teams[1].records).map(record => record.record), ['2-3-0', '3-2-0', '3-2-0']);
    assert.equal(score.score, 90);
    assert.equal(score.version, policy.SPREAD_TEAM_TREND_VERSION);
    const reverse = trends.scoreFootballTeamTrends({ ...pick, selection: `${names[1]} -6`, selectionTeam: names[1], line: -6 }, sport, history, now);
    assert.equal(reverse.score, 10);
    const board = signals.buildFootballSignalsState({ sport, now, history, leaderboard: [], storedRows: [],
      core: { today: pick.date, trendPlays: [pick], trendRecordRows: [], bestPlays: [], slateToday: [] } }).board;
    const signal = board.sides[0].signals.find(signal => signal.key === 'team');
    assert.equal(signal.value, 90);
    assert.equal(signal.active, true);
    assert.match(signal.reason, /even opponent is neutral/);
  });
}

test('conflicting opponent evidence lowers the grade and aligned evidence stays bounded', () => {
  const { pick, rows } = fixture();
  const allOpponentWins = rows.map((row, i) => i >= 8 ? { ...row, Result: 'W' } : row);
  const conflict = trends.scoreFootballTeamTrends(pick, 'NCAAF', trends.buildTeamTrendHistory('NCAAF', [], allOpponentWins), now);
  assert.equal(conflict.score, 40);
  const allOpponentLosses = rows.map((row, i) => i >= 8 ? { ...row, Result: 'L' } : row);
  const aligned = trends.scoreFootballTeamTrends(pick, 'NCAAF', trends.buildTeamTrendHistory('NCAAF', [], allOpponentLosses), now);
  assert.equal(aligned.score, 100);
  const reverse = trends.scoreFootballTeamTrends({ ...pick, selection: 'Tennessee -6', selectionTeam: 'Tennessee', line: -6 },
    'NCAAF', trends.buildTeamTrendHistory('NCAAF', [], allOpponentLosses), now);
  assert.equal(reverse.score, 0);
});

test('missing markets and incomplete history cannot gain a qualifying score', () => {
  const { pick, rows } = fixture();
  const history = trends.buildTeamTrendHistory('NCAAF', [], rows);
  const noLine = trends.scoreFootballTeamTrends({ ...pick, selection: 'Kentucky', line: null }, 'NCAAF', history, now, { allowMissingSpreadLine: true });
  assert.equal(noLine.score, null);
  history.values().next().value.spread = undefined;
  assert.equal(trends.scoreFootballTeamTrends(pick, 'NCAAF', history, now).score, null);
});

test('total grades keep averaging and stored pre-change signals retain their original vote', () => {
  const { pick, rows } = fixture();
  const history = trends.buildTeamTrendHistory('NCAAF', [], rows);
  const totalRows = rows.map(row => ({ ...row, 'Bet Type': 'Total', Selection: 'Over 44', Result: 'W' }));
  const total = { ...pick, market: 'Total', selection: 'Over 44', line: 44 };
  const totalHistory = trends.buildTeamTrendHistory('NCAAF', [], totalRows);
  assert.equal(trends.scoreFootballTeamTrends(total, 'NCAAF', totalHistory, now).aggregation, 'Mean team support');
  assert.equal(trends.scoreFootballTeamTrends(total, 'NCAAF', totalHistory, now).score,
    trends.scoreFootballTeamTrends(total, 'NCAAF', totalHistory, effective - 1).score);
  const gameTime = new Date(effective + 10 * 60000).toISOString();
  const oldPick = { ...pick, gameTime, snapshotStatus: 'FINAL_PREGAME', frozenAt: new Date(effective - 5 * 60000).toISOString() };
  const oldOpponent = { ...oldPick, selection: 'Tennessee -6', selectionTeam: 'Tennessee', line: -6 };
  const input = { sport: 'NCAAF', now: effective - 5 * 60000, capture: true, history, leaderboard: [], storedRows: [],
    core: { today: pick.date, trendPlays: [oldPick, oldOpponent], trendRecordRows: [], bestPlays: [], slateToday: [] } };
  const saved = signals.buildFootballSignalsState(input);
  assert.equal(saved.changedRows.length, 2);
  const original = saved.board.sides[0];
  assert.equal(original.teamTrend.score, 70);
  assert.equal(original.signals.find(signal => signal.key === 'team').active, false);
  const reread = signals.buildFootballSignalsState({ ...input, now, storedRows: saved.changedRows });
  assert.equal(reread.board.sides[0].teamTrend.score, 70);
  assert.equal(reread.board.sides[0].signals.find(signal => signal.key === 'team').active, false);
  assert.equal(reread.changedRows.length, 0);
});
