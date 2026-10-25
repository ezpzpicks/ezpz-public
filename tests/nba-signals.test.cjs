const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const core = require('../lib/nbaAnalysisCore.ts');
const market = require('../lib/nbaMarketCore.ts');
const trend = require('../lib/nbaTrendLeaderboard.ts');
const catalog = require('../lib/footballTrendCatalog.ts');
const signals = require('../lib/footballSignals.ts');
const team = require('../lib/footballTeamTrends.ts');
const wilson = require('../lib/ncaafEzpzWilson.ts');
const research = require('../lib/signalCombinationResearch.ts');
const iso = n => new Date(n).toISOString();
const clone = x => JSON.parse(JSON.stringify(x));

function fixture(date = '2026-11-10', id = '101') {
  const kickoff = Date.parse(date + 'T23:00:00Z'), lock = kickoff - 15 * 60000;
  const base = { Date: date, 'Game ID': id, 'Game Key': `${date}|nba|${id}`, 'Game Time': iso(kickoff),
    Game: 'Cleveland Cavaliers @ Philadelphia 76ers', 'Away Team': 'Cleveland Cavaliers', 'Home Team': 'Philadelphia 76ers',
    'Away Team ID': '5', 'Home Team ID': '20', Source: 'ScoresAndOdds', 'Market Policy': market.NBA_MARKET_POLICY,
    Odds: '-110', 'Opening Odds': '-110', 'First Tracked At': iso(kickoff - 3 * 3600000),
    'Updated At': iso(lock), 'Frozen At': iso(lock), 'Snapshot Status': 'FINAL_PREGAME' };
  const rows = [
    ['Spread', base['Away Team'], 3.5, 4.5, 20, 50, 30, 50],
    ['Spread', base['Home Team'], -3.5, -4.5, 80, 50, 70, 50],
    ['Total', 'Over', 220.5, 219.5, 20, 60, 30, 50],
    ['Total', 'Under', 220.5, 219.5, 80, 40, 70, 50],
  ].map(([Market, Selection, line, opening, bets, money, ob, om]) => ({ ...base, Market, Selection, Side: Market === 'Total' ? Selection : '',
    Line: String(line), 'Opening Line': String(opening), 'Current Bets %': String(bets), 'Current Handle %': String(money),
    'Opening Bets %': String(ob), 'Opening Handle %': String(om), 'Details JSON': JSON.stringify({ movementHistory: [
      { snapshotTime: base['First Tracked At'], line: opening, odds: '-110', betsPct: ob, moneyPct: om },
      { snapshotTime: iso(lock), line, odds: '-110', betsPct: bets, moneyPct: money },
    ] }) }));
  const game = { ...base, Source: 'ESPN NBA schedule; ScoresAndOdds market lines', Status: 'STATUS_SCHEDULED', Completed: 'FALSE', 'Away Score': '', 'Home Score': '' };
  const state = core.emptyNbaAnalysis(date);
  return { date, id, kickoff, lock, rows, game, state };
}
function finalGame(f, over = true) { return { ...f.game, Status: 'STATUS_FINAL', Completed: 'TRUE',
  'Away Score': over ? '120' : '100', 'Home Score': over ? '115' : '105', 'Result Updated': iso(f.kickoff + 3 * 3600000) }; }
function forecast(f, overrides = {}) { return { away_team: f.game['Away Team'], home_team: f.game['Home Team'],
  tipoff: f.game['Game Time'].replace('.000Z', '+00:00'), lockedAt: iso(f.lock - 3600000), modelVersion: 'expected-test',
  fair_home_spread: -2.5, total: 229, spread_pick: 'Cleveland Cavaliers +3.5', spread_grade: 'Pass',
  total_pick: 'Over 220.5', total_grade: 'A', injury_verified: false, market: { home_spread: -3.5, total: 220.5 }, ...overrides }; }
function build(f, changes = {}) { return core.buildNbaSignals({ date: f.date, games: [f.game], splits: f.rows,
  forecasts: [], storedRows: [], state: f.state, now: f.lock, ...changes }); }
