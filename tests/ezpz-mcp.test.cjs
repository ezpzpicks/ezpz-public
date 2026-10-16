const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { createHmac } = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const start = Date.parse('2026-10-12T23:55:00Z');
const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
const callback = 'https://chatgpt.com/mcp-events/callback_test';
const rawPick = {
  date: '2026-10-12', game: 'BUF @ LAR', gameKey: 'buf-lar', market: 'Total', selection: 'Over 54.5',
  line: 54.5, odds: '-110', gameTime: '2026-10-13T00:15:00Z', snapshotStatus: 'FINAL_PREGAME',
  lockedAt: '2026-10-13T00:00:00Z', selected: true, protectionStatus: 'PASSED', result: '',
  tier: 'Total: Money Majority 60% Follow - Over', rankingLastSeven: { record: '5-2-0', wins: 5, losses: 2, pushes: 0 },
};

function harness({ realCurrentPicks = false } = {}) {
  let clock = start;
  let acceptance = 200;
  let badChallenge = false;
  let addresses = [{ address: '104.18.34.172', family: 4 }];
  let dnsCalls = 0;
  let failSnapshotWrite = false;
  const sends = [], sockets = [], snapshots = {};
  const datasets = new Map();
  const database = new DatabaseSync(':memory:');
  const cache = new Map();
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const stubs = {
    './tursoStore': {
      isTursoConfigured: () => true,
      readTursoDataset: async (sport, dataset) => datasets.get(`${sport}:${dataset}`) || [],
      replaceTursoDataset: async (sport, dataset, rows) => {
        if (failSnapshotWrite) throw new Error('snapshot write failed');
        datasets.set(`${sport}:${dataset}`, rows);
      },
      runTursoSql: async statements => statements.map(sql => database.prepare(sql).all().map(row =>
        Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)])))),
    },
    './ezpzCurrentPicks': { readEzpzCurrentPicks: async sport => snapshots[sport] || null },
    'node:dns/promises': { lookup: async () => { dnsCalls++; return addresses; } },
    'node:https': { request: (url, options, respond) => {
      sockets.push(options);
      const req = new EventEmitter();
      req.destroy = error => { req.emit('error', error); req.emit('close'); return req; };
      req.end = body => {
        const payload = JSON.parse(body);
        sends.push({ url: String(url), headers: options.headers, payload, body });
        queueMicrotask(() => {
          const res = new EventEmitter();
          res.statusCode = payload.type === 'verification' ? 200 : acceptance;
          res.destroy = error => { res.emit('error', error); req.emit('close'); };
          respond(res);
          const text = payload.type === 'verification' ? JSON.stringify({ challenge: badChallenge ? 'wrong' : payload.challenge }) : '{}';
          res.emit('data', Buffer.from(text)); res.emit('end'); req.emit('close');
        });
      };
      return req;
    } },
  };
  if (realCurrentPicks) delete stubs['./ezpzCurrentPicks'];
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename);
    const exports = {}; cache.set(filename, exports);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
      exports, Buffer, URL, Date: Clock, Intl, console: { ...console, warn: () => {}, info: () => {} }, process,
      setTimeout, clearTimeout, queueMicrotask, Promise, TextDecoder, Request, Response, Headers,
      require: name => stubs[name] || (name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : require(name)),
    }, { filename });
    return exports;
  }
  return {
    load, database, sends, sockets, snapshots,
    now: () => clock, setTime: value => { clock = value; }, setStatus: value => { acceptance = value; },
    setBadChallenge: value => { badChallenge = value; }, setAddresses: value => { addresses = value; }, dnsCalls: () => dnsCalls,
    setFailSnapshotWrite: value => { failSnapshotWrite = value; },
    subscription: () => ({ name: 'ezpz.pick.finalized', arguments: { sports: ['NFL'] }, delivery: { mode: 'webhook', url: callback, secret } }),
    events: () => sends.filter(item => !item.payload.type),
  };
}

