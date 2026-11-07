const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { api: trial, game, history, plain } = require('./selection-trial-fixtures.cjs');
const context = load(path.resolve(__dirname, '../lib/matchupContext.ts'));
const date = '2026-11-04', now = trial.trialDayStart(date) + 17.75 * 3600000;

function record(wins, losses) {
  return { label: 'Recent results', wins, losses, pushes: 0, sample: wins + losses, record: `${wins}-${losses}-0`,
    winPct: 100 * wins / (wins + losses), supportPct: 100 * wins / (wins + losses), weight: 20, gameKeys: [] };
}

function enrich(sides) {
  return sides.map(side => {
    const positive = side.side === 'Over' || side.side === 'Home';
    const edge = positive ? 4 : -4;
    const openingLine = side.market === 'Total' ? side.line - 1 : side.line + (positive ? 0.5 : -0.5);
    const openingAt = new Date(Date.parse(side.snapshotAt) - 86400000).toISOString();
    const records = { betType: record(4, 2), venue: record(3, 1), recent: record(4, 1) };
    return { ...side,
      signals: side.signals.map(signal => signal.key === 'model' ? { ...signal, value: edge } : signal),
      marketContext: { bets: positive ? 30 : 70, money: positive ? 38 : 62, openingLine, openingAt,
        history: [{ snapshotTime: openingAt, line: openingLine, betsPct: 60, moneyPct: 55 },
          { snapshotTime: side.snapshotAt, line: side.line, betsPct: positive ? 30 : 70, moneyPct: positive ? 38 : 62 }] },
      teamTrend: { asOfDate: side.date, capturedAt: side.snapshotAt, score: positive ? 60 : 40,
        teams: [{ team: 'Home', opposing: side.market === 'Spread' && side.side !== 'Home', hasData: true, missingGames: 0, records },
          { team: 'Away', opposing: side.market === 'Spread' && side.side !== 'Away', hasData: true, missingGames: 0, records }] },
      modelContext: { version: 'builder-test-v1', projection: side.market === 'Total' ? 224.5 : side.line - edge,
        grade: 'B', reason: positive ? 'Matches the saved forecast.' : 'No existing qualifying model play on this side.' },
      sosContext: { gap: positive ? 60 : -60, capturedAt: openingAt },
    };
  });
}

test('context uses raw team records, schedule differences and disagreements even when a badge is inactive', () => {
  const sides = enrich(game(date));
  const side = sides[0];
  side.signals.forEach(signal => { signal.active = false; });
  side.modelContext.reason = 'No existing qualifying model play on this side.';
  const values = context.CONTEXT_FEATURE_SET.values(side, 'NCAAF');
  const feature = name => values[context.CONTEXT_FEATURE_NAMES.indexOf(name)];
  assert(feature('Team recent form') > 0);
  assert(feature('Schedule strength') > 0);
  assert(feature('Model edge') > 0);
  assert.equal(feature('Qualified model play'), 0);
  const review = context.contextCase(side, 'NCAAF');
  assert(review.evidence.some(item => item.value === '4-1-0'));
  assert(review.disagreements.some(item => item.includes('Public tickets')));
  assert.equal(context.CONTEXT_FEATURE_SET.values(side, 'NBA')[context.CONTEXT_FEATURE_NAMES.indexOf('Schedule strength')], 0);
});

test('market chronology retains the betting share when a line moved and ignores later quotes', () => {
  const side = enrich(game(date))[2];
  const moved = new Date(Date.parse(side.snapshotAt) - 12 * 3600000).toISOString();
  side.marketContext.history.splice(1, 0, { snapshotTime: moved, line: side.line, betsPct: 61, moneyPct: 57 });
  side.marketContext.history.push({ snapshotTime: new Date(now + 1).toISOString(), line: 999, betsPct: 99, moneyPct: 99 });
  const line = context.contextLineHistory(side);
  assert.equal(line.net, 1);
  assert.equal(line.movedAt, moved);
  assert.equal(line.ticketsAtMove, 61);
  assert.equal(context.contextCase(side, 'NCAAF').evidence.find(item => item.label === 'Latest line move').value,
    `${moved} · 61% tickets on this side at the move`);
  side.marketContext.history.push({ snapshotTime: moved, line: side.line - 2, betsPct: 61, moneyPct: 57 });
  assert.equal(context.contextLineHistory(side).historyAvailable, false);
});

