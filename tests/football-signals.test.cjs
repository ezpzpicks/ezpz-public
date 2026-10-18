const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const api = load(path.join(root, 'lib/footballSignals.ts'));
const trends = load(path.join(root, 'lib/footballTeamTrends.ts'));
const catalog = load(path.join(root, 'lib/footballTrendCatalog.ts'));
const sos = load(path.join(root, 'lib/footballSos.ts'));
const wilson = load(path.join(root, 'lib/ncaafEzpzWilson.ts'));
const date = '2026-10-22', kickoff = Date.parse(date + 'T23:20:00Z'), lock = kickoff - 15 * 60000;
const iso = n => new Date(n).toISOString();
const plain = value => JSON.parse(JSON.stringify(value));
function membership(sport = 'NFL') {
  return { version: catalog.footballCatalog(sport).version, memberships: [
    { pair: 'sharp-current-total', direction: 0, filters: [] },
    { pair: 'gap-atleast-10-total', direction: 0, filters: [] },
  ], missing: [], ambiguous: [] };
}
function markets(sport = 'NFL', names = ['DAL', 'GB']) {
  const base = { date, game: names.join(' @ '), gameTime: iso(kickoff), awayTeam: names[0], homeTeam: names[1], market: 'Total',
    line: 44.5, odds: '-110', openingLine: 44, openingOdds: '-110', openingBetsPct: 30, openingMoneyPct: 40,
    lineMovementBasis: 'Total Line', snapshotStatus: 'LIVE', updatedAt: iso(lock),
    catalogEvaluation: membership(sport), movementHistory: [] };
  return [{ ...base, selection: 'Over', side: 'Over', betsPct: 20, moneyPct: 50,
    lineMovementValue: .5, lineMovementSignal: 'Line Movement Confirmation' },
    { ...base, selection: 'Under', side: 'Under', betsPct: 80, moneyPct: 50,
      lineMovementValue: -.5, lineMovementSignal: 'Adverse Line Movement',
      catalogEvaluation: { ...membership(sport), memberships: [] } }];
}
function teamHistory(sport = 'NFL', names = ['DAL', 'GB'], over = true) {
  const rows = Array.from({ length: 6 }, (_, i) => names.map((team, idx) => ({ Date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    'Away Team': idx ? 'DET' : team, 'Home Team': idx ? team : 'NYG', Completed: 'TRUE',
    'Away Score': String(over ? 35 : 10), 'Home Score': String(over ? 28 : 7), 'Home Spread': '-3.5', Total: '44.5' }))).flat();
  return trends.buildTeamTrendHistory(sport, [], [], rows);
}
function leaderboard(sport = 'NFL') {
  return catalog.catalogSignals(membership(sport), sport).map((signal, i) => ({
    id: signal + '|over', signal, category: 'Over', label: 'System ' + i,
    wilsonScore: wilson.ncaafWilsonLowerBound(8, 2) * 100,
    totals: { record: '8-2-0', wins: 8, losses: 2, pushes: 0, totalBets: 10, winPct: 80,
      unitsWon: 8 / 1.1 - 2, netUnits: 8 / 1.1 - 2, roiPct: (8 / 1.1 - 2) / 10 * 100 },
    lastSevenTotals: { record: '6-1-0', totalBets: 7 },
  }));
}
function input(changes = {}) {
  return { sport: 'NFL', now: lock, capture: false, storedRows: [], history: teamHistory(), leaderboard: leaderboard(),
    core: { today: date, trendPlays: markets(), trendRecordRows: [], bestPlays: [], slateToday: [] }, ...changes };
}
const state = changes => api.buildFootballSignalsState(input(changes));
const find = (board, key, side = 'Over') => board.sides.find(s => s.side === side).signals.find(s => s.key === key);