test('MCP discovery lists read-only tools and the final-pick event without touching the database', async () => {
  const h = harness(), api = h.load('lib/ezpzMcp.ts');
  const discover = await api.handleEzpzMcp({ jsonrpc: '2.0', id: 1, method: 'server/discover' });
  assert.ok(discover.result.supportedVersions.includes('2026-07-28'));
  assert.ok(discover.result.capabilities.events);
  const tools = await api.handleEzpzMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(tools.result.tools.length, 2);
  assert.ok(tools.result.tools.every(tool => tool.annotations.readOnlyHint));
  const events = await api.handleEzpzMcp({ jsonrpc: '2.0', id: 3, method: 'events/list' });
  assert.equal(events.result.events[0].name, 'ezpz.pick.finalized');
  assert.equal(h.database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n, 0);
});

test('only fresh selected finalized picks are eligible; LIVE and expired feeds cannot look like no picks', async () => {
  const h = harness(), api = h.load('lib/ezpzMcp.ts');
  h.setTime(Date.parse('2026-10-13T00:00:30Z'));
  h.snapshots.NFL = { updatedAt: new Date(h.now()).toISOString(), picks: [rawPick, { ...rawPick, gameKey: 'live', snapshotStatus: 'LIVE' }] };
  const response = await api.handleEzpzMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_ezpz_picks', arguments: { sport: 'NFL' } } });
  assert.equal(response.result.structuredContent.picks.length, 1);
  assert.equal(response.result.structuredContent.picks[0].lastSeven.record, '5-2-0');
  h.snapshots.NFL.sourceStale = true;
  h.snapshots.NFL.picks = [{ ...rawPick, snapshotStatus: 'LIVE' }];
  const unhealthy = await api.handleEzpzMcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_ezpz_picks', arguments: { sport: 'NFL' } } });
  assert.equal(unhealthy.result.isError, true);
  h.snapshots.NFL.sourceStale = false;
  h.snapshots.NFL.picks = [rawPick];
  h.snapshots.NFL.updatedAt = new Date(h.now() - 21 * 60_000).toISOString();
  const stale = await api.handleEzpzMcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_ezpz_picks', arguments: { sport: 'NFL' } } });
  assert.equal(stale.result.isError, true);
  assert.equal(stale.result.structuredContent.unavailableSports[0], 'NFL');
});

test('fresh verified NFL and NCAAF final captures stay readable when unrelated live markets fail', async () => {
  for (const sport of ['NFL', 'NCAAF']) {
    const h = harness(), api = h.load('lib/ezpzMcp.ts');
    h.setTime(Date.parse('2026-10-13T00:00:30Z'));
    h.snapshots[sport] = { sourceStale: true, updatedAt: new Date(h.now()).toISOString(),
      picks: [rawPick, { ...rawPick, gameKey: 'live', snapshotStatus: 'LIVE' },
        { ...rawPick, gameKey: 'unverified', lockedAt: '' }] };
    const response = await api.readMcpPicks([sport]);
    assert.equal(response.unavailableSports.length, 0);
    assert.equal(response.picks.length, 1);
    assert.equal(response.picks[0].selection, rawPick.selection);
    assert.equal(response.picks[0].lastSeven.record, '5-2-0');
    const verified = await api.handleEzpzMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_finalized_pick', arguments: { pickId: response.picks[0].pickId } } });
    assert.equal(verified.result.structuredContent.pick.eligibleForPosting, true);
    h.snapshots[sport].updatedAt = new Date(h.now() - 21 * 60_000).toISOString();
    assert.equal((await api.readMcpPicks([sport])).unavailableSports[0], sport);
  }
});

test('stale LIVE, missing or invalid frozen captures and MLB fallback remain unavailable', async () => {
  for (const variant of [
    { ...rawPick, snapshotStatus: 'LIVE' },
    { ...rawPick, lockedAt: '' },
    { ...rawPick, lockedAt: 'invalid' },
    { ...rawPick, lockedAt: '2026-10-12T23:45:00Z' },
    { ...rawPick, lockedAt: '2026-10-13T00:06:00Z' },
    { ...rawPick, selected: false },
    { ...rawPick, protectionStatus: 'BLOCKED' },
  ]) {
    const h = harness(), api = h.load('lib/ezpzMcp.ts');
    h.setTime(Date.parse('2026-10-13T00:00:30Z'));
    h.snapshots.NFL = { sourceStale: true, updatedAt: new Date(h.now()).toISOString(), picks: [variant] };
    assert.equal((await api.readMcpPicks(['NFL'])).unavailableSports[0], 'NFL');
  }
  const h = harness(), api = h.load('lib/ezpzMcp.ts');
  h.setTime(Date.parse('2026-10-13T00:00:30Z'));
  h.snapshots.MLB = { sourceStale: true, updatedAt: new Date(h.now()).toISOString(), picks: [rawPick] };
  assert.equal((await api.readMcpPicks(['MLB'])).unavailableSports[0], 'MLB');
});

