const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup: render } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
function load(file, overrides = {}) {
  const api = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports: api, Date, Intl, URL, console, AbortSignal, ...overrides, require: name => overrides.imports?.[name] || (name.startsWith('.') ? load(path.resolve(path.dirname(file), name+'.ts')) : require(name)) });
  return api;
}
const source = load(path.join(root, 'lib/ncaamLineupsSource.ts')), core = load(path.join(root, 'lib/nbaLineupsCore.ts'));
const html = fs.readFileSync(path.join(__dirname, 'fixtures/ncaam-rotowire-2026-11-01.html'), 'utf8');
const game = { gameId:'401920982', date:'2026-11-01', tipoff:'2026-11-01T14:30:00Z', away:'Notre Dame Fighting Irish', home:'Villanova Wildcats', status:'STATUS_SCHEDULED', aliases:{away:['Notre Dame'],home:['Villanova']} };
const at = '2026-11-01T06:00:00Z';
const parse = (page = html) => source.parseNcaamLineupsHtml(page, [game], at);

test('actual college depth charts dedupe repeated slots, preserve injuries, and never become final', () => {
  const result = parse();
  assert.equal(result.rejected.length, 0);
  assert.equal(result.lineups.length, 1);
  const lineup = result.lineups[0];
  assert.equal(lineup.away.starters.length, 5);
  assert.equal(lineup.home.starters.length, 4);
  assert.equal(lineup.home.complete, false);
  assert.equal(lineup.home.starters.at(-1).position, 'PF/C');
  assert.equal(lineup.away.starters.at(-1).status, 'QUESTIONABLE');
  assert.equal(lineup.home.injuries.length, 2);
  assert.equal(core.lineupFinal({...lineup, away:{...lineup.away,confirmed:true}, home:{...lineup.home,confirmed:true}}), false);
});

test('wrong time, duplicates and conflicting injury labels cannot bind a lineup', () => {
  assert.equal(parse(html.replace('9:30 AM ET','9:31 AM ET')).lineups.length, 0);
  assert.equal(parse(html.replace('SUN 11/01','MON 11/02')).lineups.length, 0);
  assert.equal(parse(html+html).lineups.length, 0);
  assert.equal(parse(html.replaceAll('>GTD<','>OUT<')).lineups.length, 0);
  assert.equal(source.validNcaamLineupSource('https://other.test/daily/ncaab/lineups.php'), false);
});

test('neutral-site reversed listings retain the correct team players and strict game identity', () => {
  const reversed = { ...game, neutralSite: true, away: game.home, home: game.away,
    aliases: { away: game.aliases.home, home: game.aliases.away } };
  const result = source.parseNcaamLineupsHtml(html, [reversed], at);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.lineups.length, 1);
  const lineup = result.lineups[0];
  assert.equal(lineup.away.team, 'Villanova Wildcats');
  assert.equal(lineup.away.starters[0].name, 'Elijah Crawford');
  assert.equal(lineup.away.starters.length, 4);
  assert.equal(lineup.away.injuries.length, 2);
  assert.equal(lineup.home.team, 'Notre Dame Fighting Irish');
  assert.equal(lineup.home.starters[0].name, 'Braeden Smith');
  assert.equal(lineup.home.starters.at(-1).status, 'QUESTIONABLE');
  assert.equal(core.findNbaLineup([lineup], { game: `${reversed.away} @ ${reversed.home}`, date: game.date }), lineup);
  for (const neutralSite of [false, null, undefined]) {
    assert.equal(source.parseNcaamLineupsHtml(html, [{ ...reversed, neutralSite }], at).lineups.length, 0);
  }
  assert.equal(source.parseNcaamLineupsHtml(html.replace('9:30 AM ET', '9:31 AM ET'), [reversed], at).lineups.length, 0);
  assert.equal(source.parseNcaamLineupsHtml(html, [game, reversed], at).lineups.length, 0);
});

test('only advertised slates for the requested day are followed', () => {
  const links = parse(html+'<a href="/daily/ncaab/lineups.php?slateID=3608">ND vs NOVA Nov 1 9:30 AM</a><a href="/daily/ncaab/lineups.php?slateID=3609">Nov 11 Classic</a>').links;
  assert.equal(links.length, 1);
  assert.match(links[0], /slateID=3608$/);
});

