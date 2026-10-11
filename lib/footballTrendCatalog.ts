import { evaluateArchivedCatalogContext } from "./footballCatalogContext";
import { catalog as nflCatalog } from './catalog/nflCatalog';
import { catalog as ncaafCatalog } from './catalog/ncaafCatalog';
import { nflTrendTeamKey } from './nflTrendIdentity';

export type CatalogExpression = number | boolean | any[];
export type CatalogRule = {
  id: string; market: string; names: string[]; selections: string[];
  trigger: string; data: string; predicate?: CatalogExpression;
};
export type CatalogDefinition = {
  version: string; rules: CatalogRule[];
  filters: { id: string; label: string; condition: string; market: string; data: string }[];
  combinations: { parent: string; filters: string[] }[];
};
export type CatalogMembership = {
  pair: string; direction: number; filters: string[];
};
export type CatalogEvaluation = {
  version: string; memberships: CatalogMembership[];
  missing: string[]; ambiguous: string[]; invalid?: string;
};
type Side = Record<string, any>;
type Point = { time: number; line: number | null; bets: number | null; money: number | null; odds: number | null };
const catalogs: Record<string, CatalogDefinition> = { NFL: nflCatalog, NCAAF: ncaafCatalog };
const catalogIndexes = new Map(Object.values(catalogs).map(config => {
  const rules = new Map(config.rules.map(rule => [rule.id, rule]));
  const filters = new Map(config.filters.map(filter => [filter.id, filter]));
  const combinations = new Map<string, CatalogDefinition['combinations']>();
  for (const combination of config.combinations) {
    const group = combinations.get(combination.parent) || [];
    group.push(combination);
    combinations.set(combination.parent, group);
  }
  return [config.version, { rules, filters, combinations }] as const;
}));
const kickoffFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone:'America/New_York', weekday:'short', hour:'numeric', hourCycle:'h23',
});
export function footballCatalog(sport: string) { return catalogs[sport] || ncaafCatalog; }
const key = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function catalogNumber(x: unknown): number | null {
  if (x == null || String(x).trim() === '') return null;
  const n = Number(String(x).replace(/[%−]/g, c => c === '−' ? '-' : '').trim());
  return Number.isFinite(n) ? n : null;
}
function pct(x: unknown) { const n = catalogNumber(x); return n != null && n >= 0 && n <= 100 ? n : null; }
function odds(x: unknown) { const n = catalogNumber(x); return n != null && Math.abs(n) >= 100 ? n : null; }
function epoch(x: unknown) { const n = Date.parse(String(x || '').replace(/ EDT$/, ' -0400').replace(/ EST$/, ' -0500')); return Number.isFinite(n) ? n : null; }
function json(x: unknown): any { try { return typeof x === 'string' ? JSON.parse(x) : x; } catch { return null; } }
function isRow(x: Side) { return Boolean(x.Market); }
export function catalogSide(x: Side): Side {
  if (!isRow(x)) return { ...x, source: x.publicSplitSource || x.marketSource || x.source };
  const details = json(x['Catalog Evidence JSON']) || {};
  return { ...details, date: x.Date, game: x.Game, gameKey: x['Game Key'], gameTime: x['Game Time'],
    awayTeam: x['Away Team'], homeTeam: x['Home Team'], market: x.Market,
    selection: x['Public Split Selection'] || x.Selection, selectionTeam: x['Public Split Selection'] || x.Selection,
    side: x.Side || x.Selection, line: x['Public Split Line'] ?? x.Line,
    odds: x['Public Split Odds'] || x.Odds, observedPriceMissing: x['Observed Price Missing'] === 'TRUE',
    betsPct: x['Public Bets %'] ?? x['Current Public %'], moneyPct: x['Public Money %'] ?? x['Current Sharp %'],
    openingLine: x['Opening Public Split Line'] ?? x['Opening Line'], openingOdds: x['Opening Public Split Odds'],
    openingBetsPct: x['Opening Public %'] ?? x['Opening Bets %'], openingMoneyPct: x['Opening Sharp %'] ?? x['Opening Money %'],
    openingSnapshotTime: x['Opening Public Split Snapshot Time'],
    publicMovementPct: x['Public Change %'], sharpMovementPct: x['Sharp Change %'],
    lineMovementValue: x['Line Movement Value'], lineMovementBasis: x['Line Movement Basis'],
    updatedAt: x['Public Split Snapshot Time'], frozenAt: x['Public Split Snapshot Time'], snapshotStatus: x['Snapshot Status'],
    source: x['Public Split Source'], movementHistory: details.movementHistory || json(x['Movement History JSON']),
    catalogEvaluation: json(x['Catalog Membership JSON']), catalogContext: json(x['Catalog Context JSON']),
    result: x.Result, resultUpdated: x['Result Updated'], actualAway: x['Actual Away Runs'], actualHome: x['Actual Home Runs'],
  };
}
function team(x: unknown, sport: string) { return sport === 'NFL' ? nflTrendTeamKey(x) : key(x); }
export function catalogEventKey(x: Side, sport: string) {
  const s = catalogSide(x);
  const teams = [team(s.awayTeam, sport), team(s.homeTeam, sport)];
  if (teams.every(Boolean)) return `${s.date}|${teams.sort().join('|')}`;
  const parts = String(s.game || '').split(/\s*(?:@|\bat\b|\bvs\.?\b)\s*/i).map(x => team(x, sport)).filter(Boolean);
  return `${s.date}|${parts.length === 2 ? parts.sort().join('|') : key(s.game || s.gameKey)}`;
}
function selection(s: Side, sport: string) {
  return key(s.market) === 'total' ? key(s.side || s.selection).split(' ')[0] : team(s.selectionTeam || s.selection, sport);
}
function role(s: Side, sport: string) {
  if (key(s.market) === 'total') return selection(s, sport) === 'over' ? 'Over' : 'Under';
  const name = selection(s, sport);
  if (name && name === team(s.homeTeam, sport)) return 'Home';
  if (name && name === team(s.awayTeam, sport)) return 'Away';
  return '';
}
export function catalogSelectionIdentity(input: Side, sport: string) { const s=catalogSide(input); return role(s,sport) || selection(s,sport); }
export function catalogSignals(evaluation: CatalogEvaluation | undefined, sport: string): string[] {
  if (!evaluation || evaluation.version !== footballCatalog(sport).version || evaluation.invalid) return [];
  const config = footballCatalog(sport);
  const combinations = catalogIndexes.get(config.version)?.combinations;
  return evaluation.memberships.flatMap(m => {
    const groups = [[], ...m.filters.map(f => [f]), ...(combinations?.get(m.pair) || []).filter(c => c.filters.every(f => m.filters.includes(f))).map(c => c.filters)];
    return [...new Set(groups.map(filters => `catalog:${evaluation.version}:${m.pair}:${m.direction}:${filters.slice().sort().join(',')}`))];
  });
}
export function catalogSignalLabel(signal: string) {
  if (!signal.startsWith('catalog:')) return signal;
  const [, version, id, direction, filterIds] = signal.split(':');
  const index = catalogIndexes.get(version);
  const rule = index?.rules.get(id);
  if (!rule || !index) return signal;
  const filters = (filterIds || '').split(',').filter(Boolean).map(id => index.filters.get(id)?.label || id);
  return [rule.names[Number(direction)], ...filters].join(' + ');
}
export function catalogEvaluationFor(play: Side, siblings: Side[], sport: string) {
  const s = catalogSide(play);
  if (s.catalogEvaluation?.version === footballCatalog(sport).version) return s.catalogEvaluation as CatalogEvaluation;
  const all = siblings.map(catalogSide);
  const index = all.findIndex(x => key(x.market) === key(s.market) && selection(x, sport) === selection(s, sport));
  return evaluateFootballCatalogGroup(index < 0 ? [...all, s] : all, sport)[index < 0 ? all.length : index];
}