test('persisting a verified final football pick during fallback emits one signed event and verifies the saved decision', async () => {
  const h = harness({ realCurrentPicks: true });
  const events = h.load('lib/ezpzMcpEvents.ts'), current = h.load('lib/ezpzCurrentPicks.ts'), mcp = h.load('lib/ezpzMcp.ts');
  await events.subscribeFinalPicks(h.subscription());
  h.setTime(Date.parse('2026-10-13T00:05:30Z'));
  const policy = h.load('lib/nflEzpzPolicy.ts');
  const pick = { ...rawPick, lockedAt: '2026-10-12T23:56:35Z',
    source: 'Trend Play', selectorVersion: policy.NFL_EZPZ_POLICY_VERSION, trendSubtypeId: 'catalog:test' };
  const payload = { today: '2026-10-12', draftKings: { stale: true, displayMode: 'STALE_FALLBACK' },
    aiPicks: [pick, { ...pick, gameKey: 'live', snapshotStatus: 'LIVE' }, { ...pick, gameKey: 'unverified', lockedAt: '' }] };
  await current.persistEzpzCurrentPicks('NFL', payload);
  await current.persistEzpzCurrentPicks('NFL', payload);
  assert.equal(h.events().length, 1);
  assert.equal(h.events()[0].payload.data.pick.finalizedAt, '2026-10-12T23:56:35.000Z');
  const saved = await current.readEzpzCurrentPicks('NFL');
  assert.equal(saved.sourceStale, true);
  assert.equal(saved.picks.length, 3);
  const verified = await mcp.handleEzpzMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'get_finalized_pick', arguments: { pickId: h.events()[0].payload.data.pick.pickId } } });
  assert.equal(verified.result.structuredContent.pick.eligibleForPosting, true);
  assert.equal(verified.result.structuredContent.pick.selection, rawPick.selection);
  assert.equal(verified.result.structuredContent.pick.lastSeven.record, '5-2-0');
  h.setTime(Date.parse(rawPick.gameTime));
  await current.persistEzpzCurrentPicks('NFL', payload);
  assert.equal(h.events().length, 1);
  const started = await mcp.readMcpPicks(['NFL'], false);
  assert.equal(started.picks[0].eligibleForPosting, false);
  assert.equal((await mcp.readMcpPicks(['NFL'])).picks.length, 0);
});

function teamPick(changes = {}) {
  return { ...rawPick, strategyVersion: 'team-trend-test-2026-10-15-v1', threshold: 75,
    savedAt: '2026-10-13T00:00:00Z', teamTrendScore: { score: 81.25, mode: 'locked' }, ...changes };
}

function capturedRecord(label, record) {
  return { label, record, sample: record.split('-').reduce((n, value) => n + Number(value), 0) };
}
const capturedTeams = [
  { team: 'New York Jets', records: {
    betType: capturedRecord('Underdog ATS', '3-1-1'), venue: capturedRecord('Away ATS', '1-0-1'),
    recent: capturedRecord('Last 5 ATS', '3-1-1'),
  } },
  { team: 'Buffalo Bills', opposing: true, records: {
    betType: capturedRecord('Favorite ATS', '0-4-0'), venue: capturedRecord('Home ATS', '0-2-0'),
    recent: capturedRecord('Last 5 ATS', '0-4-0'),
  } },
];