test('fresh observations update one saved slate and failures retain the last observation', async () => {
  let saved = [], requests = 0, page = html, writes = 0;
  const store = load(path.join(root, 'lib/ncaamLineups.ts'), { fetch: async () => { requests++; return {ok:true, url:source.NCAAM_LINEUP_SOURCE, headers:new Headers(), text:async()=>page}; }, imports:{
    './tursoStore':{readTursoDatasetByDateKeys:async()=>saved},
    './ncaamMarketStore':{saveNcaamMarketRows:async(dataset, rows)=>{assert.equal(dataset,'lineup_snapshots');assert.equal(rows.length,1);saved=rows;writes++;}},
    './ncaamLineupsSource':source, './nbaLineupsCore':core,
  }});
  const now = Date.parse(at);
  assert.equal((await store.refreshNcaamLineups(game.date,[game],true,now)).games,1);
  assert.equal((await store.refreshNcaamLineups(game.date,[game],true,now)).games,1);
  assert.equal(writes,2); // freshness matters even when names do not change
  page = '<html>Unavailable</html>';
  assert.equal((await store.refreshNcaamLineups(game.date,[game],true,now)).delayed,true);
  assert.equal(writes,2);
  assert.equal((await store.readNcaamSavedLineups(game.date)).length,1);
  assert.equal(requests,3);
});

test('shared basketball lineup UI shows college availability, incomplete fives and no final claim', () => {
  const ui = load(path.join(root,'app/NbaGameLineups.tsx'), {imports:{'./TeamLogoName':{TeamLogoName:p=>p.team},'../lib/nbaLineupsCore':core}});
  const markup = render(React.createElement(ui.default,{sport:'NCAAM',gameId:game.gameId,lineups:parse().lineups}));
  assert.match(markup,/4\/5 projected starters/);
  assert.match(markup,/Incomplete/);
  assert.match(markup,/2 out/);
  assert.match(markup,/Questionable/);
  assert.doesNotMatch(markup,/>Final</);
  assert.doesNotMatch(markup,/<details[^>]*\sopen/);
});

test('model details expose completed-season weight, opposing efficiencies and conditional player effects', () => {
  const details = load(path.join(root,'app/NcaamModelDetails.tsx'));
  const rating = { team:'Notre Dame',offense:115,defense:108,tempo:66,prior_season:2026,prior_weight:1,games_played:0 };
  const impact = { applied:true,offense_change_per_100:2,defense_improvement_per_100:-1,players:[],flags:['Source projected starting five is incomplete.'] };
  const markup = render(React.createElement(details.default,{forecast:{away_rating:rating,home_rating:{...rating,team:'Villanova'},
    lineup_margin_change:-3,lineup_total_change:7,lineup_adjustment:{away:impact,home:impact,as_of:at,ratingsSourceUrl:'https://barttorvik.com'},
    availability_scenarios:[{player:'Logan Duncomb',team:'Notre Dame',homeMarginChange:3.2,totalChange:-4.4}]}}));
  assert.match(markup,/2025–26 prior: 100%/);
  assert.match(markup,/0 current-season games/);
  assert.match(markup,/Adjusted defense/);
  assert.match(markup,/If Logan Duncomb is out/);
  assert.match(markup,/research estimates/);
});

test('current source ratings and missing player metrics display without invented percentages or zeros', () => {
  const details = load(path.join(root,'app/NcaamModelDetails.tsx'));
  const rating = { team:'Notre Dame',offense:115,defense:108,tempo:66,source_preseason_prior:true,
    prior_season:2026,prior_weight:0,d1_games_played:2 };
  const player = {id:'one',ratingId:'one',name:'New Player',status:'UNKNOWN',referenceMinutes:20,minutes:20,
    offensiveImpact:null,defensiveImpact:null};
  const impact = {applied:true,offense_change_per_100:0,defense_improvement_per_100:0,players:[player],flags:[]};
  const markup = render(React.createElement(details.default,{forecast:{away_rating:rating,home_rating:{...rating,team:'Villanova'},
    lineup_adjustment:{away:impact,home:impact,as_of:at,ratingsSourceUrl:'https://barttorvik.com'}}}));
  assert.match(markup,/Torvik season weighting/);
  assert.match(markup,/2 D1 games through yesterday/);
  assert.match(markup,/Unavailable/);
  assert.doesNotMatch(markup,/2025–26 prior: 0%|ten-game prior/);
});