// Math is interpreted from a compiled AST, never evaluated as JavaScript.
// Missing values propagate, including through negation and equality; null is
// never coerced to zero. False AND / true OR may short-circuit safely.
export function evaluateCatalogExpression(expr: CatalogExpression, value: (name: string) => number | null): number | boolean | null {
  if (!Array.isArray(expr)) return expr;
  const [op, ...args] = expr;
  if (op === 'v') return value(args[0]);
  if (op === 'and' || op === 'or') {
    const values = args.map(x => evaluateCatalogExpression(x, value));
    if (op === 'and' && values.some(x => x === false)) return false;
    if (op === 'or' && values.some(x => x === true)) return true;
    if (values.some(x => x == null)) return null;
    return op === 'and' ? values.every(Boolean) : values.some(Boolean);
  }
  if (op === 'cmp') {
    const values = args[1].map((x: CatalogExpression) => evaluateCatalogExpression(x, value));
    if (values.some((x: unknown) => x == null)) return null;
    return args[0].every((c: string, i: number) => c === '<' ? values[i] < values[i+1] : c === '<=' ? values[i] <= values[i+1]
      : c === '>' ? values[i] > values[i+1] : c === '>=' ? values[i] >= values[i+1] : values[i] === values[i+1]);
  }
  const values = args.map(x => evaluateCatalogExpression(x, value));
  if (values.some(x => x == null)) return null;
  const a = Number(values[0]), b = Number(values[1]);
  if (op === 'neg') return -a;
  if (op === 'abs') return Math.abs(a);
  if (op === '+') return a+b;
  if (op === '-') return a-b;
  if (op === '*') return a*b;
  if (op === '/') return b ? a/b : null;
  return null;
}
function implied(a: number | null) { return a == null ? null : a > 0 ? 10000/(a+100) : 100*Math.abs(a)/(Math.abs(a)+100); }
function point(s: Side, opening = false): Point {
  return { time: epoch(opening ? s.openingSnapshotTime || s.firstTrackedAt : s.frozenAt || s.updatedAt) || 0,
    line: catalogNumber(opening ? s.openingLine : s.line), bets: pct(opening ? s.openingBetsPct : s.betsPct),
    money: pct(opening ? s.openingMoneyPct : s.moneyPct),
    odds: s.observedPriceMissing || s.oddsSource === 'DEFAULT_110' ? null : odds(opening ? s.openingOdds : s.odds) };
}
function support(s: Side, a: number | null, b: number | null) {
  if (a == null || b == null) return null;
  return key(s.market) === 'spread' || key(s.side || s.selection).startsWith('under') ? a-b : b-a;
}
function history(s: Side) {
  const d = point(s), o = point(s, true);
  if (!Array.isArray(s.movementHistory) || !d.time || !o.time) return [];
  const points = s.movementHistory.map((p: Side): Point => ({time: epoch(p.snapshotTime) || 0, line: catalogNumber(p.line), bets: pct(p.betsPct), money: pct(p.moneyPct), odds: odds(p.odds)}))
    .filter((p: Point) => p.time >= o.time && p.time <= d.time).sort((a: Point,b: Point) => a.time-b.time);
  return [...new Map<number, Point>([...points, o, d].map((p: Point) => [p.time,p])).values()].sort((a,b) => a.time-b.time);
}
function timed(s: Side, name: string, path: Point[]) {
  if (name === 'O') return point(s,true);
  if (name === 'D') return point(s);
  const minutes = Number(name.slice(1));
  const target = Number(epoch(s.gameTime)) - minutes*60_000;
  const tolerance = ({30:5,60:10,120:15,360:30,1440:60} as Record<number,number>)[minutes];
  return path.filter(p => p.time <= target && p.time >= target-tolerance*60_000 && p.time < point(s).time).at(-1);
}
function resolver(all: Side[], anchor: Side, sport: string) {
  const cache = new Map<string,number|null>();
  const pathCache = new Map<Side,Point[]>();
  const byRole = (r: string) => r === 's' || r === 'anchor' ? anchor
    : r === 'f' ? all.find(s => key(s.market) === 'spread' && Number(catalogNumber(s.line)) < 0)
    : all.find(s => role(s,sport) === r);
  const opposite = (s: Side) => all.find(x => key(x.market) === key(s.market) && selection(x,sport) !== selection(s,sport));
  const paired = (s: Side, p: Point | undefined | null, q: Point | undefined | null) => {
    if (!p || !q || !p.time || !q.time || Math.abs(p.time-q.time)>60_000 || p.line==null || q.line==null) return false;
    if (key(s.market)==='total' ? p.line !== q.line : Math.abs(p.line+q.line)>1e-9) return false;
    return (['bets','money'] as const).every(field => p[field]==null || q[field]==null || Math.abs(p[field]!+q[field]!-100)<=2);
  };
  const opening = (s: Side) => { const other=opposite(s),o=validOpening(s),q=other?validOpening(other):null; return paired(s,o,q)?o:null; };
  const getPath = (s: Side) => {
    if (!pathCache.has(s)) {
      const other=opposite(s),points=history(s),opp=other?history(other):[];
      // An inconsistent supplied path is rejected, not repaired by dropping an
      // inconvenient point. Both sides must describe the same source quote.
      // Both paths are sorted. Preserve the first quote within the existing
      // one-minute tolerance without rescanning the opposite path per point.
      let oppositeIndex = 0;
      const consistent = points.every(p => {
        while (oppositeIndex < opp.length && opp[oppositeIndex].time < p.time - 60_000) oppositeIndex++;
        const q = opp[oppositeIndex];
        return paired(s, p, q && q.time <= p.time + 60_000 ? q : undefined);
      });
      pathCache.set(s, consistent ? points : []);
    }
    return pathCache.get(s)!;
  };
  const value = (name: string): number|null => {
    if (cache.has(name)) return cache.get(name)!;
    const result = compute(name); cache.set(name,result); return result;
  };
  const compute = (name: string): number|null => {
    if (name === 'isHome' || name === 'isAway') return role(anchor,sport) ? Number(role(anchor,sport) === name.slice(2)) : null;
    if (name === 'openingMinutes') { const a=point(anchor,true).time,b=point(anchor).time; return a && b && a < b ? (b-a)/60_000 : null; }
    if (['T0','Td','max_T','min_T'].includes(name)) {
      const s=byRole('Over') || byRole('Under');
      if (!s) return null;
      if (name === 'T0' || name === 'Td') return name === 'T0' ? opening(s)?.line ?? null : point(s).line;
      const values=getPath(s).map(p => p.line); return values.length>=2 && values.every(v=>v!=null) ? (name==='max_T'?Math.max:Math.min)(...(values as number[])) : null;
    }
    const match=name.match(/^(.*)_(anchor|s|Home|Away|Over|Under|f)(?:_(O|Q\d+)_(D|Q\d+))?$/);
    if (!match) return null;
    const [,metric,r,a,b]=match, s=byRole(r);
    if (!s) return null;
    const d=point(s), o=opening(s), path=getPath(s);
    if (metric==='Ld') return d.line;
    if (metric==='L0') return o?.line ?? null;
    if (metric==='bd') return d.bets;
    if (metric==='hd') return d.money;
    if (metric==='b0') return o?.bets != null && o.bets>0 && o.bets<100 ? o.bets : null;
    if (metric==='h0') return o?.money ?? null;
    if (metric==='P') { const x=value(`b0_${r}`); return x==null || d.bets==null?null:d.bets-x; }
    if (metric==='H') return o?.money==null || d.money==null?null:d.money-o.money;
    if (metric==='Gd') return d.money==null || d.bets==null?null:d.money-d.bets;
    if (metric==='G0') return o?.money==null || o.bets==null?null:o.money-o.bets;
    if (metric==='m') return support(s,o?.line ?? null,d.line);
    if (metric==='Rstake') return d.bets!=null && d.money!=null && d.bets>0 && d.bets<100 && d.money>0 && d.money<100 ? d.money/d.bets/((100-d.money)/(100-d.bets)) : null;
    if (metric==='pd' || metric==='p0') return implied(metric==='pd'?d.odds:o?.odds ?? null);
    if (metric==='nvpd' || metric==='nvp0') {
      const other=all.find(x => key(x.market)===key(s.market) && selection(x,sport)!==selection(s,sport));
      if (!other) return null;
      const p=metric==='nvpd'?d:o, q=metric==='nvpd'?point(other):opening(other);
      if (!p || !q || Math.abs(p.time-q.time)>60_000) return null;
      const x=implied(p.odds),y=implied(q.odds); return x==null || y==null?null:100*x/(x+y);
    }
    const qmetric=metric.match(/^(b|h|G)Q(\d+)$/);
    if (qmetric) {const p=timed(s,`Q${qmetric[2]}`,path); if(!p)return null;
      return qmetric[1]==='b'?p.bets:qmetric[1]==='h'?p.money:p.bets==null || p.money==null?null:p.money-p.bets;}
    if (metric==='m_between') {const p=timed(s,a,path),q=timed(s,b,path);return p && q && p.time<q.time?support(s,p.line,q.line):null;}
    if (path.length<2 || !o) return null;
    const amounts=path.map(p=>support(s,o.line,p.line));
    if (amounts.some(x=>x==null)) return null;
    const supports=amounts as number[], increments=supports.slice(1).map((v,i)=>v-supports[i]);
    const nonzero=increments.filter(x=>x!==0);
    const extremes=(values:(number|null)[], high:boolean) => values.length && values.every(x=>x!=null) ? (high?Math.max:Math.min)(...(values as number[])) : null;
    if (metric==='max_support') return Math.max(...supports);
    if (metric==='min_support') return Math.min(...supports);
    if (metric==='max_support_before_D') return extremes(supports.slice(0,-1),true);
    if (metric==='nonzeroChanges') return nonzero.length;
    if (metric==='positiveChanges') return increments.filter(x=>x>0).length;
    if (metric==='negativeChanges') return increments.filter(x=>x<0).length;
    if (metric==='lastThreeSupport') return Number(increments.length>=3 && increments.slice(-3).every(x=>x>=0.5));
    if (metric==='reversals') return nonzero.slice(1).filter((x,i)=>Math.sign(x)!==Math.sign(nonzero[i])).length;
    if (metric==='lastNonzero') return nonzero.at(-1) ?? 0;
    if (metric==='maxJump') return Math.max(...increments);
    if (metric==='maxAbsJump') return Math.max(...increments.map(Math.abs));
    if (metric==='max_L' || metric==='min_L') return extremes(path.map(p=>p.line),metric==='max_L');
    const e=metric.match(/^(max|min)_(b|h|gap)(_before_D)?$/);
    if(e){const p=e[3]?path.slice(0,-1):path;return extremes(p.map(p=>e[2]==='b'?p.bets:e[2]==='h'?p.money:p.bets==null||p.money==null?null:p.money-p.bets),e[1]==='max');}
    return null;
  };
  return value;
}
function validOpening(s: Side) { const o=point(s,true),d=point(s); return o.time && d.time && o.time<d.time ? o : null; }
function candidateAnchors(rule: CatalogRule, all: Side[], sport: string) {
  if (/\bs\b/.test(rule.trigger)) return all.filter(s => key(s.market) === (/spread team/.test(rule.trigger) ? 'spread' : key(rule.market)));
  if (/\bf\b/.test(rule.trigger) || rule.selections.some(x=>x.includes('(f)') || x==='f')) return all.filter(s=>key(s.market)==='spread' && catalogNumber(s.line)!=null && Number(s.line)<0);
  if (rule.selections.some(x=>x.includes('Home')) || /\(Home\)/.test(rule.trigger)) return all.filter(s=>role(s,sport)==='Home');
  const fixed=rule.selections[0];
  return all.filter(s=>role(s,sport)===(fixed==='Under'?'Under':'Over'));
}
function targetSide(ref: string, rule: CatalogRule, anchor: Side, all: Side[], sport: string) {
  const r=ref.replace(' team','');
  if (r==='s' || r==='f') return anchor;
  if (r==='opp(s)' || r==='opp(f)') return all.find(s=>key(s.market)===key(rule.market) && selection(s,sport)!==selection(anchor,sport));
  return all.find(s=>key(s.market)===key(rule.market) && role(s,sport)===r);
}
function frozenContext(s: Side, data: string) {
  const c=s.catalogContext?.[data];
  const known=epoch(c?.knownAt), d=point(s).time;
  return c && known!=null && known<=d && c.source ? c : null;
}
function contextPredicate(rule: CatalogRule, anchor: Side, all: Side[], sport: string): boolean|null {
  // Context definitions are registered and monitored but cannot infer forecasts,
  // injuries, absolute volume, archived models or ranks from split percentages.
  const c=frozenContext(anchor,rule.data);
  if (!c) return null;
  const value=resolver(all,anchor,sport);
  if(rule.data==='M') {
    const p=catalogNumber(key(rule.market)==='total'?c.projectedTotal:c.projectedHomeMargin);
    if(p==null)return null;
    const edge=key(rule.market)==='total' ? (role(anchor,sport)==='Over'?1:-1)*(p-Number(value('Td')))
      : (role(anchor,sport)==='Home'?1:-1)*(p+Number(value('Ld_Home')));
    if(!Number.isFinite(edge) || (key(rule.market)==='total'?value('Td'):value('Ld_Home'))==null)return null;
    const threshold=rule.id.match(/edge-(\d+)/)?.[1];
    if(threshold)return edge>=Number(threshold);
    if(rule.id.includes('after-total') || rule.id.includes('with-total')) {
      const wantsOver=rule.id.includes('model-over');
      const drop=rule.id.includes('drop');
      const move=drop ? Number(value('T0'))-Number(value('Td')):Number(value('Td'))-Number(value('T0'));
      return value('T0')==null?null:role(anchor,sport)===(wantsOver?'Over':'Under') && edge>=3 && move>=1.5;
    }
    const metric=rule.id.includes('sharp')?'Gd_s':rule.id.includes('public')?'bd_s':rule.id.includes('money-growth')?'H_s':'m_s';
    const n=value(metric);if(n==null)return null;
    return edge>=3 && (rule.id.includes('opposes-public')?n<=30:rule.id.includes('opposes-line')?n<=-1:metric==='Gd_s'?n>=25:metric==='bd_s'?n>=70:metric==='H_s'?n>=10:n>=1);
  }
  return evaluateArchivedCatalogContext(rule.id, rule.data, c, role(anchor,sport), sport, value);
}
function filterMatch(id: string, anchor: Side, all: Side[], sport: string, value=resolver(all,anchor,sport)): boolean|null {
  const r=role(anchor,sport), market=key(anchor.market);
  const v=(s:string)=>value(s.replace(/_anchor/g,'_s'));
  const band=(n:number|null,lo:number,hi:number)=>n==null?null:n>=lo&&n<hi;
  const line=catalogNumber(anchor.line);
  if (id === 'bd-balanced' || id === 'hd-balanced') { const n=v(id==='bd-balanced'?'bd_s':'hd_s'); return n==null?null:n>=45&&n<=55; }
  if(['home-signal','away-signal','anchor-over','anchor-under'].includes(id))return r ? r===({ 'home-signal':'Home','away-signal':'Away','anchor-over':'Over','anchor-under':'Under'} as Record<string,string>)[id] : null;
  if(id.includes('favorite-signal') || id.includes('underdog-signal') || id==='pickem-signal') {
    if(line==null)return null;
    return (id.startsWith('home-')?r==='Home':id.startsWith('away-')?r==='Away':true) && (id.includes('underdog')?line>0:id==='pickem-signal'?line===0:line<0);
  }
  if(id.startsWith('spread-mag-')) {const lo=Number(id.slice(11)), hi=({0:3,3:7,7:10,10:15,15:21,21:Infinity} as Record<number,number>)[lo];return band(line==null?null:Math.abs(line),lo,hi);}
  if(id==='favorite-below-15')return line==null?null:line>-15&&line<0;
  if(id.startsWith('spread-exact-'))return line==null?null:Math.abs(line)===Number(id.slice(13));
  if(id.startsWith('total-level-')) {const lo=Number(id.slice(12)),hi=({0:40,40:50,50:60,60:70,70:Infinity} as Record<number,number>)[lo];return line==null?null:lo===0?line>0&&line<40:band(line,lo,hi);}
  const facet=id.match(/^(bd|hd|gap|p|h)-facet-(-?[\d.]+)$/);
  if(facet){const kinds:Record<string,string>={bd:'bd_s',hd:'hd_s',gap:'Gd_s',p:'P_s',h:'H_s'}, groups:Record<string,number[]>={bd:[0,10,25,40,50,60,70,80,90,101],hd:[0,10,25,40,50,60,70,80,90,101],gap:[-100,-40,-25,-10,10,25,40,101],p:[-100,-20,-10,-5,5,10,20,101],h:[-100,-20,-10,-5,5,10,20,101]};const lo=Number(facet[2]),list=groups[facet[1]];return band(v(kinds[facet[1]]),lo,list[list.indexOf(lo)+1]);}
  if(id==='tickets-above-20')return v('P_s')==null?null:Number(v('P_s'))>20;
  const m=v('m_s');
  if(id==='no-line-movement')return m==null?null:m===0;
  if(id==='line-supports-signal')return m==null?null:m>=0.5;
  if(id==='line-opposes-signal')return m==null?null:m<=-0.5;
  if(id.startsWith('line-size-')){const lo=Number(id.slice(10)),list=[0,0.5,1,1.5,3,5,Infinity];return band(m==null?null:Math.abs(m),lo,list[list.indexOf(lo)+1]);}
  if(id==='integer-quote' || id==='half-point-quote')return line==null?null:Math.abs(line)%1===(id==='integer-quote'?0:0.5);
  const kick=epoch(anchor.gameTime);
  if(['monday-through-friday','saturday','sunday','tuesday-or-wednesday','friday','morning-et','afternoon-et','evening-et'].includes(id)) {
    if(kick==null)return null;const parts=kickoffFormatter.formatToParts(new Date(kick));const day=parts.find(x=>x.type==='weekday')?.value, hour=Number(parts.find(x=>x.type==='hour')?.value);
    return id==='saturday'?day==='Sat':id==='sunday'?day==='Sun':id==='friday'?day==='Fri':id==='tuesday-or-wednesday'?day==='Tue'||day==='Wed':id==='monday-through-friday'?day!=='Sat'&&day!=='Sun':id==='morning-et'?hour<12:id==='afternoon-et'?hour>=12&&hour<18:hour>=18;
  }
  if(id==='legacy-source' || id==='scoresandodds-source'){if(!anchor.source || !validOpening(anchor))return null;return id==='scoresandodds-source'?anchor.date>='2026-09-21'&&String(anchor.source).includes('ScoresAndOdds'):anchor.date<'2026-09-21'&&!String(anchor.source).includes('ScoresAndOdds');}
    if(id.startsWith('opening-')) {const o=point(anchor,true).time,k=epoch(anchor.gameTime);const lead=o&&k?(k-o)/60_000:null;return lead==null?null:id==='opening-under-one-hour'?lead>0&&lead<60:id==='opening-one-to-six-hours'?lead>=60&&lead<360:id==='opening-six-to-twenty-four-hours'?lead>=360&&lead<1440:lead>=1440;}
  if(['two-to-five-quotes','six-to-nineteen-quotes','twenty-plus-quotes'].includes(id)){const path=history(anchor);if(!path.length)return null;return id==='two-to-five-quotes'?path.length>=2&&path.length<=5:id==='six-to-nineteen-quotes'?path.length>=6&&path.length<=19:path.length>=20;}
  const p=point(anchor).odds;
  if(id==='price-recorded')return p!=null;
  if(id==='price-missing')return p==null;
  if(id==='actual-price-at-most-120')return p!=null && p>=-150&&p<=-120;
  if(id==='actual-price-better-than-120')return p!=null && p>-120;
  if(id.startsWith('season-week-')) {const c=frozenContext(anchor,'S'),w=catalogNumber(c?.week);const lo=Number(id.slice(12)),list=[1,4,7,10,14,Infinity];return band(w,lo,list[list.indexOf(lo)+1]);}
  const c=frozenContext(anchor,'S');
  if(['neutral-site','nonneutral-site'].includes(id))return typeof c?.neutralSite==='boolean' ? c.neutralSite===(id==='neutral-site') : null;
  const teams=c?.teams;
  if(['division','nondivision','conference','nonconference','same-nfl-conference','afc-versus-nfc'].includes(id)) {
    const a=teams?.Home,b=teams?.Away,f=id.includes('division')?'division':'conference';
    if(!a?.[f] || !b?.[f])return null;
    const independent=sport==='NCAAF' && [a[f],b[f]].some(x=>key(x)==='independent');
    const same=a[f]===b[f] && !independent;
    return id==='nondivision'||id==='nonconference'||id==='afc-versus-nfc'?!same:same;
  }
  if(['fbs-versus-fbs','fbs-versus-fcs'].includes(id)) {
    const a=teams?.Home?.classification,b=teams?.Away?.classification;
    if(!a || !b)return null;
    return id==='fbs-versus-fbs'?a==='FBS'&&b==='FBS':a==='FBS'&&b==='FCS'||a==='FCS'&&b==='FBS';
  }
  if(['both-ranked','one-ranked','neither-ranked','both-top-half','one-top-half','both-bottom-half'].includes(id)) {
    const ranks=frozenContext(anchor,'K')?.teams;
    const ranked=(t:Side|undefined):boolean|null => {
      const n=catalogNumber(t?.rank);
      if(n!=null)return n>=1&&n<=(sport==='NFL'?16:25);
      return sport==='NCAAF'&&t?.unranked===true?false:null;
    };
    const a=ranked(ranks?.Home),b=ranked(ranks?.Away);
    if(a==null || b==null)return null;
    return id==='one-ranked'||id==='one-top-half'?a!==b:id==='neither-ranked'||id==='both-bottom-half'?!a&&!b:a&&b;
  }
  return null;
}