test('both football categories persist, verify, and deliver independently without changing public IDs', async () => {
  for (const sport of ['NFL', 'NCAAF']) {
    const h = harness({ realCurrentPicks: true });
    const events = h.load('lib/ezpzMcpEvents.ts'), current = h.load('lib/ezpzCurrentPicks.ts');
    const mcp = h.load('lib/ezpzMcp.ts'), normalize = h.load('lib/ezpzMcpPicks.ts');
    const subscription = h.subscription(); subscription.arguments.sports = [sport];
    await events.subscribeFinalPicks(subscription);
    h.setTime(Date.parse('2026-10-13T00:00:30Z'));
    const version = h.load(`lib/${sport === 'NFL' ? 'nfl' : 'ncaaf'}EzpzPolicy.ts`)[`${sport}_EZPZ_POLICY_VERSION`];
    const catalog = h.load('lib/footballTrendCatalog.ts').footballCatalog(sport);
    const rule = catalog.rules.find(r => r.market.toLowerCase() === 'total');
    const publicPick = { ...rawPick, source: 'Trend Play', selectorVersion: version,
      trendSubtypeId: `catalog:${catalog.version}:${rule.id}:0:|over` };
    const payload = { today: '2026-10-12', aiPicks: [publicPick],
      teamTrendTestPicks: [teamPick({ teamTrendScore: { score: 81.25, mode: 'locked', teams: capturedTeams } })] };
    await current.persistEzpzCurrentPicks(sport, payload);
    await current.persistEzpzCurrentPicks(sport, payload);
    const saved = await current.readEzpzCurrentPicks(sport);
    assert.equal(saved.picks.length, 1); assert.equal(saved.teamTrendPicks.length, 1);
    assert.equal(saved.pickCount, 1, 'legacy public reader count stays public-only');
    const feed = await mcp.readMcpPicks([sport]);
    assert.equal(feed.picks.length, 2); assert.equal(h.events().length, 2);
    // Existing installed connections reject fields outside their original
    // event schema. Resolve the richer metadata through the verified ID.
    const eventKeys = ['pickId', 'sport', 'date', 'game', 'market', 'selection', 'line', 'odds',
      'gameTime', 'pickType', 'lastSeven', 'snapshotStatus', 'finalizedAt', 'eligibleForPosting', 'sourceUrl'].sort();
    for (const event of h.events()) assert.deepEqual(Object.keys(event.payload.data.pick).sort(), eventKeys);
    const publicResult = feed.picks.find(p => p.pickCategory === 'public_bet_trend');
    const teamResult = feed.picks.find(p => p.pickCategory === 'team_trend');
    assert.equal(publicResult.pickId, normalize.stablePickId(sport, rawPick));
    assert.notEqual(teamResult.pickId, publicResult.pickId);
    assert.equal(publicResult.pickLabel, 'EZPZ Public Bet Trend');
    assert.equal(teamResult.pickLabel, 'EZPZ Team Trend');
    assert.equal(teamResult.teamTrendScore, 81.25);
    assert.equal(publicResult.teamTrendRecords, null);
    assert.equal(teamResult.teamTrendRecords[0].betType.record, '3-1-1');
    assert.equal(teamResult.teamTrendRecords[0].venue.label, 'Away ATS');
    assert.equal(teamResult.teamTrendRecords[1].betType.record, '0-4-0', 'opponent actual losses must not become wins');
    assert.equal(teamResult.lastSeven, null, 'never copy public or team-history records to the team strategy');
    assert.equal(teamResult.finalizedAt, '2026-10-13T00:00:00.000Z');
    const verified = await mcp.handleEzpzMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_finalized_pick', arguments: { pickId: teamResult.pickId } } });
    assert.equal(verified.result.structuredContent.pick.eligibleForPosting, true);
    assert.equal(verified.result.structuredContent.pick.selection, rawPick.selection);
    assert.deepEqual(JSON.parse(JSON.stringify(verified.result.structuredContent.pick.teamTrendRecords)),
      JSON.parse(JSON.stringify(teamResult.teamTrendRecords)));
    assert.equal(normalize.stablePickId(sport, { ...saved.teamTrendPicks[0], selection: 'Over 55.5', line: 55.5 }), teamResult.pickId);
  }
});