function withRanking(f) {
  const plays = core.nbaRowsToPlays(f.rows, f.lock), over = plays.find(p => p.side === 'Over');
  const memberships = trend.nbaTrendSignals(over, plays).slice(0, 2);
  assert.equal(memberships.length, 2);
  f.state.leaderboard = memberships.map((signal, i) => ({ id: `${signal}|over`, signal, category: 'Over', label: catalog.catalogSignalLabel(signal),
    wilsonScore: wilson.ncaafWilsonLowerBound(8, 2) * 100, totals: { record: '8-2-0', totalBets: 10, wins: 8, losses: 2,
      pushes: 0, winPct: 80, unitsWon: 8 / 1.1 - 2, netUnits: 8 / 1.1 - 2, roiPct: 52.7 }, lastSevenTotals: { record: '6-1-0' } }));
  f.state.leaderboardAsOf = iso(f.lock - 60000);
  return f;
}
function stored(result) { return result.changedRows.map(row => ({ ...row, 'Game Key': JSON.parse(row['Details JSON']).gameKey })); }

test('NBA research accumulates saved days, replaces settlements, and never promotes two-signal observations', () => {
  const first = fixture(), captured = build(first, { capture: true });
  const saved = stored(captured), late = first.kickoff + 4 * 3600000;
  const completed = build(first, { state: { ...first.state, signalResearch: captured.signalResearch }, storedRows: saved,
    now: late, games: [finalGame(first)] });
  assert.equal(research.signalResearchView(completed.board.research, 'Total').total.settled, 2);
  assert.equal(research.signalResearchView(completed.board.research, 'Total').counts.find(row => row.label === '2').record.record, '1-0-0');
  assert.equal(completed.board.summary.settled, 0);
  const second = fixture('2026-11-11', '102');
  second.state.signalResearch = completed.signalResearch;
  const next = build(second, { capture: true });
  const values = research.signalResearchView(next.board.research, 'Total');
  assert.equal(values.total.samples, 4); assert.equal(values.total.settled, 2); assert.equal(values.total.pending, 2);
  const again = build(second, { state: { ...second.state, signalResearch: next.signalResearch }, storedRows: stored(next) });
  assert.equal(research.signalResearchView(again.board.research, 'Total').total.samples, 4);
  assert.equal(again.board.research.dates.length, 2);
  assert.equal(values.total.assumedPrices, 4);
});

