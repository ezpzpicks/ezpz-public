const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), ts = require('typescript');
const { parseHTML } = require('linkedom');
const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true });
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');

function harness() {
  const api = {}, requests = [];
  const source = fs.readFileSync(path.join(__dirname, '../app/FullSlateHistory.tsx'), 'utf8').replace('<style jsx>', '<style>');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports: api, Date, Intl, AbortController, require, fetch: (url, { signal }) =>
    new Promise(resolve => requests.push({ url, signal, resolve })) });
  const root = createRoot(document.getElementById('root'));
  const render = (sport, data) => act(async () => root.render(React.createElement(api.default, { sport, data }, (view, historical) =>
    React.createElement('article', { 'data-date': view.today, 'data-historical': historical, 'data-live-market': view.draftKings?.status },
      view.slateToday.map(row => row.Game).join('|')))));
  const choose = day => act(async () => {
    const select = document.querySelector('select');
    select[Object.keys(select).find(key => key.startsWith('__reactProps'))].onChange({ target: { value: day } });
  });
  const resolve = (request, value, ok = true) => act(async () => request.resolve({ ok, json: async () => value }));
  const click = element => act(async () => element.dispatchEvent(new window.Event('click', { bubbles: true })));
  return { requests, render, choose, resolve, click, root };
}
const current = { today: '2026-10-29', slateToday: [{ Game: 'Current game' }], draftKings: { status: 'LIVE' } };
const saved = (day, game) => ({ ok: true, sport: 'NFL', today: day, slateToday: [{ Game: game }], historicalSlate: true,
  footballWeeklyMarket: { ok: true, games: [], splits: [] } });

test('date switching loads the requested saved slate, guards races and failures, and returns to current data without a history request', async () => {
  const h = harness();
  try {
    await h.render('NFL', current);
    assert.equal(document.querySelector('article').textContent, 'Current game');
    assert.deepEqual(h.requests.map(r => r.url), ['/api/slate-history?sport=NFL']);
    await h.resolve(h.requests[0], { ok: true, sport: 'NFL', availableDates: ['2026-10-18', '2026-10-25', '2026-10-11'] });
    assert.deepEqual([...document.querySelectorAll('option')].map(option => option.value), ['2026-10-29', '2026-10-25', '2026-10-18', '2026-10-11']);
    await h.choose('2026-10-25');
    assert.equal(document.querySelector('article'), null, 'current slate disappears while a past date loads');
    assert.match(document.querySelector('[role=status]').textContent, /Loading saved projections/);
    await h.resolve(h.requests.at(-1), saved('2026-10-25', 'Saved game'));
    assert.equal(document.querySelector('article').textContent, 'Saved game');
    assert.equal(document.querySelector('article').getAttribute('data-date'), '2026-10-25');
    assert.equal(document.querySelector('article').getAttribute('data-live-market'), null);
    const count = h.requests.length;
    await h.render('NFL', { ...current, slateToday: [{ Game: 'Updated current game' }] });
    assert.equal(h.requests.length, count, 'background board updates do not refetch or reset the selected archive');
    assert.equal(document.querySelector('article').textContent, 'Saved game');

    await h.choose('2026-10-18');
    const older = h.requests.at(-1);
    await h.choose('2026-10-11');
    const newer = h.requests.at(-1);
    assert.equal(older.signal.aborted, true);
    await h.resolve(newer, saved('2026-10-11', 'Selected archive'));
    await h.resolve(older, saved('2026-10-18', 'Late response'));
    assert.equal(document.querySelector('article').textContent, 'Selected archive');

    await h.choose('2026-10-25');
    await h.resolve(h.requests.at(-1), { ok: false }, false);
    assert.equal(document.querySelector('article'), null);
    assert.match(document.querySelector('[role=alert]').textContent, /could not be loaded/);
    await h.click(document.querySelector('[role=alert] button'));
    await h.resolve(h.requests.findLast(r => r.url.includes('&date=2026-10-25')), saved('2026-10-25', 'Recovered archive'));
    assert.equal(document.querySelector('article').textContent, 'Recovered archive');

    const beforeReturn = h.requests.length;
    await h.choose(current.today);
    assert.equal(document.querySelector('article').textContent, 'Updated current game');
    assert.equal(document.querySelector('article').getAttribute('data-live-market'), 'LIVE');
    assert.equal(h.requests.length, beforeReturn);

    await h.choose('2026-10-18');
    const pending = h.requests.at(-1);
    await h.render('NCAAF', { today: current.today, slateToday: [{ Game: 'College game' }] });
    assert.equal(pending.signal.aborted, true);
    assert.equal(document.querySelector('select').getAttribute('aria-label'), 'View NCAAF full slate');
    assert.equal(document.querySelector('article').textContent, 'College game');
    assert.deepEqual([...document.querySelectorAll('option')].map(option => option.value), [current.today]);
  } finally { await act(async () => h.root.unmount()); }
});
