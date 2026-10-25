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
const research = load(path.join(root, 'lib/signalCombinationResearch.ts'));
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

test('two-signal frozen sides enter research while the existing 3+ selector remains unchanged', () => {
  const x = input({ history: new Map(), leaderboard: [], capture: true });
  x.core.trendPlays = markets().map(play => ({ ...play, snapshotStatus: 'FINAL_PREGAME', frozenAt: iso(lock) }));
  const captured = api.buildFootballSignalsState(x);
  assert.equal(captured.changedRows.length, 2);
  assert(captured.board.sides.every(side => side.recorded && !side.selected));
  const totals = research.signalResearchView(captured.board.research, 'Total');
  assert.equal(totals.counts.find(row => row.label === '2').record.pending, 1);
  assert.equal(totals.counts.find(row => row.label === '0').record.pending, 1);
  assert.equal(captured.board.summary.pending, 0);
  const finished = api.buildFootballSignalsState({ ...x, capture: false, now: kickoff + 4 * 3600000,
    storedRows: captured.changedRows, core: { ...x.core, trendPlays: [], teamTrendScheduleRows: [{
      Date: date, 'Away Team': 'DAL', 'Home Team': 'GB', Completed: 'TRUE', 'Away Score': '30', 'Home Score': '24',
      'Result Updated': iso(kickoff + 3 * 3600000) }] } });
  const settled = research.signalResearchView(finished.board.research, 'Total');
  assert.equal(settled.counts.find(row => row.label === '2').record.record, '1-0-0');
  assert.equal(finished.board.summary.settled, 0);
});

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

test('NFL and CFB count classified retained movement after a line returns to its opening quote', () => {
  for (const sport of ['NFL', 'NCAAF']) for (const market of ['Spread', 'Total']) {
    const x = input({ sport, leaderboard: [], history: new Map() });
    x.core.trendPlays = markets(sport).map((p, i) => ({ ...p, market, openingLine: market === 'Total' ? 44.5 : i ? 3 : -3,
      line: market === 'Total' ? 44.5 : i ? 3 : -3,
      selection: market === 'Spread' ? i ? 'GB' : 'DAL' : p.selection,
      selectionTeam: market === 'Spread' ? i ? 'GB' : 'DAL' : '', side: market === 'Total' ? p.side : '',
      lineMovementBasis: `${market === 'Spread' ? 'Spread' : 'Total'} Line History`,
      lineMovementValue: i ? -.5 : .5, lineMovementSignal: i ? 'Adverse Line Movement' : 'Line Movement Confirmation' }));
    const { board } = api.buildFootballSignalsState(x), signals = board.sides.map(s => s.signals.find(signal => signal.key === 'move'));
    assert(signals.every(s => s.available), `${sport} ${market} history is available`);
    assert.equal(signals.filter(s => s.active).length, 1);
    assert.equal(signals.find(s => s.active).value, .5);
  }
});

function nflModelInput() {
  const x = input({ leaderboard: [], history: new Map() });
  x.core.trendPlays = markets('NFL', ['PIT', 'NO']).map(p => ({ ...p, line: 43.5 }));
  x.core.bestPlays = [{ game: 'Pittsburgh Steelers @ New Orleans Saints', awayTeam: 'Pittsburgh Steelers', homeTeam: 'New Orleans Saints',
    role: 'Total', play: 'Over 42.5', playType: 'Strong Over', oddsLine: '-110', selectedProbability: '0.6091',
    modelVersion: 'nfl-v4.28-directional-variable-tiers-2026-10-08|nfl-auto-rotowire-v1' }];
  x.core.slateToday = [{ Date: date, 'Away Team': 'PIT', 'Home Team': 'NO', 'Game Time': iso(kickoff),
    'Projected Away': '24.4', 'Projected Home': '21.6', 'Projected Total': '46',
    'Total Pick': 'Over 42.5', 'Total Grade': 'Strong Over', 'Total Probability': '0.6091', 'Total Edge': '3.54',
    'Total Confluence': '4', Reliability: '93.3', 'Build Phase': 'pregame', 'Build At': iso(lock - 3600000),
    'Model Version': x.core.bestPlays[0].modelVersion }];
  return x;
}

