const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { parseHTML } = require('linkedom');
const load = require('./load-typescript.cjs');
const { api: trial, game, plain } = require('./selection-trial-fixtures.cjs');
const context = load(path.resolve(__dirname, '../lib/matchupContext.ts'));
const source = fs.readFileSync(path.resolve(__dirname, '../app/MatchupContextPanel.tsx'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source + '\nexport const testGame = MatchupGame;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: exportsObject, Date, Intl, Map, require });

test('all four choices stay visible while tapping a choice switches the grouped evidence', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = window; global.document = window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  const root = createRoot(window.document.getElementById('root'));
  const date = '2026-11-07', now = trial.trialDayStart(date) + 10 * 3600000;
  const model = context.buildContextModel('NBA', date, [], now);
  const sides = game(date, 0, { recorded: false, status: 'LIVE', snapshotAt: new Date(now).toISOString() });
  const [review] = context.buildContextPreviews(model, sides, [], now);
  review.cases = review.cases.map((item, i) => ({ ...item, missing: [], disagreements: ['Line movement and team trends point in opposite directions'],
    evidence: [{ label: 'Home · Last 5 ATS', value: i === 3 ? '1-4-0' : '4-1-0', sample: 5, direction: i === 3 ? 'Opposes' : 'Supports' },
      { label: 'Away · Last 5 ATS', value: '3-2-0', sample: 5, direction: 'Supports' },
      { label: 'Current betting split', value: '30% tickets · 60% money', sample: null, direction: 'Supports' },
      { label: 'Saved model', value: 'B · edge 2.1234567 points at this line', sample: null, direction: 'Supports' }],
    metrics: { tickets: 30, money: 60, moneyGap: 30, openingLine: 220, teamScore: 90, modelEdge: 2.1234567,
      modelProjection: 224, activeSignals: ['money', 'team'] } }));
  const original = plain(review);
  try {
    await React.act(async () => { root.render(React.createElement(exportsObject.testGame, { game: review })); });
    const doc = window.document, pane = () => doc.querySelector('.mc-selected-evidence');
    assert.equal(doc.querySelectorAll('.mc-choice-card').length, 4);
    assert.equal(doc.querySelectorAll('[aria-pressed="true"]').length, 1);
    assert.match(pane().textContent, /Team records/);
    assert.match(pane().textContent, /Betting splits & line movement/);
    assert.match(pane().textContent, /Model evidence/);
    assert.match(pane().textContent, /What conflicts/);
    assert.match(pane().textContent, /4-1-0/);
    assert.doesNotMatch(pane().textContent, /2\.1234567/);
    const under = doc.querySelector('[aria-label="Show evidence for Under 220.5"]');
    await React.act(async () => { under.dispatchEvent(new window.Event('click', { bubbles: true })); });
    assert.equal(under.getAttribute('aria-pressed'), 'true');
    assert.equal(pane().getAttribute('aria-label'), 'Evidence for Under 220.5');
    assert.match(pane().textContent, /1-4-0/);
    assert.equal(doc.querySelectorAll('.mc-choice-card').length, 4);
    assert.equal(doc.querySelectorAll('[aria-pressed="true"]').length, 1);
    assert.deepEqual(plain(review), original);
  } finally {
    await React.act(async () => { root.unmount(); });
    global.window = previous.window; global.document = previous.document; global.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