test('NBA has a separate market-only catalog, with no football weather or player context', () => {
  const nba = catalog.footballCatalog('NBA');
  assert.notEqual(nba.version, catalog.footballCatalog('NFL').version);
  assert(nba.rules.length > 300);
  assert(nba.rules.every(rule => ['E', 'H', 'P'].includes(rule.data)));
  assert(nba.rules.some(rule => rule.id === 'nba-market-move-hour-total'));
});
test('empty NBA history gives no public/team vote and no selected 3+ test', () => {
  const f = fixture(), result = build(f);
  assert.equal(result.board.sides.length, 4);
  assert.equal(result.board.sport, 'NBA');
  assert(result.board.sides.every(side => !side.selected && !side.signals.find(s => s.key === 'team').available));
  assert(result.board.sides.every(side => !side.signals.find(s => s.key === 'system').active));
  assert.equal(result.board.summary.record, '0-0-0');
  assert.equal(result.board.summary.pending, 0);
  assert.deepEqual(trend.buildNbaTrendLeaderboard([]), []);
});
test('multiple top-20 matches count once, and three correlated market votes are insufficient', () => {
  const f = withRanking(fixture()), result = build(f), over = result.board.sides.find(s => s.side === 'Over');
  assert.equal(over.publicMatches.length, 2);
  assert.equal(over.signals.filter(s => s.key === 'system' && s.active).length, 1);
  assert.equal(over.signalCount, 3); assert.equal(over.sourceCount, 1); assert.equal(over.selected, false);
});
test('a saved A/B model can supply the second source, with unchecked-injury context preserved', () => {
  const f = withRanking(fixture()), result = build(f, { forecasts: [forecast(f)] });
  const over = result.board.sides.find(s => s.side === 'Over');
  assert.equal(over.signalCount, 4); assert.equal(over.sourceCount, 2); assert.equal(over.selected, true);
  assert.match(over.modelContext.reason, /injury availability unchecked/);
  assert.equal(result.board.summary.pending, 0, 'live previews are never added to recorded results');
});
test('model votes reject future forecasts, other matchups, low grades and worse lines', () => {
  const f = fixture(), play = core.nbaRowsToPlays(f.rows, f.lock).find(p => p.side === 'Over');
  for (const change of [{ lockedAt: iso(f.lock + 1) }, { home_team: 'Miami Heat' }, { total_grade: 'Lean' },
    { total_grade: 'Pass' }, { market: { home_spread: -3.5, total: 219.5 } }]) {
    assert.equal(trend.nbaModelFor(play, [forecast(f, change)], f.lock).active, false);
  }
  assert.equal(trend.nbaModelFor(play, [forecast(f)], f.lock).active, true, 'equivalent ISO timestamp formats match');
});
test('production NBA forecasts are regraded at a worse line instead of losing the model vote automatically', () => {
  const f = fixture(), play = core.nbaRowsToPlays(f.rows, f.lock).find(p => p.side === 'Over');
  const model = forecast(f, { modelVersion: 'nba-v0.5-market-grades-2026-10-22', grade_policy: 'shared-market-grade-nba-validation-normal-v1',
    market: { home_spread: -3.5, total: 219.5 } });
  const original = JSON.stringify(model), result = trend.nbaModelFor(play, [model], f.lock);
  assert.equal(result.active, true);
  assert.equal(result.context.play, 'Over 220.5');
  assert.equal(result.context.originalPlay, 'Over 220.5');
  assert.equal(result.context.regraded, true);
  assert.equal(result.context.grade, 'A');
  assert.equal(JSON.stringify(model), original);
  assert.equal(trend.nbaModelFor({ ...play, line: 228 }, [model], f.lock).active, false);
});
test('only paired final-window observations are captured, including unqualified sides', () => {
  const f = fixture(), result = build(f, { capture: true });
  assert.equal(result.changedRows.length, 4); assert(result.board.sides.every(side => side.recorded));
  assert(result.changedRows.every(row => row['Policy Version'] === trend.NBA_SIGNALS_POLICY.version));
  assert.equal(result.board.history.length, 0);
  const saved = stored(result);
  assert.equal(signals.readSavedFootballSignalsForDate(saved, f.date, f.lock, trend.NBA_SIGNALS_POLICY).length, 4);
  assert.equal(signals.readSavedFootballSignalsForDate(saved, f.date, f.lock).length, 0, 'NFL replay cannot consume NBA evidence');
  for (const changes of [{ splits: f.rows.slice(0, 1) }, { now: f.kickoff + 1 }, { splits: f.rows.map(r => ({ ...r, 'Snapshot Status': 'LIVE', 'Frozen At': '' })) }]) {
    assert.equal(build(f, { capture: true, ...changes }).changedRows.length, 0);
  }
});
test('a past game cannot acquire a retrospective 3+ selection', () => {
  const f = withRanking(fixture()), result = build(f, { capture: true, now: f.kickoff + 1, forecasts: [forecast(f)] });
  assert(result.board.sides.every(s => !s.selected)); assert.equal(result.changedRows.length, 0);
});
test('saved votes and lines replay unchanged; only an official completed game settles them', () => {
  const f = withRanking(fixture()), captured = build(f, { forecasts: [forecast(f)], capture: true });
  assert.equal(captured.board.summary.pending, 1);
  const saved = stored(captured), late = f.kickoff + 3 * 3600000;
  const replay = build(f, { state: { ...f.state, leaderboard: [] }, storedRows: saved, now: late,
    splits: f.rows.map(r => ({ ...r, Line: '999' })), forecasts: [] });
  const original = captured.board.sides.find(s => s.side === 'Over'), side = replay.board.sides.find(s => s.side === 'Over');
  assert.equal(side.selected, true); assert.equal(side.line, original.line); assert.equal(side.signalCount, original.signalCount);
  assert.equal(side.result, '');
  const settled = build(f, { state: f.state, storedRows: saved, now: late, games: [finalGame(f)] });
  assert.equal(settled.board.sides.find(s => s.side === 'Over').result, 'W');
  assert.equal(settled.board.summary.record, '1-0-0');
});
test('trend grading requires an identity-matched final score and a complete original quartet', () => {
  const f = fixture(), game = finalGame(f), now = f.kickoff + 3 * 3600000;
  const rows = core.settleNbaTrendRows(f.rows, [game], now);
  assert.equal(rows.length, 4); assert(rows.every(r => r.Sport === 'NBA' && r['NBA Record Policy'] === trend.NBA_TREND_RECORD_POLICY));
  assert.equal(rows.find(r => r.Selection === 'Over').Result, 'W');
  assert.equal(rows.find(r => r.Selection === 'Under').Result, 'L');
  for (const [snapshots, schedule] of [
    [f.rows.slice(0, 3), game], [f.rows, { ...game, Completed: 'FALSE' }], [f.rows, { ...game, 'Home Team ID': '99' }],
    [f.rows, { ...game, 'Result Updated': iso(now + 1) }], [f.rows.map(r => ({ ...r, Source: 'Other' })), game],
    [f.rows.map(r => ({ ...r, 'Frozen At': iso(f.kickoff - 9 * 60000) })), game],
    [f.rows.map((r, i) => i === 0 ? { ...r, Line: '99' } : r), game],
    [f.rows.map((r, i) => i === 2 ? { ...r, Line: '999' } : r), game],
    [f.rows.map((r, i) => i === 2 ? { ...r, 'Current Bets %': '' } : r), game],
    [f.rows.map((r, i) => i === 2 ? { ...r, 'Current Handle %': '99' } : r), game],
    [f.rows.map((r, i) => i === 2 ? { ...r, Selection: 'Other' } : r), game],
    [f.rows.map(r => ({ ...r, Odds: '-500' })), game],
  ]) assert.equal(core.settleNbaTrendRows(snapshots, [schedule], now).length, 0);
});
test('NBA ranking excludes foreign and future results and deduplicates physical games', () => {
  const f = fixture(), at = f.kickoff + 3 * 3600000;
  const rows = core.settleNbaTrendRows(f.rows, [finalGame(f)], at);
  const ranked = trend.buildNbaTrendLeaderboard(rows, at);
  assert(ranked.length > 0 && ranked.length <= 20);
  assert.deepEqual(trend.buildNbaTrendLeaderboard([...rows, ...rows], at), ranked);
  assert.deepEqual(trend.buildNbaTrendLeaderboard(rows, at - 1), []);
  assert.deepEqual(trend.buildNbaTrendLeaderboard(rows.map(r => ({ ...r, Sport: 'NFL' })), at), []);
  assert(ranked.every(r => r.totals.wins / (r.totals.wins + r.totals.losses) > .6 && r.totals.netUnits > 0));
});
test('the shared Wilson ordering favors evidence, excludes 60%/push-only/losing types, and caps at 20', () => {
  const subtype = (id, w, l, units = w / 1.1 - l) => ({ id, signal: id, category: 'Over', label: id,
    totals: { wins: w, losses: l, pushes: 0, totalBets: w + l, netUnits: units, unitsWon: units } });
  const ranked = wilson.rankNcaafEzpzSubtypes([subtype('4-1', 4, 1), subtype('10-5', 10, 5), subtype('60pct', 3, 2), subtype('no-data', 0, 0), subtype('negative-roi', 8, 2, -1)]);
  assert.deepEqual(ranked.map(r => r.id), ['10-5', '4-1']);
  assert.equal(wilson.rankNcaafEzpzSubtypes(Array.from({ length: 25 }, (_, i) => subtype(String(i), 8, 2))).length, 20);
});
test('team grades use NBA identities and refuse results not known before the decision', () => {
  const f = fixture(), previous = fixture('2026-11-08', '99'), game = finalGame(previous), at = f.lock;
  const records = core.settleNbaTrendRows(previous.rows, [game], Date.parse(game['Result Updated']));
  const history = new Map(core.mergeNbaTeamHistory([], records, [game]));
  const play = core.nbaRowsToPlays(f.rows, f.lock).find(p => p.side === 'Over');
  const score = team.scoreFootballTeamTrends(play, 'NBA', history, at);
  assert.equal(score.scope, 'Tracked current-season games'); assert(score.score != null);
  for (const entry of history.values()) entry.knownAt = iso(at + 1);
  assert.equal(team.scoreFootballTeamTrends(play, 'NBA', history, at).score, null);
});