test('multiple matching Wilson systems count as exactly one public signal and preserve the current half-point classification', () => {
  const { board } = state();
  const over = board.sides.find(s => s.side === 'Over');
  assert.equal(over.publicMatches.length, 2);
  assert.equal(over.signals.filter(s => s.key === 'system' && s.active).length, 1);
  assert.equal(over.signalCount, 4);
  assert.equal(over.sourceCount, 2);
  assert.equal(over.selected, true);
  assert.equal(find(board, 'move').active, true);
  assert.equal(find(board, 'model').active, false);
  assert.equal(find(board, 'model').available, false);
  assert.equal(over.publicMatches[0].lastSevenTotals.record, '6-1-0');
});

test('money support boundaries, neutral missing data, and unchanged market classification', () => {
  for (const [gap, active, level] of [[14.9, false, 'Inactive'], [15, true, 'Qualifying'], [25, true, 'Strong'], [35, true, 'Very strong']]) {
    const x = input(); x.core.trendPlays[0].moneyPct = 20 + gap;
    const s = find(api.buildFootballSignalsState(x).board, 'money');
    assert.equal(s.active, active); assert.equal(s.level, level);
  }
  const x = input(); x.core.trendPlays[0].moneyPct = null;
  assert.equal(find(api.buildFootballSignalsState(x).board, 'money').available, false);
  x.core.trendPlays[0].lineMovementSignal = 'Adverse Line Movement';
  assert.equal(find(api.buildFootballSignalsState(x).board, 'move').active, false);
});

test('three market badges alone fail the two-source rule; missing team history never supplies a vote', () => {
  const { board } = state({ history: new Map() });
  const over = board.sides.find(s => s.side === 'Over');
  assert.equal(over.signalCount, 3); assert.equal(over.sourceCount, 1); assert.equal(over.candidate, false);
  assert.equal(find(board, 'team').available, false);
});

test('ranks outside the twentieth boundary and prices beyond the existing cap do not earn a public signal', () => {
  const x = input(); x.leaderboard = Array.from({ length: 20 }, (_, i) => ({ ...leaderboard()[0], signal: 'unmatched-' + i }));
  x.leaderboard.push(...leaderboard());
  assert.equal(find(api.buildFootballSignalsState(x).board, 'system').active, false);
  const y = input(); y.core.trendPlays[0].odds = '-151';
  const side = api.buildFootballSignalsState(y).board.sides.find(s => s.side === 'Over');
  assert.equal(side.signals.find(s => s.key === 'system').active, false); assert.equal(side.selected, false);
});

test('CFB SOS uses opponent rank minus selected rank; totals are context only, and future/stale rankings are unavailable', () => {
  const names = ['Atlas', 'Bayview'];
  const snapshot = { season: 2026, fetchedAt: iso(lock - 60000), sourceUrl: 'https://www.warrennolan.com/fbs/2026/sos-elo',
    teams: names.map((team, i) => ({ team, key: trends.footballTeamKey(team, 'NCAAF'), rank: i ? 85 : 9, elo: 1500 - i, opponentRecord: '20-10', opponentWinPct: .66 })) };
  const x = input({ sport: 'NCAAF', history: teamHistory('NCAAF', names), leaderboard: leaderboard('NCAAF'), sos: snapshot });
  x.core.trendPlays = markets('NCAAF', names);
  let result = api.buildFootballSignalsState(x).board;
  assert.equal(find(result, 'sos').value, 76); assert.equal(find(result, 'sos').active, false);
  x.core.trendPlays = x.core.trendPlays.map((p, i) => ({ ...p, market: 'Spread', side: '', selection: names[i], selectionTeam: names[i], line: i ? 3.5 : -3.5 }));
  result = api.buildFootballSignalsState(x).board;
  const a = result.sides.find(s => s.side === trends.footballTeamKey('Atlas', 'NCAAF')).signals.find(s => s.key === 'sos');
  assert.equal(a.value, 76); assert.equal(a.active, true); assert.equal(a.level, 'Very strong');
  snapshot.fetchedAt = iso(lock + 1);
  assert.equal(api.buildFootballSignalsState(x).board.sides[0].signals.find(s => s.key === 'sos').available, false);
  snapshot.fetchedAt = iso(lock - 25 * 3600000);
  assert.equal(api.buildFootballSignalsState(x).board.sides[0].signals.find(s => s.key === 'sos').available, false);
  assert(!state().board.sides[0].signals.some(s => s.key === 'sos'));
});

