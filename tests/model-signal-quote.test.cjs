const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const api = load(path.resolve(__dirname, '../lib/modelSignalQuote.ts'));

const nfl = changes => ({ sport: 'NFL', market: 'Total', side: 'Over', version: 'nfl-v4.28-directional-variable-tiers-2026-10-08|nfl-auto-rotowire-v1',
  savedLine: 42.5, line: 43.5, savedEdge: 3.54, savedGrade: 'Strong Over', probability: 0.6091, reliability: 93.3, confluence: 4, odds: '-110', ...changes });

test('Steelers–Saints moved total requalifies as regular Over, with a reduced probability', () => {
  const result = api.regradeModelQuote(nfl());
  assert.equal(result.active, true);
  assert.equal(result.grade, 'Over');
  assert(Math.abs(result.edge - 2.54) < 1e-8);
  assert(result.probability > .555 && result.probability < .585);
  assert.equal(result.estimated, true);
  const unchanged = api.regradeModelQuote(nfl({ line: 42.5 }));
  assert.equal(unchanged.grade, 'Strong Over');
  assert.equal(unchanged.probability, .6091);
});

test('remaining edge alone cannot defeat probability, confluence, reliability or price requirements', () => {
  for (const changes of [{ line: 45 }, { reliability: 61 }, { confluence: 2 }, { odds: '-150' }, { odds: '' }]) {
    assert.equal(api.regradeModelQuote(nfl(changes)).active, false, JSON.stringify(changes));
  }
  assert.equal(api.regradeModelQuote(nfl({ line: 40.5 })).grade, 'Strong Over');
  assert.equal(api.regradeModelQuote(nfl({ side: 'Under', savedGrade: 'Strong Under', line: 41.5 })).grade, 'Under');
  assert.equal(api.regradeModelQuote(nfl({ side: 'Under', savedGrade: 'Strong Under', line: 44.5 })).grade, 'Strong Under');
  assert.equal(api.regradeModelQuote(nfl({ version: 'future-unverified-model' })), null);
  assert.equal(api.regradeModelQuote(nfl({ savedGrade: 'Availability hold' })), null);
});

test('NFL spread repricing respects favorite and underdog signs and the existing A/B grades', () => {
  const base = nfl({ market: 'Spread', side: 'saints', savedLine: 4.5, line: 3.5, savedEdge: 3.5,
    savedGrade: 'A Spread', probability: .61, confluence: 4 });
  assert.equal(api.regradeModelQuote(base).active, true);
  assert.equal(api.regradeModelQuote(base).grade, 'B Spread');
  assert.equal(api.regradeModelQuote({ ...base, line: 1.5 }).active, false);
  assert.equal(api.regradeModelQuote({ ...base, savedLine: -2.5, line: -3.5 }).active, true);
});

test('independent NFL spreads use one B grade at 3.5 with no A promotion', () => {
  const q = nfl({ market:'Spread', side:'team', version:'nfl-v4.28-directional-variable-tiers-2026-10-08|nfl-independent-spread-v1-2026-11-22|nfl-auto-rotowire-v1',
    savedLine:-7.5, line:-7.5, savedEdge:3.5, savedGrade:'B Spread', probability:.65, reliability:50, confluence:1,pairedMarketsMatch:true });
  assert.equal(api.regradeModelQuote(q).active, true);
  assert.equal(api.regradeModelQuote({...q,savedEdge:12}).grade, 'B Spread');
  assert.equal(api.regradeModelQuote({...q,savedEdge:3.4999}).active, false);
  assert.equal(api.regradeModelQuote({...q,savedGrade:'A Spread'}).active, false);
  assert.equal(api.regradeModelQuote({...q,odds:'-300'}).active, false);
  assert.equal(api.regradeModelQuote({...q,pairedMarketsMatch:false}).active, false);
  for(const line of [-7,-8]) {
    const changed=api.regradeModelQuote({...q,line});
    assert.equal(changed.active,false);assert.match(changed.reason,/fresh model run/);
  }
  assert.equal(api.regradeModelQuote(nfl({version:q.version,line:42.5})).grade,'Strong Over');
});

test('independent NFL totals preserve agreement grades and require fresh changed-total forecasts', () => {
  const version='nfl-v4.28-directional-variable-tiers-2026-10-08|nfl-independent-spread-v1-2026-11-22|nfl-total-tree4-unit-agreement-v1-2026-11-22|nfl-auto-rotowire-v1';
  const q=nfl({version,savedLine:44.5,line:44.5,savedGrade:'Over',savedEdge:4,probability:.64,reliability:50,confluence:1,pairedMarketsMatch:true});
  assert.equal(api.regradeModelQuote(q).active,true);
  assert.equal(api.regradeModelQuote({...q,savedEdge:12}).grade,'Over');
  assert.equal(api.regradeModelQuote({...q,side:'Under',savedGrade:'Under'}).active,true);
  assert.equal(api.regradeModelQuote({...q,savedEdge:3.999999}).active,false);
  assert.equal(api.regradeModelQuote({...q,savedGrade:'Strong Over'}).active,false);
  assert.equal(api.regradeModelQuote({...q,side:'Under'}).active,false);
  assert.equal(api.regradeModelQuote({...q,odds:'-300'}).active,false);
  assert.equal(api.regradeModelQuote({...q,pairedMarketsMatch:false}).active,false);
  for(const line of [44,45]) {
    const changed=api.regradeModelQuote({...q,line});
    assert.equal(changed.active,false);assert.match(changed.reason,/fresh model run/);
  }
});

test('CFB uses its own point thresholds and keeps FBS/20-point spread and price vetoes', () => {
  const base = nfl({ sport: 'NCAAF', version: 'cfb-v2.8.1-five-game-residual-totals-2026-10-07',
    savedGrade: 'A Total', savedLine: 49.5, line: 50.5, savedEdge: 6.2, probability: .67 });
  assert.equal(api.regradeModelQuote(base).grade, 'B Total');
  assert.equal(api.regradeModelQuote(base).active, true);
  assert.equal(api.regradeModelQuote({ ...base, line: 53 }).active, false);
  assert.equal(api.regradeModelQuote({ ...base, odds: '-300' }).active, false);
  const spread = { ...base, market: 'Spread', side: 'team', savedGrade: 'A Spread', savedLine: -18.5, line: -19.5, savedEdge: 10, probability: .72 };
  assert.equal(api.regradeModelQuote(spread).grade, 'B Spread');
  assert.equal(api.regradeModelQuote({ ...spread, line: -20 }).active, false);
  assert.equal(api.regradeModelQuote({ ...spread, savedGrade: 'No Play' }), null);
});

test('NBA retains its validation-normal grading at changed lines, including downgrades and price holds', () => {
  const base = nfl({ sport: 'NBA', version: 'nba-v0.5-market-grades-2026-10-22+nba-auto', savedGrade: 'A',
    savedLine: 220.5, line: 221.5, savedEdge: 8.5, probability: null });
  const result = api.regradeModelQuote(base);
  assert.equal(result.grade, 'A'); assert.equal(result.active, true);
  assert(Math.abs(result.probability - .650721688) < .00001);
  assert.equal(api.regradeModelQuote({ ...base, line: 225.5 }).grade, 'B');
  assert.equal(api.regradeModelQuote({ ...base, line: 228 }).active, false);
  assert.equal(api.regradeModelQuote({ ...base, line: 225.5, odds: '-150' }).active, false);
});
