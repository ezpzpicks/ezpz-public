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

function harness() {
  let clock = start;
  let acceptance = 200;
  let badChallenge = false;
  let addresses = [{ address: '104.18.34.172', family: 4 }];
  let dnsCalls = 0;
  const sends = [], sockets = [], snapshots = {};
  const database = new DatabaseSync(':memory:');
  const cache = new Map();
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const stubs = {
    './tursoStore': {
      isTursoConfigured: () => true,
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
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename);
    const exports = {}; cache.set(filename, exports);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
      exports, Buffer, URL, Date: Clock, Intl, console: { ...console, warn: () => {} }, process,
      setTimeout, clearTimeout, queueMicrotask, Promise, TextDecoder, Request, Response, Headers,
      require: name => stubs[name] || (name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : require(name)),
    }, { filename });
    return exports;
  }
  return {
    load, database, sends, sockets, snapshots,
    now: () => clock, setTime: value => { clock = value; }, setStatus: value => { acceptance = value; },
    setBadChallenge: value => { badChallenge = value; }, setAddresses: value => { addresses = value; }, dnsCalls: () => dnsCalls,
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
  const unhealthy = await api.handleEzpzMcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_ezpz_picks', arguments: { sport: 'NFL' } } });
  assert.equal(unhealthy.result.isError, true);
  h.snapshots.NFL.sourceStale = false;
  h.snapshots.NFL.updatedAt = new Date(h.now() - 21 * 60_000).toISOString();
  const stale = await api.handleEzpzMcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_ezpz_picks', arguments: { sport: 'NFL' } } });
  assert.equal(stale.result.isError, true);
  assert.equal(stale.result.structuredContent.unavailableSports[0], 'NFL');
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