test('only paired, valid pregame snapshots are saved; the original evidence is immutable and settles at the saved line', () => {
  const x = input({ capture: true });
  assert.equal(api.buildFootballSignalsState(x).changedRows.length, 0);
  x.core.trendPlays = x.core.trendPlays.map(p => ({ ...p, snapshotStatus: 'FINAL_PREGAME', frozenAt: iso(lock) }));
  const captured = api.buildFootballSignalsState(x);
  assert.equal(captured.changedRows.length, 2);
  assert(captured.board.sides.every(s => s.recorded));
  const original = captured.changedRows[0]['Details JSON'];
  x.storedRows = captured.changedRows;
  x.now = kickoff + 3600000;
  x.core.trendPlays = x.core.trendPlays.map(p => ({ ...p, line: 60, betsPct: 100, moneyPct: 0 }));
  x.core.teamTrendScheduleRows = [{ Date: date, 'Away Team': 'Dallas Cowboys', 'Home Team': 'Green Bay Packers',
    'Away Score': '27', 'Home Score': '24', Completed: 'TRUE', 'Result Updated': iso(x.now) }];
  const graded = api.buildFootballSignalsState(x);
  assert.equal(graded.board.summary.record, '1-0-0');
  assert.equal(graded.board.sides.find(s => s.side === 'Over').line, 44.5);
  assert.equal(graded.board.sides.find(s => s.side === 'Over').signalCount, 4);
  assert.equal(x.storedRows[0]['Details JSON'], original);
  x.storedRows = graded.changedRows;
  assert.equal(api.buildFootballSignalsState(x).changedRows.length, 0);
  const bad = input({ capture: true });
  bad.core.trendPlays = bad.core.trendPlays.map(p => ({ ...p, snapshotStatus: 'FINAL_PREGAME', frozenAt: iso(lock - 6 * 60000) }));
  assert.equal(api.buildFootballSignalsState(bad).changedRows.length, 0);
});

test('stale feeds, incomplete pairs, started captures, and prelaunch quotes cannot manufacture test observations', () => {
  for (const kind of ['stale', 'pair', 'started', 'launch']) {
    const x = input({ capture: true });
    x.core.trendPlays = x.core.trendPlays.map(p => ({ ...p, snapshotStatus: 'FINAL_PREGAME', frozenAt: iso(lock) }));
    if (kind === 'stale') x.core.draftKings = { stale: true };
    if (kind === 'pair') x.core.trendPlays = x.core.trendPlays.slice(0, 1);
    if (kind === 'started') x.now = kickoff;
    if (kind === 'launch') x.core.trendPlays = x.core.trendPlays.map(p => ({ ...p, frozenAt: '2026-10-18T16:45:00Z', gameTime: '2026-10-18T17:00:00Z' }));
    assert.equal(api.buildFootballSignalsState(x).changedRows.length, 0, kind);
  }
});

test('Warren Nolan parser reads actual table columns and refuses partial or unrelated pages', () => {
  const rows = Array.from({ length: 136 }, (_, i) => `<tr><td><a href="team-clubhouse?team=Team-${i}">Team ${i}</a></td><td>${1600-i}</td><td>${i+1}</td><td>20-10</td><td>0.6667</td></tr>`).join('');
  const html = '<table><tr><th>Team</th><th>ELO SOS</th><th>Rank</th><th>Opp Record</th><th>Opp Win Percent</th></tr>' + rows + '</table>';
  const parsed = sos.parseWarrenNolanSos(html, 2026, iso(lock));
  assert.equal(parsed.teams.length, 136); assert.equal(parsed.teams[8].rank, 9); assert.equal(parsed.teams[8].elo, 1592);
  assert.throws(() => sos.parseWarrenNolanSos('<table><tr>Access denied</tr></table>', 2026, iso(lock)));
  assert.throws(() => sos.parseWarrenNolanSos(html.replace('</table>', ''), 2026, iso(lock)));
});