export function evaluateFootballCatalogGroup(inputs: Side[], sport: string): CatalogEvaluation[] {
  const all=inputs.map(catalogSide), config=footballCatalog(sport);
  const out:CatalogEvaluation[]=all.map(()=>({version:config.version,memberships:[],missing:[],ambiguous:[]}));
  const pairs=new Map<string,Side[]>();
  for(const s of all){const m=key(s.market);pairs.set(m,[...(pairs.get(m)||[]),s]);}
  const validPair=(market:string)=>{
    const p=pairs.get(key(market)) || [];
    if(p.length!==2 || selection(p[0],sport)===selection(p[1],sport))return false;
    const a=point(p[0]),b=point(p[1]);
    if(a.line==null || b.line==null || !a.time || !b.time || Math.abs(a.time-b.time)>60_000)return false;
    if(key(market)==='total'?a.line<=0 || a.line!==b.line:Math.abs(a.line+b.line)>1e-9)return false;
    for(const metric of ['bets','money'] as const)if(a[metric]!=null&&b[metric]!=null&&Math.abs(a[metric]!+b[metric]!-100)>2)return false;
    return true;
  };
  const finals=all.filter(s=>s.snapshotStatus==='FINAL_PREGAME');
  for(const s of finals){const d=point(s).time,k=epoch(s.gameTime);if(k==null||k-d<10*60_000||k-d>20*60_000)out[all.indexOf(s)].invalid='Outside the verified final window';}
  const usable = all.filter(s => validPair(s.market) && !out[all.indexOf(s)].invalid);
  const values = new Map<Side, ReturnType<typeof resolver>>();
  const getValues = (s: Side) => { if (!values.has(s)) values.set(s, resolver(usable, s, sport)); return values.get(s)!; };
  const filterCache = new Map<Side, string[]>();
  for(const rule of config.rules) {
    const marketSides=pairs.get(key(rule.market)) || [];
    if(!marketSides.length)continue;
    if(!validPair(rule.market) || marketSides.some(s=>out[all.indexOf(s)].invalid)) {
      for(const s of marketSides)out[all.indexOf(s)].missing.push(rule.id);
      continue;
    }
    const anchors=candidateAnchors(rule,usable,sport);
    const hits:Side[]=[];let missing=!anchors.length;
    for(const anchor of anchors){const v=getValues(anchor);const result=rule.predicate?evaluateCatalogExpression(rule.predicate,v):contextPredicate(rule,anchor,all,sport);
      if(result==null)missing=true;else if(result===true)hits.push(anchor);}
    if(hits.length>1){for(const s of marketSides)out[all.indexOf(s)].ambiguous.push(rule.id);continue;}
    if(hits.length!==1){if(missing)for(const s of marketSides)out[all.indexOf(s)].missing.push(rule.id);continue;}
    const anchor=hits[0];
    for(let direction=0;direction<2;direction++) {
      const selected=targetSide(rule.selections[direction],rule,anchor,all,sport);
      if(!selected)continue;
      const filterAnchor=key(anchor.market)===key(rule.market)?anchor:targetSide(rule.selections[0],rule,anchor,all,sport)!;
      if (!filterCache.has(filterAnchor)) filterCache.set(filterAnchor, config.filters.filter(f => (f.market==='Both' || key(f.market)===key(rule.market)) && filterMatch(f.id,filterAnchor,usable,sport,getValues(filterAnchor))===true).map(f=>f.id).sort());
      const filters=filterCache.get(filterAnchor)!;
      out[all.indexOf(selected)].memberships.push({pair:rule.id,direction,filters});
    }
  }
  return out;
}
