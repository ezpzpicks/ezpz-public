const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const api = load(path.resolve(__dirname, '../lib/footballTeamTrends.ts'));
const now = Date.parse('2026-10-22T16:45:00Z');
const total = { date: '2026-10-22', game: 'NYJ @ BUF', gameTime: '2026-10-22T17:00:00Z',
  market: 'Total', selection: 'Over 44.5', line: 44.5, snapshotStatus: 'FINAL_PREGAME' };
const row = (date, game, selection, result, market = 'Total', extra = {}) => ({ Date: date, Game: game,
  'Bet Type': market, Selection: selection, Result: result, ...extra });
const totals = [
  row('2026-10-01', 'NE at BUF', 'Under 40', 'L'),
  row('2026-10-08', 'BUF @ MIA', 'Over 44', 'L'),
  row('2026-10-01', 'NYJ @ CHI', 'Over 40', 'W'),
  row('2026-10-08', 'ATL @ NYJ', 'Under 45', 'W'),
];

test('raw 50/30/20 total score uses venue and correct Over/Under direction', () => {
  const history = api.buildTeamTrendHistory('NFL', [], totals);
  const score = api.scoreFootballTeamTrends(total, 'NFL', history, now);
  assert.equal(score.score, 65);
  assert.deepEqual(Array.from(score.teams, t => t.score), [65, 65]);
  assert.equal(score.teams[1].records.betType.record, '1-1-0');
  assert.equal(score.teams[1].records.venue.record, '1-0-0');
  assert.equal(score.mode, 'locked');
  const under = api.scoreFootballTeamTrends({ ...total, selection: 'Under 44.5' }, 'NFL', history, now);
  assert.equal(under.score, 35);
});

test('a spread opponent shows actual ATS records but contributes failed covers', () => {
  const rows = [
    row('2026-10-01', 'NE @ BUF', 'BUF +3.5', 'W', 'Spread'),
    row('2026-10-08', 'BUF @ MIA', 'BUF -3.5', 'L', 'Spread'),
    row('2026-10-01', 'NYJ @ CHI', 'NYJ -3.5', 'W', 'Spread'),
    row('2026-10-08', 'ATL @ NYJ', 'NYJ -4.5', 'L', 'Spread'),
  ];
  const pick = { ...total, market: 'Spread', selection: 'BUF +3.5', line: 3.5 };
  const score = api.scoreFootballTeamTrends(pick, 'NFL', api.buildTeamTrendHistory('NFL', [], rows), now);
  assert.equal(score.score, 62.5);
  const [opponent, selected] = score.teams;
  assert.equal(opponent.records.venue.record, '1-0-0');
  assert.equal(opponent.records.venue.supportPct, 0);
  assert.equal(opponent.records.betType.label, 'Favorite ATS');
  assert.equal(selected.records.betType.label, 'Underdog ATS');
  assert.equal(selected.score, 90);
  assert.equal(opponent.score, 35);
});

test('one physical game counts once despite two sides, aliases and repeated trends', () => {
  const rows = [...totals, ...totals, row('2026-10-01', 'New England Patriots @ Buffalo Bills', 'Over 40', 'W')];
  const history = api.buildTeamTrendHistory('NFL', [], rows);
  const score = api.scoreFootballTeamTrends(total, 'NFL', history, now);
  assert.equal(history.size, 4);
  assert.equal(score.teams[1].records.betType.sample, 2);
  assert.equal(score.score, 65);
});

test('verified pregame quotes supersede model tracker prices without multiplying trends', () => {
  const verified = { Date: '2026-10-01', Game: 'NE @ BUF', Market: 'Total', Selection: 'Over',
    'Public Split Line': '44.5', Result: 'W', 'Actual Away Runs': '20', 'Actual Home Runs': '31',
    'Snapshot Status': 'FINAL_PREGAME', 'Record Snapshot Policy': 'verified-final-snapshot-v1',
    'Public Split Snapshot Time': '2026-10-01T16:45:00Z' };
  const tracker = totals.map((r,i) => i === 0 ? { ...r, Result: 'W' } : r);
  const history = api.buildTeamTrendHistory('NFL', [verified, verified, verified], tracker);
  const score = api.scoreFootballTeamTrends(total, 'NFL', history, now);
  assert.equal(score.score, 65);
  assert.equal(score.teams[1].records.betType.sample, 2);
});

test('official schedule corrects reversed model venues and rejects phantom matchups', () => {
  const tracker = [row('2026-10-01', 'BUF @ NE', 'Over 40', 'W'),
    row('2026-10-08', 'BUF @ MIA', 'Over 40', 'W')];
  const schedule = [{ Date: '2026-10-01', 'Away Team': 'NE', 'Home Team': 'BUF', 'Away Score': '20', 'Home Score': '31' }];
  const history = api.buildTeamTrendHistory('NFL', [], tracker, schedule);
  const score = api.scoreFootballTeamTrends(total, 'NFL', history, now);
  assert.equal(score.teams[1].records.venue.record, '1-0-0');
  assert.equal(score.teams[1].trackedGames, 1);
});

test('completed schedule scores grade a tracked quote even before its tracker result catches up', () => {
  const tracker = [row('2026-10-01', 'NE @ BUF', 'Over 40', 'Pending')];
  const schedule = [{ Date: '2026-10-01', 'Away Team': 'NE', 'Home Team': 'BUF', 'Away Score': '20', 'Home Score': '31' }];
  const score = api.scoreFootballTeamTrends(total, 'NFL', api.buildTeamTrendHistory('NFL', [], tracker, schedule), now);
  assert.equal(score.teams[1].records.betType.record, '1-0-0');
});