test('future team/model/SOS context supplies no positive strength and model form cannot learn future labels', () => {
  const sides = enrich(game(date)), side = sides[0];
  side.teamTrend.capturedAt = new Date(now + 1).toISOString();
  side.sosContext.capturedAt = new Date(now + 1).toISOString();
  side.modelContext.reason = 'Morning model preview only.';
  side.signals.find(signal => signal.key === 'model').active = false;
  const values = context.CONTEXT_FEATURE_SET.values(side, 'NCAAF');
  for (const name of ['Team recent form', 'Team venue record', 'Model edge', 'Schedule strength']) {
    assert.equal(values[context.CONTEXT_FEATURE_NAMES.indexOf(name)], 0, name);
  }
  const earlier = enrich(history()), model = context.buildContextModel('NBA', date, earlier, now);
  const future = enrich(game(date, 88, { result: 'W', resultUpdated: new Date(now + 3600000).toISOString() }));
  future.forEach(item => { item.modelContext.version = 'future-version'; });
  assert.equal(context.buildContextModel('NBA', date, [...earlier, ...future], now).id, model.id);
  const delayed = earlier.map(item => ({ ...item, resultUpdated: new Date(trial.trialDayStart(date) + 1).toISOString() }));
  const delayedModel = context.buildContextModel('NBA', date, delayed, now);
  assert(Object.values(delayedModel.modelForms).every(form => form.games === 0));
});

test('all four sides share coherent paired estimates and context conflicts cannot create duplicate training support', () => {
  const earlier = enrich(history()), model = context.buildContextModel('NBA', date, earlier, now);
  const duplicated = context.buildContextModel('NBA', date, [...earlier, ...earlier], now);
  assert.equal(model.id, duplicated.id);
  assert.equal(context.buildContextModel('NBA', date, earlier.slice().reverse(), now).id, model.id);
  assert(context.validContextModel(model, 'NBA', date));
  const sides = enrich(game(date));
  const [decision] = context.buildContextDecisions(model, sides, [], now);
  assert.equal(decision.estimates.length, 4);
  assert.equal(decision.cases.length, 4);
  for (const market of ['Spread', 'Total']) {
    const pair = decision.estimates.filter(item => item.market === market);
    assert(Math.abs(pair[0].probability + pair[1].probability - 1) < 1e-12);
  }
  assert(!decision.pickId || decision.estimates.some(item => item.id === decision.pickId && item.eligible));
  const changed = plain(sides[0]); changed.teamTrend.score = 99;
  assert.equal(context.buildContextDecisions(model, [...sides, changed], [], now).length, 0);
  assert.equal(context.buildContextDecisions(model, sides, [], now + 900001).length, 0);
  assert.equal(decision.paperComparison, undefined);
});

test('fitting and comparing matchups completes with network access disabled', () => {
  const previous = global.fetch;
  global.fetch = () => { throw new Error('Network calls are disabled for matchup evaluation'); };
  try {
    const model = context.buildContextModel('NBA', date, enrich(history()), now);
    assert.equal(context.buildContextDecisions(model, enrich(game(date)), [], now).length, 1);
  } finally { global.fetch = previous; }
});

test('pending comparisons support all four sports before lock without weakening final capture or training', () => {
  const early = now - 6 * 3600000;
  for (const sport of ['NFL', 'NCAAF', 'NBA', 'NCAAM']) {
    const model = context.buildContextModel(sport, date, [], early);
    const sides = enrich(game(date, 0, { recorded: false, status: 'LIVE', snapshotAt: new Date(early).toISOString() }));
    const before = plain(sides);
    const [pending] = context.buildContextPreviews(model, sides, [], early);
    assert.equal(pending.reviewStatus, 'PENDING', sport);
    assert.equal(pending.estimates.length, 4);
    assert.equal(pending.cases.length, 4);
    assert(pending.cases.every(item => item.evidence.some(evidence => evidence.label === 'Current betting split')));
    assert.equal(context.buildContextDecisions(model, sides, [], early).length, 0);
    assert.equal(trial.buildTrialDecisions(model, sides, [], early, context.CONTEXT_FEATURE_SET).length, 0);
    assert.deepEqual(plain(sides), before);
    for (const invalid of [sides.slice(1), [...sides, { ...sides[0], line: -99.5 }],
      sides.map(side => ({ ...side, snapshotAt: new Date(early + 1).toISOString() })),
      sides.map(side => ({ ...side, status: 'MISSED_LOCK' })),
      sides.map(side => ({ ...side, result: 'W' })),
      sides.map(side => ({ ...side, scheduledGameTime: new Date(early).toISOString() })),
      sides.map(side => ({ ...side, lineSource: 'fallback' }))]) {
      assert.equal(context.buildContextPreviews(model, invalid, [], early).length, 0, sport);
    }
    assert.equal(context.buildContextPreviews(model, sides, [], Date.parse(sides[0].gameTime)).length, 0);
    assert.equal(context.buildContextPreviews(model, enrich(game(date)), [], now).length, 0);
    const [final] = context.buildContextDecisions(model, enrich(game(date)), [], now);
    assert.equal(final.estimates.length, 4);
    assert.equal(final.sourceSnapshotAt, game(date)[0].snapshotAt);
    assert.equal(final.reviewStatus, undefined);
  }
});