test('team records preserve total direction and no-sample dashes without fabricating missing records', () => {
  const h = harness(), api = h.load('lib/ezpzMcpPicks.ts');
  const normalize = teams => api.normalizeMcpPick('NCAAF', teamPick({ pickCategory: 'team_trend',
    teamTrendScore: { score: 81.25, mode: 'locked', teams } }), Date.parse('2026-10-13T00:00:30Z'));
  const teams = capturedTeams.map(t => ({ ...t, records: {
    betType: capturedRecord('Overall Under', '4-1-0'), venue: capturedRecord('Neutral Under', '0-0-0'),
    recent: capturedRecord('Last 5 Under', '4-1-0'),
  } }));
  const result = normalize(teams);
  assert.equal(result.teamTrendRecords[0].betType.label, 'Overall Under');
  assert.equal(result.teamTrendRecords[0].venue.record, null);
  assert.equal(result.teamTrendRecords[0].venue.sample, 0);
  assert.equal(normalize(undefined).teamTrendRecords, null);
  const invalid = JSON.parse(JSON.stringify(teams)); invalid[0].records.recent.record = '2-2-0';
  assert.equal(normalize(invalid).teamTrendRecords, null);
});

test('only saved team finals can notify; previews, unsupported rules, late or invalid captures cannot', async () => {
  const h = harness({ realCurrentPicks: true });
  const events = h.load('lib/ezpzMcpEvents.ts'), current = h.load('lib/ezpzCurrentPicks.ts'), mcp = h.load('lib/ezpzMcp.ts');
  await events.subscribeFinalPicks(h.subscription()); h.setTime(Date.parse('2026-10-13T00:00:30Z'));
  const variants = [teamPick({ snapshotStatus: 'LIVE', savedAt: '', teamTrendScore: { score: 81.25, mode: 'preview' } }),
    teamPick({ savedAt: '' }), teamPick({ savedAt: rawPick.gameTime }),
    teamPick({ savedAt: '2026-10-12T23:00:00Z' }), teamPick({ savedAt: '2026-10-13T00:01:00Z' }),
    teamPick({ threshold: 70 }), teamPick({ strategyVersion: 'unknown' }),
    teamPick({ teamTrendScore: { score: 74.99, mode: 'locked' } }),
    teamPick({ teamTrendScore: { score: null, mode: 'locked' } }),
    teamPick({ teamTrendScore: { score: 100, mode: 'preview' } }), teamPick({ result: 'W' })];
  await current.persistEzpzCurrentPicks('NFL', { today: rawPick.date, teamTrendTestPicks: variants });
  assert.equal(h.events().length, 0);
  assert.equal((await mcp.readMcpPicks(['NFL'])).picks.length, 0);
  await current.persistEzpzCurrentPicks('MLB', { today: rawPick.date, teamTrendTestPicks: [teamPick()] });
  assert.equal((await current.readEzpzCurrentPicks('MLB')).teamTrendPicks.length, 0);
});

test('a team-only slate uses saved final evidence during fallback and becomes ineligible at kickoff', async () => {
  const h = harness({ realCurrentPicks: true });
  const events = h.load('lib/ezpzMcpEvents.ts'), current = h.load('lib/ezpzCurrentPicks.ts'), mcp = h.load('lib/ezpzMcp.ts');
  await events.subscribeFinalPicks(h.subscription()); h.setTime(Date.parse('2026-10-13T00:00:30Z'));
  const payload = { today: rawPick.date, stale: true, teamTrendTestPicks: [teamPick()] };
  await current.persistEzpzCurrentPicks('NFL', payload);
  assert.equal(h.events().length, 1);
  const feed = await mcp.readMcpPicks(['NFL']);
  assert.equal(feed.unavailableSports.length, 0); assert.equal(feed.picks.length, 1);
  h.setTime(Date.parse(rawPick.gameTime));
  await current.persistEzpzCurrentPicks('NFL', payload);
  assert.equal(h.events().length, 1);
  assert.equal((await mcp.readMcpPicks(['NFL'])).picks.length, 0);
  assert.equal((await mcp.readMcpPicks(['NFL'], false)).picks[0].eligibleForPosting, false);
  h.setTime(h.now() + 21 * 60_000);
  assert.equal((await mcp.readMcpPicks(['NFL'], false)).unavailableSports[0], 'NFL');
});