test('verified markets override a tracker-only reversed home/away identity', () => {
  const verified = { Date: '2026-10-01', Game: 'NE @ BUF', Market: 'Total', Selection: 'Over',
    'Public Split Line': '44.5', Result: 'W', 'Snapshot Status': 'FINAL_PREGAME',
    'Record Snapshot Policy': 'verified-final-snapshot-v1', 'Public Split Snapshot Time': '2026-10-01T16:45:00Z' };
  const h = api.buildTeamTrendHistory('NFL', [verified], [row('2026-10-01', 'BUF @ NE', 'Over 40', 'W')]);
  const score = api.scoreFootballTeamTrends(total, 'NFL', h, now);
  assert.equal(score.teams[1].records.venue.record, '1-0-0');
});

test('pushes do not enter the hit-rate denominator or become opponent wins', () => {
  const rows = [...totals, row('2026-10-10', 'NYJ @ BAL', 'Over 40', 'P')];
  const score = api.scoreFootballTeamTrends(total, 'NFL', api.buildTeamTrendHistory('NFL', [], rows), now);
  assert.equal(score.teams[0].records.betType.record, '1-1-1');
  assert.equal(score.teams[0].records.betType.winPct, 50);
  assert.equal(score.score, 65);
});

test('current, future, previous-season and ungraded games cannot leak into records', () => {
  const rows = [...totals,
    row('2026-10-22', 'NYJ @ BUF', 'Over 44.5', 'W'),
    row('2026-10-29', 'NYJ @ BUF', 'Over 44.5', 'W'),
    row('2025-10-08', 'NYJ @ BUF', 'Over 44.5', 'W'),
    row('2026-10-15', 'NYJ @ BUF', 'Over 44.5', 'Pending'),
  ];
  const score = api.scoreFootballTeamTrends(total, 'NFL', api.buildTeamTrendHistory('NFL', [], rows), now);
  assert.equal(score.score, 65);
  assert.ok(score.teams.every(t => t.trackedGames === 2));
});

test('recent form takes only the last five distinct graded games', () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(`2026-09-${String(i+1).padStart(2, '0')}`, 'NYJ @ BUF', 'Over 44.5', i < 2 ? 'W' : 'L'));
  const score = api.scoreFootballTeamTrends(total, 'NFL', api.buildTeamTrendHistory('NFL', [], rows), now);
  assert.equal(score.teams[0].records.betType.record, '2-5-0');
  assert.equal(score.teams[0].records.recent.record, '0-5-0');
});

test('unknown categories are neutral; a team with no history does not get a fabricated grade', () => {
  const empty = api.scoreFootballTeamTrends(total, 'NFL', new Map(), now);
  assert.equal(empty.score, null);
  assert.equal(empty.teams[0].records.betType.winPct, null);
  assert.equal(empty.teams[0].records.betType.supportPct, 50);
  const one = api.scoreFootballTeamTrends(total, 'NFL', api.buildTeamTrendHistory('NFL', [], [totals[0]]), now);
  assert.equal(one.score, null);
  assert.equal(one.teams[0].hasData, false);
});

test('explicit neutral venues do not enter a home/away record', () => {
  const rows = totals.map((r, i) => i === 0 ? { ...r, 'Neutral Site': 'TRUE' } : r);
  const score = api.scoreFootballTeamTrends(total, 'NFL', api.buildTeamTrendHistory('NFL', [], rows), now);
  assert.equal(score.teams[1].records.venue.sample, 0);
  assert.equal(score.teams[1].records.venue.supportPct, 50);
});

test('a saved final score retains its records and weight version after data changes', () => {
  const history = api.buildTeamTrendHistory('NFL', [], totals);
  const first = api.withFootballTeamTrends(total, 'NFL', history, undefined, now);
  const stored = JSON.parse(JSON.stringify(first));
  stored.teamTrendScore.version = 'team-trends-prior-weight-version';
  const reread = api.withFootballTeamTrends(total, 'NFL', new Map(), stored, now + 3600000);
  assert.equal(reread.teamTrendScore.score, 65);
  assert.equal(reread.teamTrendScore.version, 'team-trends-prior-weight-version');
  assert.equal(reread.teamTrendScore.mode, 'locked');
});

test('late historical reconstruction is explicitly a replay; props are excluded', () => {
  const history = api.buildTeamTrendHistory('NFL', [], totals);
  assert.equal(api.scoreFootballTeamTrends(total, 'NFL', history, now + 3600000).mode, 'replay');
  assert.equal(api.scoreFootballTeamTrends({ ...total, market: 'Player Prop', playerName: 'Someone' }, 'NFL', history, now), null);
});

test('college aliases match without collapsing similarly named schools', () => {
  const rows = [row('2026-10-01', 'Western Kentucky @ Sam Houston', 'Over 40', 'W'),
    row('2026-10-02', 'Ohio State @ Sam Houston', 'Over 40', 'L')];
  const pick = { ...total, game: 'WKU @ SHSU' };
  const score = api.scoreFootballTeamTrends(pick, 'NCAAF', api.buildTeamTrendHistory('NCAAF', [], rows), now);
  assert.equal(score.teams[0].trackedGames, 1);
  assert.equal(score.teams[1].trackedGames, 2);
  const ohio = api.scoreFootballTeamTrends({ ...total, game: 'Ohio @ SHSU' }, 'NCAAF', api.buildTeamTrendHistory('NCAAF', [], rows), now);
  assert.equal(ohio.teams[0].hasData, false);
});
