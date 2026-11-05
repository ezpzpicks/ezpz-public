const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const coverageApi = require('./load-typescript.cjs')(path.resolve(__dirname, '../lib/scoresAndOddsBettingSplits.ts'));

// Exercise production parsing, recovery, read and scheduled-write paths with
// an in-memory store and clock. No test contacts a feed or production database.
function harness(now = '2026-09-26T01:09:00Z', useSource = false, officialGames) {
  let currentTime = Date.parse(now);
  const tables = {};
  const writes = [];
  let feed = [];
  let warnings = [], appendError = null;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [currentTime])); }
    static now() { return currentTime; }
  }
  const storage = {
    ensureSportWorksheet: async () => {},
    readSportWorksheet: async (_sport, table) => tables[table] || [],
    readSportWorksheetByDateKeys: async (_sport, table, dates) => (tables[table] || []).filter(row => dates.includes(row.Date)),
    appendSportRows: async (sport, table, _headers, rows) => {
      if (appendError && table === 'odds_snapshot') throw appendError;
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
    export const timing = { ncaafKickoffEpoch, ncaafMinutesUntilEvent, resolveNcaafSnapshot, ncaafHistoryForPlay, weeklyRow, loadPostedSplits, normalizeNcaafHistoryForPlay };
    ${useSource ? '' : 'loadPostedSplits = async () => ({ splits: testFeed(), errors: testWarnings() } as any);'}
  `;
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Date: Clock, Error, Intl, console, process,
    ...(officialGames ? { URL, AbortSignal, fetch: async () => ({ ok: true,
      json: async () => ({ events: officialGames }) }) } : {}),
    testFeed: () => feed,
    testWarnings: () => [...warnings],
    require: id => id === './sportSheets' ? storage : {
      SCORES_AND_ODDS_SOURCE: 'ScoresAndOdds',
      loadScoresAndOddsConsensus: async () => ({ splits: feed }),
      assessScoresAndOddsMarketCoverage: useSource ? coverageApi.assessScoresAndOddsMarketCoverage
        : () => ({ ok: true, receivedGames: 1, expectedGames: 1, missingGames: [], incompleteGames: [] }),
    },
  });
  return { ...exports, tables, writes, setFeed: rows => { feed = rows; }, setWarnings: rows => { warnings = rows; }, failAppend: error => { appendError = error; }, setTime: time => { currentTime = Date.parse(time); } };
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

// Scheduled refreshes reuse the compact history saved on each weekly play.
function persistedHistory(rows) {
  return rows.map(row => ({ snapshotTime: row['Snapshot Time ET'], line: Number(row.Line),
    odds: row.Odds, betsPct: Number(row['Bets %']), moneyPct: Number(row['Handle %']) }));
}

test('CMU and EMU stay separate through abbreviated schedule names, a favorite change and the final freeze', async () => {
  const kickoff = '2026-11-05T00:30:00.000Z';
  const official = [{ date: kickoff, competitions: [{ date: kickoff, competitors: [
    { homeAway: 'away', team: { location: 'Central Michigan', shortDisplayName: 'C Michigan' } },
    { homeAway: 'home', team: { location: 'Eastern Michigan', shortDisplayName: 'E Michigan' } },
  ] }] }];
  const h = harness('2026-11-04T23:40:00Z', true, official);
  h.tables.schedule = [{ Date: '2026-11-04', 'Away Team': 'Central Michigan',
    'Home Team': 'Eastern Michigan', 'Game Time': kickoff }];
  const source = { date: '2026-11-04', eventTime: '19:30', game: 'Central Michigan @ Eastern Michigan',
    awayTeam: 'Central Michigan', homeTeam: 'Eastern Michigan', market: 'Spread', side: '' };
  const quotes = awayLine => [
    { ...source, selectionTeam: source.awayTeam, selection: `${source.awayTeam} ${awayLine}`,
      line: awayLine, odds: '-110', betsPct: 44, moneyPct: 53 },
    { ...source, selectionTeam: source.homeTeam, selection: `${source.homeTeam} ${-awayLine}`,
      line: -awayLine, odds: '-115', betsPct: 56, moneyPct: 47 },
  ];
  h.setFeed(quotes(1.5));
  await h.syncPostedFootballMarkets('NCAAF');
  assert.equal(h.tables.weekly_market_trends.length, 2, 'Both spread sides must survive the canonical storage key');
  h.setTime('2026-11-05T00:14:00Z');
  h.setFeed(quotes(-3));
  await h.syncPostedFootballMarkets('NCAAF');
  h.setTime('2026-11-05T00:21:00Z');
  h.setFeed(quotes(-4.5)); // A later quote cannot change the locked line or put it in the team label.
  await h.syncPostedFootballMarkets('NCAAF');
  const stored = h.tables.weekly_market_trends.map(r => JSON.parse(r['Details JSON']));
  assert.equal(stored.length, 2);
  for (const [team, line, bets, money, first] of [
    ['Central Michigan', -3, 44, 53, 1.5], ['Eastern Michigan', 3, 56, 47, -1.5],
  ]) {
    const p = stored.find(p => p.selectionTeam === team);
    assert(p, team); assert.equal(p.line, line); assert.equal(p.betsPct, bets); assert.equal(p.moneyPct, money);
    assert.equal(p.snapshotStatus, 'FINAL_PREGAME');
    assert.equal(p.frozenAt, '11/04/2026, 7:14:00 PM EST');
    assert.equal(p.movementHistory[0].line, first);
    assert(p.movementHistory.every(point => point.betsPct === bets && point.moneyPct === money));
    assert.equal(p.selection, team, 'The display label cannot retain a different source line after freezing');
  }
  const read = await h.readWeeklyFootballMarket('NCAAF', { dateKeys: ['2026-11-04'], hydrateHistory: false });
  assert.equal(read.trendPlays.length, 2, 'Read-time alias deduplication must retain both teams');
});

test('legacy short schedule names cannot collapse CMU/EMU and exact Michigan State identity wins over token overlap', async () => {
  for (const [away, home, scheduleAway, scheduleHome] of [
    ['Central Michigan', 'Eastern Michigan', 'C Michigan', 'E Michigan'],
    ['Michigan', 'Michigan State', 'Michigan', 'Michigan State'],
  ]) {
    const h = harness('2026-11-04T23:40:00Z', true), kickoff = '2026-11-05T00:30:00.000Z';
    const p = { ...play(kickoff), date: '2026-11-04', game: `${away} @ ${home}`,
      gameKey: '2026-11-04|legacy', awayTeam: away, homeTeam: home, market: 'Spread', side: '',
      selection: away, selectionTeam: away, line: -3, movementHistory: [],
      updatedAt: '11/04/2026, 7:14:00 PM EST', frozenAt: '11/04/2026, 7:14:00 PM EST' };
    h.tables.schedule = [{ Date: p.date, 'Away Team': scheduleAway, 'Home Team': scheduleHome, 'Game Time': kickoff }];
    h.tables.weekly_market_trends = [h.timing.weeklyRow(p), h.timing.weeklyRow({ ...p, selection: home, selectionTeam: home, line: 3 })];
    const read = await h.readWeeklyFootballMarket('NCAAF', { hydrateHistory: false });
    assert.equal(read.trendPlays.length, 2, `${away} / ${home}`);
    assert.equal(new Set(read.trendPlays.map(p => p.selectionTeam)).size, 2);
  }
});

test('ambiguous school labels are rejected and a history normalizer cannot relabel the opponent as its own side', async () => {
  const h = harness('2026-11-04T23:40:00Z', true), kickoff = '2026-11-05T00:30:00.000Z';
  const p = { ...play(kickoff), date: '2026-11-04', game: 'Central Michigan @ Eastern Michigan',
    gameKey: '2026-11-04|central michigan|eastern michigan', awayTeam: 'Central Michigan', homeTeam: 'Eastern Michigan',
    market: 'Spread', side: '', selection: 'Central Michigan', selectionTeam: 'Central Michigan', line: -3 };
  h.tables.schedule = [{ Date: p.date, 'Away Team': p.awayTeam, 'Home Team': p.homeTeam, 'Game Time': kickoff }];
  h.setFeed([{ ...p, selectionTeam: 'Michigan', eventTime: '19:30' }]);
  await assert.rejects(h.timing.loadPostedSplits('NCAAF', h.tables.schedule), /no NCAAF market sides/);
  const away = observation(p, '11/04/2026, 7:14:00 PM EST');
  const home = { ...away, Selection: 'E Michigan', Line: '3', 'Bets %': '56' };
  const foreign = { ...away, 'Home Team': 'Toledo', Line: '-10' };
  const normalized = h.timing.normalizeNcaafHistoryForPlay(p, [away, home, foreign]);
  assert.equal(normalized.length, 1); assert.equal(normalized[0].Line, '-3');
  assert.equal(normalized[0].Selection, 'Central Michigan');
});

test('NCAAF collection retains a usable total and reports the unpublished spread without repeating a successful save', async () => {
  const h = harness('2026-11-04T22:00:00Z', true), kickoff = '2026-11-05T00:00:00.000Z';
  h.tables.schedule = [{ Date: '2026-11-04', 'Away Team': 'Toledo', 'Home Team': 'Sacramento State', 'Game Time': kickoff }];
  h.setFeed(['Over', 'Under'].map((side, i) => ({ date: '2026-11-04', eventTime: '19:00',
    game: 'Toledo @ Sacramento State', awayTeam: 'Toledo', homeTeam: 'Sacramento State',
    market: 'Total', side, selection: side, selectionTeam: '', line: 52.5, odds: '-110',
    betsPct: i ? 85 : 15, moneyPct: i ? 34 : 66 })));
  const result = await h.syncPostedFootballMarkets('NCAAF');
  assert.equal(result.refreshCompleted, true);
  assert.equal(result.coverage.ok, false);
  assert(result.errors.some(error => error.includes('0/2 spread sides, 2/2 total sides')));
  assert.equal(h.tables.weekly_market_trends.length, 2);
  assert(h.tables.weekly_market_trends.every(row => row.Market === 'Total'));
});

for (const sport of ['NFL', 'NCAAF']) test(`${sport} refresh success distinguishes feed warnings from a failed archive save`, async () => {
  const h = harness('2026-09-25T18:00:00Z');
  const p = { ...play(), snapshotStatus: 'LIVE', frozenAt: undefined };
  seed(h, p, []);
  h.setFeed([{ ...p, eventTime: p.gameTime, warningKey: '', warning: '', warningTone: 'neutral', warningNegative: false }]);
  h.setWarnings(['ScoresAndOdds returned 200 parsed market sides; 166 matched the schedule before validation.']);
  const saved = await h.syncPostedFootballMarkets(sport);
  assert.equal(saved.refreshCompleted, true);
  assert.equal(saved.marketHistoryRowsAppended, 1);
  assert.equal(saved.errors.length, 1);
  h.failAppend(new Error('database unavailable'));
  const failed = await h.syncPostedFootballMarkets(sport);
  assert.equal(failed.refreshCompleted, false);
  assert.equal(failed.marketHistoryRowsAppended, 0);
  assert.ok(failed.errors.some(error => error.includes('Market history append failed: database unavailable')));
});

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

test('midnight placeholder kickoff never finalizes a current-day game', () => {
  const h = harness('2026-09-26T15:03:00Z'); // 11:03 AM ET.
  const original = play('2026-09-26T00:00:00-04:00');
  const p = {
    ...original,
    date: '2026-09-26',
    gameKey: '2026-09-26|army|temple',
    gameTime: '2026-09-26T00:00:00-04:00',
    snapshotStatus: 'FINAL_PREGAME',
    updatedAt: '09/25/2026, 11:43:59 PM EDT',
    frozenAt: '09/25/2026, 11:43:59 PM EDT',
  };
  const rows = [
    observation(p, '09/25/2026, 11:43:59 PM EDT'),
    observation(p, '09/26/2026, 11:00:00 AM EDT', { Line: '49.5', 'Bets %': '61' }),
  ];
  assert.ok(Number.isNaN(h.timing.ncaafKickoffEpoch(p.date, p.gameTime)));
  const repaired = h.timing.resolveNcaafSnapshot(p, rows, []);
  assert.equal(repaired.snapshotStatus, 'LIVE');
  assert.equal(repaired.frozenAt, undefined);
  assert.equal(repaired.updatedAt, '09/26/2026, 11:00:00 AM EDT');
  assert.equal(repaired.line, 49.5);
  assert.equal(repaired.betsPct, 61);
});

test('scheduled NCAAF capture keeps polling when kickoff is still a midnight placeholder', async () => {
  const h = harness('2026-09-26T15:03:00Z');
  const original = play('2026-09-26T00:00:00-04:00');
  const p = {
    ...original,
    date: '2026-09-26',
    gameKey: '2026-09-26|army|temple',
    gameTime: '2026-09-26T00:00:00-04:00',
    snapshotStatus: 'LIVE',
    updatedAt: '09/26/2026, 10:58:00 AM EDT',
    frozenAt: undefined,
  };
  seed(h, p, [observation(p, '09/26/2026, 10:58:00 AM EDT')]);
  h.setFeed([{ ...p, eventTime: p.gameTime, line: 50.5, betsPct: 63, moneyPct: 51,
    warningKey: '', warning: '', warningTone: 'neutral', warningNegative: false }]);
  await h.syncPostedFootballMarkets('NCAAF');
  assert.equal(h.tables.odds_snapshot.length, 2);
  const stored = JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.snapshotStatus, 'LIVE');
  assert.equal(stored.frozenAt, undefined);
});

test('active NCAAF source kickoff replaces a stale stored kickoff before lock resolution', async () => {
  const h = harness('2026-09-26T15:30:00Z'); // 11:30 AM ET.
  const original = play('2026-09-26T10:00:00-04:00');
  const p = {
    ...original,
    date: '2026-09-26',
    gameKey: '2026-09-26|army|temple',
    gameTime: '2026-09-26T10:00:00-04:00',
    snapshotStatus: 'FINAL_PREGAME',
    updatedAt: '09/26/2026, 9:44:00 AM EDT',
    frozenAt: '09/26/2026, 9:44:00 AM EDT',
  };
  const rows = [
    observation(p, '09/26/2026, 9:44:00 AM EDT'),
    observation(p, '09/26/2026, 11:20:00 AM EDT', { Line: '49.5', 'Bets %': '61' }),
  ];
  seed(h, p, rows);
  h.setFeed([{
    ...p,
    eventTime: '2026-09-26T19:30:00-04:00',
    line: 49.5,
    betsPct: 61,
    moneyPct: 50,
    warningKey: '',
    warning: '',
    warningTone: 'neutral',
    warningNegative: false,
  }]);
  await h.syncPostedFootballMarkets('NCAAF');
  const stored = JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.gameTime, '2026-09-26T19:30:00-04:00');
  assert.equal(stored.snapshotStatus, 'LIVE');
  assert.equal(stored.frozenAt, undefined);
  assert.equal(stored.updatedAt, '09/26/2026, 11:30:00 AM EDT');
});

test('NCAAF read path repairs a stale stored kickoff from the canonical schedule', async () => {
  const h = harness('2026-09-26T15:30:00Z');
  const original = play('2026-09-26T10:00:00-04:00');
  const p = {
    ...original,
    date: '2026-09-26',
    gameKey: '2026-09-26|army|temple',
    gameTime: '2026-09-26T10:00:00-04:00',
    snapshotStatus: 'FINAL_PREGAME',
    updatedAt: '09/26/2026, 9:44:00 AM EDT',
    frozenAt: '09/26/2026, 9:44:00 AM EDT',
  };
  h.tables.weekly_market_trends = [h.timing.weeklyRow(p)];
  h.tables.odds_snapshot = [
    observation(p, '09/26/2026, 9:44:00 AM EDT'),
    observation(p, '09/26/2026, 11:20:00 AM EDT', { Line: '49.5', 'Bets %': '61' }),
  ];
  h.tables.schedule = [{
    Date: p.date,
    'Away Team': p.awayTeam,
    'Home Team': p.homeTeam,
    'Game Time': '2026-09-26T19:30:00-04:00',
  }];
  const result = await h.readWeeklyFootballMarket('NCAAF');
  assert.equal(result.trendPlays.length, 1);
  assert.equal(result.trendPlays[0].gameTime, '2026-09-26T19:30:00-04:00');
  assert.equal(result.trendPlays[0].snapshotStatus, 'LIVE');
  assert.equal(result.trendPlays[0].frozenAt, undefined);
  assert.equal(result.trendPlays[0].updatedAt, '09/26/2026, 11:20:00 AM EDT');
});

test('NCAAF read path keeps a stale stored kickoff display-only when canonical time is still unknown', async () => {
  const h = harness('2026-09-26T15:30:00Z');
  const original = play('2026-09-26T10:00:00-04:00');
  const p = {
    ...original,
    date: '2026-09-26',
    gameKey: '2026-09-26|army|temple',
    gameTime: '2026-09-26T10:00:00-04:00',
    snapshotStatus: 'FINAL_PREGAME',
    updatedAt: '09/26/2026, 9:44:00 AM EDT',
    frozenAt: '09/26/2026, 9:44:00 AM EDT',
  };
  h.tables.weekly_market_trends = [h.timing.weeklyRow(p)];
  h.tables.odds_snapshot = [
    observation(p, '09/26/2026, 9:44:00 AM EDT'),
    observation(p, '09/26/2026, 11:20:00 AM EDT', { Line: '49.5', 'Bets %': '61' }),
  ];
  h.tables.schedule = [{
    Date: p.date,
    'Away Team': p.awayTeam,
    'Home Team': p.homeTeam,
    'Game Time': '2026-09-26T00:00:00-04:00',
  }];
  const result = await h.readWeeklyFootballMarket('NCAAF');
  assert.equal(result.trendPlays.length, 1);
  assert.equal(result.trendPlays[0].gameTime, '2026-09-26T10:00:00-04:00');
  // The stored 10:00 AM time is display-only: at 11:30 AM this would already
  // be final if the lock resolver trusted it. It must remain LIVE.
  assert.equal(result.trendPlays[0].snapshotStatus, 'LIVE');
  assert.equal(result.trendPlays[0].frozenAt, undefined);
  assert.equal(result.trendPlays[0].updatedAt, '09/26/2026, 11:20:00 AM EDT');
});

test('NCAAF read path recovers a missing display time from same-day model rows without trusting it for lock', async () => {
  const h = harness('2026-09-26T15:30:00Z');
  const original = play('');
  const p = {
    ...original,
    date: '2026-09-26',
    gameKey: '2026-09-26|army|temple',
    gameTime: '',
    snapshotStatus: 'FINAL_PREGAME',
    updatedAt: '09/26/2026, 9:44:00 AM EDT',
    frozenAt: '09/26/2026, 9:44:00 AM EDT',
  };
  h.tables.weekly_market_trends = [h.timing.weeklyRow(p)];
  h.tables.odds_snapshot = [
    observation(p, '09/26/2026, 9:44:00 AM EDT'),
    observation(p, '09/26/2026, 11:20:00 AM EDT', { Line: '49.5', 'Bets %': '61' }),
  ];
  h.tables.schedule = [{
    Date: p.date,
    'Away Team': p.awayTeam,
    'Home Team': p.homeTeam,
    'Game Time': '2026-09-26T00:00:00-04:00',
  }];
  h.tables.all_game_trends = [{
    Date: p.date,
    'Away Team': p.awayTeam,
    'Home Team': p.homeTeam,
    'Game Time': '7:30 PM',
  }];

  const result = await h.readWeeklyFootballMarket('NCAAF');
  assert.equal(result.trendPlays.length, 1);
  assert.equal(result.trendPlays[0].gameTime, '7:30 PM');
  assert.equal(result.trendPlays[0].snapshotStatus, 'LIVE');
  assert.equal(result.trendPlays[0].frozenAt, undefined);
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
  assert.equal(h.timing.resolveNcaafSnapshot(live, rows, []).snapshotStatus, 'LIVE');
  h.setTime('2026-09-26T02:21:00Z');
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
  const h = harness('2026-09-25T21:09:00Z'); const p = play();
  const rows = [observation(p, '09/25/2026, 3:44:02 PM EDT')];
  seed(h, { ...p, movementHistory: persistedHistory(rows) }, rows);
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

test('scheduled NCAAF collection captures through T-10 then freezes the real observation closest to T-15', async () => {
  const h = harness('2026-09-25T19:44:00Z'); const p = play();
  seed(h, p, []);
  h.setFeed([{ ...p, eventTime: p.gameTime, warningKey: '', warning: '', warningTone: 'neutral', warningNegative: false }]);
  await h.syncPostedFootballMarkets('NCAAF');
  assert.equal(h.tables.odds_snapshot.length, 1);
  assert.equal(JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']).snapshotStatus, 'LIVE');
  h.setTime('2026-09-25T19:49:00Z');
  await h.syncPostedFootballMarkets('NCAAF');
  assert.equal(h.tables.odds_snapshot.length, 2);
  assert.equal(JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']).snapshotStatus, 'LIVE');
  h.setTime('2026-09-25T19:51:00Z');
  await h.syncPostedFootballMarkets('NCAAF');
  assert.equal(h.tables.odds_snapshot.length, 2);
  const final = JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(final.snapshotStatus, 'FINAL_PREGAME');
  assert.equal(final.frozenAt, '09/25/2026, 3:44:00 PM EDT');
});


test('NCAAF read and scheduled paths preserve compact canonical history despite alias rows', async () => {
  const h = harness('2026-09-26T17:05:00Z'); // 1:05 PM ET, five minutes after kickoff.
  const short = {
    ...play('2026-09-26T13:00:00-04:00'),
    date: '2026-09-26',
    game: 'Sam Houston at Texas Tech',
    gameKey: '2026-09-26|sam houston|texas tech',
    awayTeam: 'Sam Houston',
    homeTeam: 'Texas Tech',
    snapshotStatus: 'LIVE',
    updatedAt: '09/26/2026, 10:00:00 AM EDT',
    frozenAt: undefined,
  };
  const full = {
    ...short,
    game: 'Sam Houston Bearkats at Texas Tech Red Raiders',
    gameKey: '2026-09-26|sam houston bearkats|texas tech red raiders',
    awayTeam: 'Sam Houston Bearkats',
    homeTeam: 'Texas Tech Red Raiders',
    snapshotStatus: 'FINAL_PREGAME',
    updatedAt: '09/26/2026, 12:44:00 PM EDT',
    frozenAt: '09/26/2026, 12:44:00 PM EDT',
  };

  h.tables.odds_snapshot = [
    observation(short, '09/26/2026, 10:00:00 AM EDT'),
    observation(short, '09/26/2026, 11:00:00 AM EDT', { Line: '49.5', 'Bets %': '58' }),
    observation(short, '09/26/2026, 12:00:00 PM EDT', { Line: '50.5', 'Bets %': '62' }),
    observation(full, '09/26/2026, 12:44:00 PM EDT', { Line: '51.5', 'Bets %': '66' }),
  ];
  // Current collectors persist the canonical game's history with each play;
  // scheduled refreshes no longer hydrate it from the raw archive.
  h.tables.weekly_market_trends = [
    h.timing.weeklyRow({ ...short, movementHistory: persistedHistory(h.tables.odds_snapshot) }),
    h.timing.weeklyRow({ ...full, movementHistory: persistedHistory(h.tables.odds_snapshot) }),
  ];
  h.tables.schedule = [{
    Date: '2026-09-26',
    'Away Team': 'Sam Houston Bearkats',
    'Home Team': 'Texas Tech Red Raiders',
    'Game Time': '2026-09-26T13:00:00-04:00',
  }];

  const result = await h.readWeeklyFootballMarket('NCAAF');
  assert.equal(result.trendPlays.length, 1);
  assert.equal(result.trendPlays[0].awayTeam, 'Sam Houston Bearkats');
  assert.equal(result.trendPlays[0].homeTeam, 'Texas Tech Red Raiders');
  assert.equal(result.trendPlays[0].snapshotStatus, 'FINAL_PREGAME');
  assert.equal(result.trendPlays[0].updatedAt, '09/26/2026, 12:44:00 PM EDT');
  assert.equal(result.trendPlays[0].firstTrackedAt, '09/26/2026, 10:00:00 AM EDT');
  assert.deepEqual(
    Array.from(result.trendPlays[0].movementHistory, (point) => point.snapshotTime),
    [
      '09/26/2026, 10:00:00 AM EDT',
      '09/26/2026, 11:00:00 AM EDT',
      '09/26/2026, 12:00:00 PM EDT',
      '09/26/2026, 12:44:00 PM EDT',
    ],
  );

  // The scheduled tracker must persist that complete path into Details JSON so
  // the public NCAAF route can remain on its fast no-hydration read.
  h.setFeed([]);
  await h.syncPostedFootballMarkets('NCAAF');
  const fast = await h.readWeeklyFootballMarket('NCAAF', {
    dateKeys: ['2026-09-26'],
    hydrateHistory: false,
  });
  assert.equal(fast.trendPlays.length, 1);
  assert.deepEqual(
    Array.from(fast.trendPlays[0].movementHistory, (point) => point.snapshotTime),
    [
      '09/26/2026, 10:00:00 AM EDT',
      '09/26/2026, 11:00:00 AM EDT',
      '09/26/2026, 12:00:00 PM EDT',
      '09/26/2026, 12:44:00 PM EDT',
    ],
  );
});

test('source kickoff survives real mapping, persistence, fast reads and lock when schedule time is unknown', async () => {
  const h = harness('2026-10-03T16:44:00Z', true);
  const p = { ...play(''), date: '2026-10-03', gameKey: '2026-10-03|army|temple',
    snapshotStatus: 'LIVE', frozenAt: undefined, updatedAt: '10/03/2026, 12:40:00 PM EDT' };
  seed(h, p, []);
  h.tables.schedule[0]['Game Time'] = '00:00';
  h.setFeed([{ ...p, eventTime: '13:00', sourceUrl: 'https://www.scoresandodds.com/ncaaf/consensus-picks' }]);
  await h.syncPostedFootballMarkets('NCAAF');
  let stored = JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.sourceKickoff, '2026-10-03T17:00:00.000Z');
  assert.equal(stored.gameTime, stored.sourceKickoff);
  const fast = await h.readWeeklyFootballMarket('NCAAF', { hydrateHistory: false });
  assert.equal(fast.trendPlays[0].gameTime, stored.sourceKickoff);
  h.setTime('2026-10-03T16:51:00Z');
  await h.syncPostedFootballMarkets('NCAAF');
  stored = JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.snapshotStatus, 'FINAL_PREGAME');
  assert.equal(stored.frozenAt, '10/03/2026, 12:44:00 PM EDT');
  assert.equal(h.tables.odds_snapshot.length, 1);
  // After the source removes the game, the verified clock still controls reads.
  h.setFeed([]);
  const read = await h.readWeeklyFootballMarket('NCAAF');
  assert.equal(read.trendPlays[0].snapshotStatus, 'FINAL_PREGAME');
  assert.equal(read.trendPlays[0].gameTime, stored.sourceKickoff);
});

test('source date guard preserves canonical fallback and verified midnight differs from a placeholder', async () => {
  const h = harness('2026-10-03T16:44:00Z', true);
  const p = { ...play(''), date: '2026-10-03', gameKey: '2026-10-03|army|temple' };
  seed(h, p, []);
  h.setFeed([{ ...p, date: '2026-10-04', eventTime: '13:00' }]);
  const mapped = await h.timing.loadPostedSplits('NCAAF', h.tables.schedule);
  assert.equal(mapped.splits[0].date, p.date);
  assert.equal(mapped.splits[0].eventTime, '');
  assert.equal(mapped.splits[0].sourceKickoff, undefined);
  const midnight = '2026-10-04T04:00:00.000Z';
  assert.equal(h.timing.ncaafKickoffEpoch('2026-10-04', midnight, midnight), Date.parse(midnight));
  assert.ok(Number.isNaN(h.timing.ncaafKickoffEpoch('2026-10-04', midnight)));
  h.tables.weekly_market_trends = [h.timing.weeklyRow({ ...p, sourceKickoff: '2026-10-02T17:00:00.000Z' })];
  const read = await h.readWeeklyFootballMarket('NCAAF', { hydrateHistory: false });
  assert.equal(read.trendPlays[0].gameTime, '');
});

test('verified schedule overrides a one-hour source error in mapping, reads and final locks', async () => {
  const kickoff = '2026-11-01T02:00:00.000Z';
  const h = harness('2026-11-01T00:44:00Z', true, [{ date: kickoff, competitions: [{ date: kickoff,
    competitors: [{ homeAway: 'away', team: { shortDisplayName: 'Army' } },
      { homeAway: 'home', team: { shortDisplayName: 'Temple' } }] }] }]);
  const p = { ...play(kickoff), date: '2026-10-31', gameKey: '2026-10-31|army|temple',
    gameTime: '2026-11-01T01:00:00.000Z', sourceKickoff: '2026-11-01T01:00:00.000Z',
    snapshotStatus: 'LIVE', frozenAt: undefined, updatedAt: '10/31/2026, 8:40:00 PM EDT' };
  seed(h, p, []);
  h.setFeed([{ ...p, eventTime: '21:00' }]);
  await h.syncPostedFootballMarkets('NCAAF');
  let stored = JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.gameTime, kickoff);
  const display = await h.readWeeklyFootballMarket('NCAAF', { hydrateHistory: false });
  assert.equal(display.trendPlays[0].gameTime, kickoff);
  h.setTime('2026-11-01T00:51:00Z');
  await h.syncPostedFootballMarkets('NCAAF');
  stored = JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.snapshotStatus, 'LIVE', 'the erroneous source clock must not finalize an hour early');
  h.setTime('2026-11-01T01:44:00Z');
  await h.syncPostedFootballMarkets('NCAAF');
  h.setTime('2026-11-01T01:51:00Z');
  await h.syncPostedFootballMarkets('NCAAF');
  stored = JSON.parse(h.tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.snapshotStatus, 'FINAL_PREGAME');
  assert.equal(stored.frozenAt, '10/31/2026, 9:44:00 PM EDT');
});

test('Eastern kickoff conversion follows the game date across the fall clock change', () => {
  const h = harness();
  assert.equal(h.nflKickoffIso('2026-10-31', '7:30 PM ET'), '2026-10-31T23:30:00.000Z');
  assert.equal(h.nflKickoffIso('2026-11-01', '1:00 PM ET'), '2026-11-01T18:00:00.000Z');
});