test('NFL Signals regrades a moved quote, matches full team names and preserves the original model pick', () => {
  const x = nflModelInput(), original = JSON.stringify(x.core);
  const { board } = api.buildFootballSignalsState(x);
  const over = board.sides.find(s => s.side === 'Over');
  assert.equal(find(board, 'model').active, true);
  assert.equal(over.modelContext.play, 'Over 43.5');
  assert.equal(over.modelContext.grade, 'Over');
  assert.equal(over.modelContext.originalPlay, 'Over 42.5');
  assert.equal(over.modelContext.originalGrade, 'Strong Over');
  assert.equal(over.modelContext.regraded, true);
  assert.equal(find(board, 'model', 'Under').active, false);
  assert.equal(JSON.stringify(x.core), original);
  x.core.trendPlays = x.core.trendPlays.map(p => ({ ...p, line: 45.5 }));
  assert.equal(find(api.buildFootballSignalsState(x).board, 'model').active, false);
});

test('official-build timing and price remain model-vote requirements after current-line repricing', () => {
  const x = nflModelInput();
  x.core.slateToday[0]['Build At'] = iso(lock + 1);
  let board = api.buildFootballSignalsState(x).board;
  assert.equal(find(board, 'model').active, false);
  assert.match(board.sides.find(s => s.side === 'Over').modelContext.reason, /not available before/);
  x.core.slateToday[0]['Build At'] = iso(lock - 3600000);
  x.core.trendPlays[0].odds = '-150';
  assert.equal(find(api.buildFootballSignalsState(x).board, 'model').active, false);
  x.core.slateToday[0]['Build Phase'] = 'early';
  x.core.slateToday[0]['Total Grade'] = 'No Play (pending pregame)';
  x.core.bestPlays = [];
  board = api.buildFootballSignalsState(x).board;
  assert.equal(find(board, 'model').active, false);
  assert.match(board.sides.find(s => s.side === 'Over').modelContext.reason, /official pregame model build is pending/);
});

test('a previously saved inactive model vote is never backfilled when quote handling is corrected', () => {
  const x = nflModelInput();
  x.capture = true;
  x.core.trendPlays = x.core.trendPlays.map(p => ({ ...p, snapshotStatus: 'FINAL_PREGAME', frozenAt: iso(lock) }));
  const old = JSON.parse(JSON.stringify(x));
  old.history = new Map(); old.core.bestPlays = [];
  const captured = api.buildFootballSignalsState(old), frozen = captured.changedRows.map(r => ({ ...r }));
  assert.equal(find(captured.board, 'model').active, false);
  const replay = api.buildFootballSignalsState({ ...x, storedRows: frozen, capture: false, now: kickoff + 1 });
  assert.equal(find(replay.board, 'model').active, false);
  assert.equal(replay.changedRows.length, 0);
  assert.equal(JSON.stringify(frozen), JSON.stringify(captured.changedRows));
});

test('three market badges alone fail the two-source rule; missing team history never supplies a vote', () => {
  const { board } = state({ history: new Map() });
  const over = board.sides.find(s => s.side === 'Over');
  assert.equal(over.signalCount, 3); assert.equal(over.sourceCount, 1); assert.equal(over.candidate, false);
  assert.equal(find(board, 'team').available, false);
});