test('a failed snapshot write cannot deliver an unverified team final', async () => {
  const h = harness({ realCurrentPicks: true });
  const events = h.load('lib/ezpzMcpEvents.ts'), current = h.load('lib/ezpzCurrentPicks.ts');
  await events.subscribeFinalPicks(h.subscription()); h.setTime(Date.parse('2026-10-13T00:00:30Z'));
  h.setFailSnapshotWrite(true);
  await assert.rejects(current.persistEzpzCurrentPicks('NFL', {
    today: rawPick.date, teamTrendTestPicks: [teamPick()],
  }), /snapshot write failed/);
  assert.equal(h.events().length, 0);
  assert.equal(await current.readEzpzCurrentPicks('NFL'), null);
});

test('callback signature matches Standard Webhooks; private destinations and redirects are not followed', async () => {
  const h = harness(), api = h.load('lib/ezpzMcpWebhook.ts');
  const body = '{"value":1}', timestamp = 1234567890;
  assert.equal(api.webhookSignature(secret, 'evt_1', timestamp, body),
    `v1,${createHmac('sha256', Buffer.alloc(32, 7)).update(`evt_1.${timestamp}.${body}`).digest('base64')}`);
  for (const bad of ['http://chatgpt.com/test', 'https://127.0.0.1/test', 'https://chatgpt.com.attacker.example/test', 'https://chatgpt.com:444/test']) {
    assert.throws(() => api.callbackUrl(bad));
  }
  for (const address of ['127.0.0.1', '10.0.0.1', '100.64.1.1', '169.254.169.254', '192.168.1.2', '::1', '::ffff:127.0.0.1', '2001:db8::1']) {
    assert.equal(api.isPublicAddress(address), false, address);
  }
  h.setAddresses([{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(api.postSignedWebhook(callback, secret, 'sub', 'event', {}), /non_public_address/);
  assert.equal(h.sockets.length, 0);
  h.setAddresses([{ address: '104.18.34.172', family: 4 }]); h.setStatus(302);
  const redirected = await api.postSignedWebhook(callback, secret, 'sub', 'event', {});
  assert.equal(redirected.status, 302); assert.equal(h.sockets.length, 1);
  let pinned;
  h.sockets[0].lookup('chatgpt.com', {}, (_error, address, family) => { pinned = [address, family]; });
  assert.deepEqual(pinned, ['104.18.34.172', 4]);
});

test('a bad callback challenge creates no subscription; refresh preserves one identity and re-verifies key rotation', async () => {
  const h = harness(), events = h.load('lib/ezpzMcpEvents.ts');
  h.setBadChallenge(true);
  await assert.rejects(events.subscribeFinalPicks(h.subscription()), /challenge_failed/);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM ezpz_mcp_subscriptions').get().n, 0);
  h.setBadChallenge(false);
  const first = await events.subscribeFinalPicks(h.subscription());
  const second = await events.subscribeFinalPicks(h.subscription());
  assert.equal(first.id, second.id);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM ezpz_mcp_subscriptions').get().n, 1);
  const before = h.sends.length;
  const rotated = h.subscription(); rotated.delivery.secret = `whsec_${Buffer.alloc(32, 8).toString('base64')}`;
  assert.equal((await events.subscribeFinalPicks(rotated)).id, first.id);
  assert.equal(h.sends.length, before + 1);
});

test('concurrent captures deliver a finalized pick once and ignore LIVE, blocked, settled, started and old final picks', async () => {
  const h = harness(), events = h.load('lib/ezpzMcpEvents.ts');
  await events.subscribeFinalPicks(h.subscription()); h.setTime(Date.parse('2026-10-13T00:00:30Z'));
  const variants = [rawPick,
    { ...rawPick, gameKey: 'live', snapshotStatus: 'LIVE' },
    { ...rawPick, gameKey: 'blocked', protectionStatus: 'BLOCKED' },
    { ...rawPick, gameKey: 'unselected', selected: false },
    { ...rawPick, gameKey: 'settled', result: 'W' },
    { ...rawPick, gameKey: 'started', gameTime: '2026-10-12T23:00:00Z' },
    { ...rawPick, gameKey: 'old-final', lockedAt: '2026-10-12T23:50:00Z' },
    { ...rawPick, gameKey: 'future-final', lockedAt: '2026-10-13T00:05:00Z' },
  ];
  await Promise.all([events.captureEzpzFinalPickEvents('NFL', variants), events.captureEzpzFinalPickEvents('NFL', variants)]);
  await events.captureEzpzFinalPickEvents('NFL', variants);
  assert.equal(h.events().length, 1);
  assert.equal(h.events()[0].payload.data.pick.selection, 'Over 54.5');
  assert.equal(h.database.prepare("SELECT COUNT(*) AS n FROM ezpz_mcp_deliveries WHERE status='delivered'").get().n, 1);
});

test('transient retries preserve event IDs and frozen content while using a new signature timestamp', async () => {
  const h = harness(), events = h.load('lib/ezpzMcpEvents.ts');
  await events.subscribeFinalPicks(h.subscription()); h.setTime(Date.parse('2026-10-13T00:00:30Z')); h.setStatus(503);
  await events.captureEzpzFinalPickEvents('NFL', [rawPick]);
  assert.equal(h.events().length, 1);
  h.setTime(h.now() + 5 * 60_000); h.setStatus(200);
  await events.captureEzpzFinalPickEvents('NFL', [{ ...rawPick, line: 55.5, selection: 'Over 55.5' }]);
  assert.equal(h.events().length, 2);
  assert.equal(h.events()[0].payload.eventId, h.events()[1].payload.eventId);
  assert.equal(h.events()[1].payload.data.pick.selection, 'Over 54.5');
  assert.notEqual(h.events()[0].headers['webhook-timestamp'], h.events()[1].headers['webhook-timestamp']);
});

test('410 disables a subscription, 413 is not retried, and retries stop at kickoff', async () => {
  for (const status of [410, 413, 503]) {
    const h = harness(), events = h.load('lib/ezpzMcpEvents.ts');
    await events.subscribeFinalPicks(h.subscription()); h.setTime(Date.parse('2026-10-13T00:00:30Z')); h.setStatus(status);
    await events.captureEzpzFinalPickEvents('NFL', [rawPick]);
    h.setTime(status === 503 ? Date.parse(rawPick.gameTime) : h.now() + 5 * 60_000); h.setStatus(200);
    await events.captureEzpzFinalPickEvents('NFL', [rawPick]);
    assert.equal(h.events().length, 1, String(status));
    if (status === 410) assert.equal(h.database.prepare('SELECT active FROM ezpz_mcp_subscriptions').get().active, 0);
  }
});

test('sport filters and unsubscription prevent delivery without exposing signing secrets through tools', async () => {
  const h = harness(), events = h.load('lib/ezpzMcpEvents.ts'), mcp = h.load('lib/ezpzMcp.ts');
  await events.subscribeFinalPicks(h.subscription()); h.setTime(Date.parse('2026-10-13T00:00:30Z'));
  await events.captureEzpzFinalPickEvents('NCAAF', [rawPick]);
  assert.equal(h.events().length, 0);
  await events.unsubscribeFinalPicks(h.subscription());
  await events.captureEzpzFinalPickEvents('NFL', [rawPick]);
  assert.equal(h.events().length, 0);
  h.snapshots.NFL = { updatedAt: new Date(h.now()).toISOString(), picks: [rawPick] };
  const response = await mcp.handleEzpzMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_ezpz_picks', arguments: { sport: 'NFL' } } });
  assert.ok(!JSON.stringify(response).includes('whsec_'));
});

test('HTTP endpoint handles modern discovery, rejects invalid origins and bounds streamed request bodies', async () => {
  const h = harness(), api = h.load('app/api/mcp/route.ts');
  const { NextRequest } = require('next/server');
  const response = await api.POST(new NextRequest('https://ezpzpicks.com/api/mcp', { method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover' }), headers: { 'Content-Type': 'application/json' } }));
  assert.equal(response.status, 200); assert.ok((await response.json()).result.capabilities.events);
  const rejected = await api.POST(new NextRequest('https://ezpzpicks.com/api/mcp', { method: 'POST', body: '{}', headers: { Origin: 'https://attacker.example' } }));
  assert.equal(rejected.status, 403);
  const large = await api.POST(new NextRequest('https://ezpzpicks.com/api/mcp', { method: 'POST', body: 'x'.repeat(20_000) }));
  assert.equal(large.status, 413);
});
