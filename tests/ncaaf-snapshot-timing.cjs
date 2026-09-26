const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise production parsing, recovery, read and scheduled-write paths with
// an in-memory store and clock. No test contacts a feed or production database.
function harness(now = '2026-09-26T01:09:00Z') {
  let currentTime = Date.parse(now);
  const tables = {};
  const writes = [];
  let feed = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [currentTime])); }
    static now() { return currentTime; }
  }
  const storage = {
    ensureSportWorksheet: async () => {},
    readSportWorksheet: async (_sport, table) => tables[table] || [],
    readSportWorksheetByDateKeys: async (_sport, table, dates) => (tables[table] || []).filter(row => dates.includes(row.Date)),
    appendSportRows: async (sport, table, _headers, rows) => {
      writes.push({ sport, table, rows });
      tables[table] = [...(tables[table] || []), ...rows];
    },
    upsertSportRows: async (sport, table, _headers, rows, key) => {
      writes.push({ sport, table, rows });
      const map = new Map((tables[table] || []).map(row => [key(row), row]));
      for (const row of rows) map.set(key(row), row);
      tables[table] = [...map.values()];
    },
    writeSportWorksheet: async (sport, table, _headers, rows) => {
      writes.push({ sport, table, rows }); tables[table] = rows;
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../lib/footballWeeklyMarket.ts'), 'utf8') + `
    export const timing = { ncaafKickoffEpoch, ncaafMinutesUntilEvent, resolveNcaafSnapshot, ncaafHistoryForPlay, weeklyRow };
    loadPostedSplits = async () => ({ splits: testFeed(), errors: [] } as any);
  `;
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Date: Clock, Intl, console, process,
    testFeed: () => feed,
    require: id => id === './sportSheets' ? storage : { SCORES_AND_ODDS_SOURCE: 'ScoresAndOdds' },
  });
  return { ...exports, tables, writes, setFeed: rows => { feed = rows; }, setTime: time => { currentTime = Date.parse(time); } };
}

function play(kickoff = '2026-09-25T16:00:00-04:00') {
  return {
    date: '2026-09-25', week: 'Week 5', game: 'Army @ Temple', gameKey: '2026-09-25|army|temple',
    gameTime: kickoff, awayTeam: 'Army', homeTeam: 'Temple', market: 'Total',
    selection: 'Over', selectionTeam: '', side: 'Over', sideGroup: 'Over',
    line: 48.5, odds: '-110', betsPct: 58, moneyPct: 50, gapPct: -8,
    score: 50, tier: 'Pass', signals: [], snapshotStatus: 'FINAL_PREGAME',
    updatedAt: '09/24/2026, 11:49:01 PM EDT', frozenAt: '09/24/2026, 11:49:01 PM EDT',
  };
}

function observation(p, time, extra = {}) {
  return {
    Date: p.date, 'Game Key': p.gameKey, 'Game Time': p.gameTime, Game: p.game,
    'Away Team': p.awayTeam, 'Home Team': p.homeTeam, Market: p.market, Side: p.side,
    Selection: p.selection, Line: String(p.line), Odds: p.odds,
    'Bets %': String(p.betsPct), 'Handle %': String(p.moneyPct),
    'Snapshot Time ET': time, Source: 'ScoresAndOdds', ...extra,
  };
}

function seed(h, p, rows) {
  h.tables.weekly_market_trends = [h.timing.weeklyRow(p)];
  h.tables.odds_snapshot = rows;
  h.tables.schedule = [{ Date: p.date, 'Away Team': p.awayTeam, 'Home Team': p.homeTeam, 'Game Time': p.gameTime }];
}

test('NCAAF kickoff handles ISO offsets, UTC, ET clocks, winter and invalid times', () => {
  const h = harness();
  for (const time of ['2026-09-25T16:00:00-04:00', '2026-09-25T20:00:00Z', '4:00 PM', '16:00', '2026-09-25T16:00:00']) {
    assert.equal(h.timing.ncaafKickoffEpoch('2026-09-25', time), Date.parse('2026-09-25T20:00:00Z'));
  }
  assert.equal(h.timing.ncaafKickoffEpoch('2026-09-25', '2026-09-25T22:30:00-04:00'), Date.parse('2026-09-26T02:30:00Z'));
  assert.equal(h.timing.ncaafKickoffEpoch('2026-12-05', '7:30 PM ET'), Date.parse('2026-12-06T00:30:00Z'));
  assert.equal(h.timing.ncaafMinutesUntilEvent('2026-09-25', 'TBD'), null);
});

test('NCAAF binds a stale timestamp clock to the canonical game date and ignores cross-day history', () => {
  const h = harness('2026-09-26T04:45:00Z'); // 12:45 AM ET on game day.
  const original = play('2026-09-25T16:00:00-04:00');
  const p = {
    ...original,
    date: '2026-09-26',
    gameKey: '2026-09-26|army|temple',
    gameTime: '2026-09-25T16:00:00-04:00',
  };
  const rows = [
    observation(p, '09/25/2026, 3:44:00 PM EDT', { Date: '2026-09-25' }),
    observation(p, '09/26/2026, 12:40:00 AM EDT'),
  ];
  assert.equal(
    h.timing.ncaafKickoffEpoch(p.date, p.gameTime),
    Date.parse('2026-09-26T20:00:00Z'),
  );
  const repaired = h.timing.resolveNcaafSnapshot(p, rows, []);
  assert.equal(repaired.snapshotStatus, 'LIVE');
  assert.equal(repaired.frozenAt, undefined);
  assert.equal(repaired.updatedAt, '09/26/2026, 12:40:00 AM EDT');
  assert.equal(h.timing.ncaafHistoryForPlay(repaired, rows).length, 1);
});

test('premature lock recovers actual T-15 observation, market values and bounded history', () => {
  const h = harness(); const p = play();
  const rows = [
    observation(p, '09/24/2026, 11:49:01 PM EDT'),
    observation(p, '09/25/2026, 3:44:02 PM EDT', { Line: '49.5', 'Bets %': '60' }),
    observation(p, '09/25/2026, 3:49:00 PM EDT', { Line: '50.5' }),
    observation(p, '09/25/2026, 9:04:00 PM EDT', { Line: '70.5', 'Bets %': '90' }),
  ];
  const recovered = h.timing.resolveNcaafSnapshot(p, rows, []);
  assert.equal(recovered.snapshotStatus, 'FINAL_PREGAME');
  assert.equal(recovered.updatedAt, '09/25/2026, 3:44:02 PM EDT');
  assert.equal(recovered.frozenAt, recovered.updatedAt);
  assert.equal(recovered.line, 49.5);
  assert.equal(recovered.betsPct, 60);
  assert.equal(h.timing.ncaafHistoryForPlay(recovered, rows).length, 2);
  h.setTime('2026-09-26T04:00:00Z');
  assert.deepEqual(h.timing.resolveNcaafSnapshot(recovered, rows, []), recovered);
});

test('late game remains LIVE until its own lock and stale history is never fabricated as final', () => {
  const h = harness(); const p = play('2026-09-25T22:30:00-04:00');
  const rows = [observation(p, '09/25/2026, 3:48:59 AM EDT'), observation(p, '09/25/2026, 9:04:00 PM EDT')];
  const live = h.timing.resolveNcaafSnapshot(p, rows, []);
  assert.equal(live.snapshotStatus, 'LIVE');
  assert.equal(live.frozenAt, undefined);
  assert.equal(live.updatedAt, rows[1]['Snapshot Time ET']);
  h.setTime('2026-09-26T02:16:00Z');
  assert.equal(h.timing.resolveNcaafSnapshot(live, rows, []).snapshotStatus, 'MISSED_LOCK');
});

test('NCAAF API read repairs old locks without exposing post-lock chart prices or writes', async () => {
  const h = harness(); const p = play();
  seed(h, p, [observation(p, '09/24/2026, 11:49:01 PM EDT'),
    observation(p, '09/25/2026, 3:44:02 PM EDT'),
    observation(p, '09/25/2026, 9:04:00 PM EDT', { Line: '70.5' })]);
  const result = await h.readWeeklyFootballMarket('NCAAF');
  assert.equal(result.trendPlays.length, 1);
  const current = result.trendPlays[0];
  assert.equal(current.updatedAt, '09/25/2026, 3:44:02 PM EDT');
  assert.equal(current.movementHistory.at(-1).snapshotTime, current.updatedAt);
  assert.equal(current.highLine, 48.5);
  assert.equal(h.writes.length, 0);
});

test('scheduled NCAAF collection stops at cutoff and persists recovered finals even after source removal', async () => {
  const h = harness(); const p = play();
  seed(h, p, [observation(p, '09/25/2026, 3:44:02 PM EDT')]);
  // A completed matchup remains on the source; never ingest this in-game line.
  h.setFeed([{ ...p, eventTime: p.gameTime, line: 70.5 }]);
  await h.syncPostedFootballMarkets('NCAAF');
  assert.equal(h.tables.odds_snapshot.length, 1);
  const stored = JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.frozenAt, '09/25/2026, 3:44:02 PM EDT');
  assert.equal(stored.line, 48.5);
  h.setFeed([]);
  await h.syncPostedFootballMarkets('NCAAF');
  assert.equal(JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']).frozenAt, stored.frozenAt);
  assert.ok(h.writes.every(write => write.sport === 'NCAAF'));
});

test('scheduled NCAAF collection captures a live game then freezes the same real observation at T-15', async () => {
  const h = harness('2026-09-25T19:44:00Z'); const p = play();
  seed(h, p, []);
  h.setFeed([{ ...p, eventTime: p.gameTime, warningKey: '', warning: '', warningTone: 'neutral', warningNegative: false }]);
  await h.syncPostedFootballMarkets('NCAAF');
  assert.equal(h.tables.odds_snapshot.length, 1);
  assert.equal(JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']).snapshotStatus, 'LIVE');
  h.setTime('2026-09-25T19:49:00Z');
  await h.syncPostedFootballMarkets('NCAAF');
  assert.equal(h.tables.odds_snapshot.length, 1);
  const final = JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(final.snapshotStatus, 'FINAL_PREGAME');
  assert.equal(final.frozenAt, '09/25/2026, 3:44:00 PM EDT');
});