test('scheduled spreads keep season ATS records visible while the line and team grade are unavailable', () => {
  const x = input();
  x.core.trendPlays = [];
  x.core.slateToday = [{ Date: date, 'Away Team': 'DAL', 'Home Team': 'GB', 'Game Time': iso(kickoff) }];
  const { board, changedRows } = api.buildFootballSignalsState(x);
  const spreads = board.sides.filter(side => side.market === 'Spread');
  assert.equal(spreads.length, 2);
  for (const side of spreads) {
    assert.equal(side.line, null);
    assert.equal(side.teamTrend.score, null);
    assert.equal(side.teamTrend.teams.length, 2);
    for (const team of side.teamTrend.teams) {
      assert.equal(team.role, null);
      assert.equal(team.records.betType.label, 'Overall ATS');
      assert.equal(team.records.betType.sample, 6);
      assert.equal(team.records.recent.sample, 5);
    }
    assert(side.teamGames.length > 0);
    assert.equal(side.signals.find(signal => signal.key === 'team').active, false);
    assert.equal(side.candidate, false);
  }
  assert.equal(changedRows.length, 0);
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

test('saved slates retain non-picks, survive feed removal and week rollover, and replay the original evidence with settled results', () => {
  const x = input({ capture: true });
  x.core.trendPlays = x.core.trendPlays.map(p => ({ ...p, snapshotStatus: 'FINAL_PREGAME', frozenAt: iso(lock) }));
  const captured = api.buildFootballSignalsState(x);
  x.storedRows = captured.changedRows;
  x.capture = false;
  x.core.trendPlays = [];
  assert.equal(api.buildFootballSignalsState(x).board.sides.length, 2, 'captured games survive disappearance from the market feed');
  x.now = kickoff + 14 * 86400000;
  x.core.today = '2026-11-05';
  x.core.draftKings = { trackingWeekStart: '2026-11-02', trackingWeekEnd: '2026-11-08' };
  x.core.teamTrendScheduleRows = [{ Date: date, 'Away Team': 'DAL', 'Home Team': 'GB',
    'Away Score': '27', 'Home Score': '24', Completed: 'TRUE', 'Result Updated': iso(x.now) }];
  const later = api.buildFootballSignalsState(x);
  assert.deepEqual(plain(later.board.archiveDates), [date]);
  assert.equal(later.board.sides.length, 0, 'older weeks do not expand the main response');
  const archive = api.readSavedFootballSignalsForDate(later.changedRows, date, x.now);
  assert.equal(archive.length, 2);
  const under = archive.find(s => s.side === 'Under');
  assert.equal(under.signalCount, 0); assert.equal(under.selected, false); assert.equal(under.result, 'L');
  const over = archive.find(s => s.side === 'Over');
  assert.equal(over.result, 'W'); assert.equal(over.line, 44.5); assert.equal(over.signalCount, 4);
  assert.deepEqual(plain(over.signals), plain(captured.board.sides.find(s => s.side === 'Over').signals));
  assert.equal(api.readSavedFootballSignalsForDate(later.changedRows, '2026-10-23', x.now).length, 0);
  // Changes to qualification rules must not hide the original day's evidence.
  const earlierPolicy = later.changedRows.map(row => ({ ...row, 'Policy Version': 'football-signals-earlier-policy' }));
  assert.equal(api.readSavedFootballSignalsForDate(earlierPolicy, date, x.now).length, 2);
  assert.deepEqual(plain(api.buildFootballSignalsState({ ...x, storedRows: earlierPolicy }).board.archiveDates), [date]);
});

test('a matching public system still respects the current final-window and kickoff protections', () => {
  const x = input();
  x.core.trendPlays[0] = { ...x.core.trendPlays[0], snapshotStatus: 'FINAL_PREGAME', frozenAt: iso(lock - 6 * 60000) };
  assert.equal(find(api.buildFootballSignalsState(x).board, 'system').active, false);
  x.core.trendPlays[0] = { ...x.core.trendPlays[0], snapshotStatus: 'LIVE', gameTime: iso(lock - 1) };
  assert.equal(find(api.buildFootballSignalsState(x).board, 'system').active, false);
});

test('scheduled games without a posted market remain visible without an invented line or price', () => {
  const x = input();
  x.core.trendPlays = [];
  x.core.teamTrendScheduleRows = [{ Date: date, 'Away Team': 'DAL', 'Home Team': 'GB', 'Game Time': iso(kickoff) }];
  const result = api.buildFootballSignalsState(x);
  assert.equal(result.board.sides.length, 4);
  assert(result.board.sides.every(side => side.line == null && side.odds === '' && !side.selected && !side.recorded));
  assert.equal(result.board.sides[0].selection, 'DAL');
});

test('Warren Nolan parser reads actual table columns and refuses partial or unrelated pages', () => {
  const rows = Array.from({ length: 136 }, (_, i) => `<tr><td><a href="team-clubhouse?team=Team-${i}">Team ${i}</a></td><td>${1600-i}</td><td>${i+1}</td><td>20-10</td><td>0.6667</td></tr>`).join('');
  const html = '<table><tr><th>Team</th><th>ELO SOS</th><th>Rank</th><th>Opp Record</th><th>Opp Win Percent</th></tr>' + rows + '</table>';
  const parsed = sos.parseWarrenNolanSos(html, 2026, iso(lock));
  assert.equal(parsed.teams.length, 136); assert.equal(parsed.teams[8].rank, 9); assert.equal(parsed.teams[8].elo, 1592);
  assert.throws(() => sos.parseWarrenNolanSos('<table><tr>Access denied</tr></table>', 2026, iso(lock)));
  assert.throws(() => sos.parseWarrenNolanSos(html.replace('</table>', ''), 2026, iso(lock)));
});
