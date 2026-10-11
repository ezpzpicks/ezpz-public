// Optional context adapters accept raw, timestamped archived facts. Callers
// validate source and knownAt against the decision before entering this module.
// Absent fields return null; no rule accepts a precomputed "matched" label.
type Facts=Record<string,any>;
type Verdict=boolean|null;
const number=(x:any):number|null=>x==null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const bool=(x:any):Verdict=>typeof x==='boolean'?x:null;
const all=(...v:Verdict[]):Verdict=>v.includes(false)?false:v.includes(null)?null:true;
const any=(...v:Verdict[]):Verdict=>v.includes(true)?true:v.includes(null)?null:false;
const compare=(a:any,b:any,f:(a:number,b:number)=>boolean):Verdict=>number(a)==null||number(b)==null?null:f(Number(a),Number(b));
const ge=(a:any,b:any)=>compare(a,b,(a,b)=>a>=b), le=(a:any,b:any)=>compare(a,b,(a,b)=>a<=b), gt=(a:any,b:any)=>compare(a,b,(a,b)=>a>b), lt=(a:any,b:any)=>compare(a,b,(a,b)=>a<b);
const eq=(a:any,b:any):Verdict=>a==null||b==null?null:a===b;
const not=(v:Verdict):Verdict=>v==null?null:!v;
const between=(x:any,a:number,b:number)=>all(ge(x,a),le(x,b));

export function evaluateArchivedCatalogContext(id:string,data:string,c:Facts,role:string,sport:string,value:(name:string)=>number|null):Verdict {
  id=id.replace(/-(spread|total)$/,'');
  const h=c.teams?.Home,a=c.teams?.Away,s=role==='Home'?h:role==='Away'?a:undefined,o=role==='Home'?a:role==='Away'?h:undefined;
  if(data==='W') {
    const outdoor=bool(c.outdoor),wind=all(outdoor,ge(c.windMph,15)),rain=all(outdoor,ge(c.precipitationProbability,60),gt(c.liquidPrecipitation,0));
    const conditions:Record<string,Verdict>={
      'windy-game':wind,'very-windy-game':all(outdoor,ge(c.windMph,25)), 'strong-gusts':all(outdoor,ge(c.gustMph,30)),
      'rain-forecast':rain,'wind-and-rain':all(wind,rain),'cold-game':all(outdoor,lt(c.temperatureF,40)),
      'freezing-game':all(outdoor,le(c.temperatureF,32)),'hot-game':all(outdoor,ge(c.temperatureF,90)),
      'hot-humid-game':all(outdoor,ge(c.temperatureF,85),ge(c.relativeHumidity,70)),
      'snow-forecast':all(outdoor,gt(c.snowfall,0)),
      'calm-dry-mild-game':all(outdoor,lt(c.windMph,10),lt(c.precipitationProbability,20),between(c.temperatureF,50,80)),
      'indoor-controlled-game':any(bool(c.permanentlyIndoor),eq(c.roofStatus,'closed')),
      'bad-weather-with-high-total':all(any(wind,rain),ge(value('Td'),60)),
      'bad-weather-but-rising-total':all(any(wind,rain),value('T0')==null||value('Td')==null?null:ge(Number(value('Td'))-Number(value('T0')),1.5)),
    };return conditions[id] ?? null;
  }
  if(data==='I') {
    const qb=(t:Facts|undefined)=>all(bool(t?.usualQbDocumented),eq(t?.qbStatus,'out'));
    const available=(t:Facts|undefined)=>all(bool(t?.usualQbDocumented),eq(t?.qbStatus,'available'));
    const returns=(t:Facts|undefined)=>all(available(t),bool(t?.qbMissedPriorGame));
    const ownOut=all(qb(s),available(o));
    const exactlyOne=(x:Verdict,y:Verdict)=>x==null||y==null?null:x!==y;
    const sum=(field:string)=>number(h?.[field])==null||number(a?.[field])==null?null:Number(h[field])+Number(a[field]);
    const conditions:Record<string,Verdict>={
      'starting-quarterback-out':ownOut,'starting-quarterback-returns':returns(s),
      'two-starting-offensive-linemen-out':ge(s?.startingOffensiveLinemenOut,2),
      'top-receiver-out':bool(s?.receivingYardsLeaderOut),'lead-running-back-out':bool(s?.rushingAttemptsLeaderOut),
      'two-starting-defensive-backs-out':ge(s?.startingDefensiveBacksOut,2),'starting-kicker-out':all(bool(s?.usualKickerDocumented),eq(s?.kickerStatus,'out')),
      'three-defensive-starters-out':ge(s?.defensiveStartersOut,3),
      'qb-out-with-line-support':all(ownOut,ge(value('m_s'),1)), 'qb-out-with-money-support':all(ownOut,ge(value('Gd_s'),25)),
      'one-starting-qb-out':exactlyOne(qb(h),qb(a)),'both-starting-qbs-out':all(qb(h),qb(a)),
      'one-starting-qb-returns':exactlyOne(returns(h),returns(a)),
      'multiple-offensive-starters-out':ge(sum('offensiveStartersOut'),3),'multiple-defensive-starters-out':ge(sum('defensiveStartersOut'),3),
      'both-top-receivers-out':all(bool(h?.receivingYardsLeaderOut),bool(a?.receivingYardsLeaderOut)),
    };return conditions[id] ?? null;
  }
  if(data==='K') {
    const ranked=(t:Facts|undefined)=>sport==='NFL'?between(t?.rank,1,16):between(t?.rank,1,25);
    const unranked=(t:Facts|undefined)=>sport==='NFL'?between(t?.rank,17,32):bool(t?.unranked);
    const top=(t:Facts|undefined)=>between(t?.rank,1,sport==='NFL'?8:10);
    const conditions:Record<string,Verdict>={
      'top-half-versus-bottom-half':all(ranked(s),unranked(o)), 'ranked-team-versus-unranked':all(ranked(s),unranked(o)),
      'top-half-underdog':all(ranked(s),gt(value('Ld_s'),0)),'ranked-underdog':all(ranked(s),gt(value('Ld_s'),0)),
      'bottom-half-favorite-against-top-half':all(unranked(s),ranked(o),lt(value('Ld_s'),0)), 'unranked-favorite-against-ranked':all(unranked(s),ranked(o),lt(value('Ld_s'),0)),
      'top-eight-road-favorite':all(top(s),eq(role,'Away'),lt(value('Ld_s'),0)), 'top-ten-road-favorite':all(top(s),eq(role,'Away'),lt(value('Ld_s'),0)),
      'standing-rank-gap-ten':number(o?.rank)==null||number(s?.rank)==null?null:ge(o.rank-s.rank,10),
      'rank-gap-ten-positions':all(ranked(s),ranked(o),number(o?.rank)==null||number(s?.rank)==null?null:ge(o.rank-s.rank,10)),
      'prior-playoff-team-versus-nonplayoff':all(bool(s?.priorSeasonPlayoffParticipant),not(bool(o?.priorSeasonPlayoffParticipant))),
      'fbs-team-versus-fcs':all(eq(s?.classification,'FBS'),eq(o?.classification,'FCS')),
      'new-top-half-team':all(ranked(s),between(s?.priorGameRank,17,32)), 'first-week-ranked-team':all(ranked(s),bool(s?.priorPollUnranked)),
      'both-top-half':all(ranked(h),ranked(a)),'both-ranked':all(ranked(h),ranked(a)),
      'both-top-eight':all(top(h),top(a)),'both-top-ten':all(top(h),top(a)),
      'both-bottom-half':all(unranked(h),unranked(a)),'both-unranked':all(unranked(h),unranked(a)),
    };return conditions[id] ?? null;
  }
  if(data==='S') {
    const diff=(x:any,y:any,n:number)=>number(x)==null||number(y)==null?null:ge(Number(x)-Number(y),n);
    const same=(field:string)=>eq(h?.[field],a?.[field]);
    const sameConference=all(same('conference'),not(eq(h?.conference,'Independent')));
    const conditions:Record<string,Verdict>={
      'rest-advantage':diff(s?.restDays,o?.restDays,3),'bye-versus-regular-rest':all(ge(s?.restDays,12),between(o?.restDays,6,8)),
      'short-rest-versus-regular-rest':all(le(s?.restDays,5),ge(o?.restDays,7)),
      'both-teams-off-bye':all(ge(h?.restDays,12),ge(a?.restDays,12),eq(role,'Home')),
      'third-consecutive-road-game':all(eq(role,'Away'),bool(s?.previousTwoScheduledGamesAwayNonneutral),not(bool(c.neutralSite))),
      'road-team-returns-home':all(eq(role,'Home'),bool(s?.previousTwoCompletedGamesAway)),
      'travel-distance-mismatch':all(ge(s?.travelMiles,1500),le(o?.travelMiles,250)),
      'two-time-zones-of-travel':all(ge(s?.standardTimeZonesCrossed,2),eq(o?.standardTimeZonesCrossed,0)),
      'high-altitude-home-team':all(eq(role,'Home'),ge(c.venueAltitudeFeet,4000),lt(o?.homeBaseAltitudeFeet,2000)),
      'top-eight-opponent-next-game':all(lt(value('Ld_s'),0),between(s?.nextOpponentRank,1,8),between(o?.rank,17,32)),
      'after-top-eight-opponent':all(between(s?.priorOpponentPregameRank,1,8),between(o?.rank,17,32)),
      'top-ten-opponent-next-game':all(lt(value('Ld_s'),0),between(s?.nextOpponentRank,1,10),bool(o?.unranked)),
      'after-top-ten-opponent':all(between(s?.priorOpponentPregameRank,1,10),bool(o?.unranked)),
      'ranked-opponent-next-game':all(lt(value('Ld_s'),0),between(s?.nextOpponentRank,1,25),bool(o?.unranked)),
      'after-ranked-opponent':all(between(s?.priorOpponentPregameRank,1,25),bool(o?.unranked)),
      'rematch-after-loss':all(eq(s?.recentMeetingResult,'L'),le(s?.recentMeetingAgeDays,365)),
      'rematch-after-win':all(eq(s?.recentMeetingResult,'W'),le(s?.recentMeetingAgeDays,365)),
      'new-head-coach-season':all(bool(s?.firstCoachSeason),not(bool(o?.firstCoachSeason))),
      'interim-head-coach':all(bool(s?.interimCoach),not(bool(o?.interimCoach))),
      'both-teams-short-rest':all(le(h?.restDays,5),le(a?.restDays,5)),
      'both-teams-long-rest':all(ge(h?.restDays,12),ge(a?.restDays,12)),
      'one-team-long-rest':h?.restDays==null||a?.restDays==null?null:(h.restDays>=12)!==(a.restDays>=12),
      'neutral-site':bool(c.neutralSite),'division-game':same('division'),'nondivision-game':not(same('division')),
      'afc-versus-nfc':any(all(eq(h?.conference,'AFC'),eq(a?.conference,'NFC')),all(eq(h?.conference,'NFC'),eq(a?.conference,'AFC'))),
      'conference-game':sameConference,'nonconference-game':not(sameConference),
      'fbs-versus-fcs':any(all(eq(h?.classification,'FBS'),eq(a?.classification,'FCS')),all(eq(h?.classification,'FCS'),eq(a?.classification,'FBS'))),
    };return conditions[id] ?? null;
  }
  if(data==='R') {
    const prior=(t:Facts|undefined,n:number,homeOnly=false):Facts[]|null=>{
      if(t?.priorGamesComplete!==true || !Array.isArray(t.priorGames))return null;
      const games=homeOnly?t.priorGames.filter((g:Facts)=>g.role==='Home'):t.priorGames;
      return games.length>=n?games.slice(0,n):null;
    };
    const every=(games:Facts[]|null,f:(g:Facts)=>Verdict)=>games?all(...games.map(f)):null;
    const grade=(g:Facts,code:string)=>g.atsResult==null?null:eq(g.atsResult,code);
    const count=(games:Facts[]|null,field:string,code:string,n:number,atLeast=true):Verdict=>!games||games.some(g=>g[field]==null)?null:atLeast?games.filter(g=>g[field]===code).length>=n:games.filter(g=>g[field]===code).length<=n;
    const first=prior(s,1)?.[0];
    const streak=(t:Facts|undefined,code:string)=>every(prior(t,3),g=>eq(g.totalResult,code));
    const sumScore=(t:Facts|undefined)=>{
      if(t?.priorGamesComplete!==true || !Array.isArray(t.priorGames))return null;
      if(sport==='NCAAF' && t.priorGames.some((g:Facts)=>typeof g.fbsVsFbs!=='boolean'))return null;
      const p=(sport==='NCAAF'?t.priorGames.filter((g:Facts)=>g.fbsVsFbs):t.priorGames).slice(0,3);
      if(p.length<3 || p.some((g:Facts)=>number(g.pointsScored)==null))return null;
      return p.reduce((sum:number,g:Facts)=>sum+Number(g.pointsScored),0)/3;
    };
    const conditions:Record<string,Verdict>={
      'three-game-cover-streak':every(prior(s,3),g=>grade(g,'W')),'three-game-ats-loss-streak':every(prior(s,3),g=>grade(g,'L')),
      'four-covers-in-five':count(prior(s,5),'atsResult','W',4),'one-cover-or-less-in-five':count(prior(s,5),'atsResult','W',1,false),
      'prior-game-large-ats-outperformance':ge(first?.atsMargin,14),'prior-game-large-ats-underperformance':le(first?.atsMargin,-14),
      'prior-game-blowout-win':ge(first?.winMargin,28),'prior-game-blowout-loss':le(first?.winMargin,-28),
      'prior-game-overtime':all(bool(first?.overtime),not(bool(prior(o,1)?.[0]?.overtime))),
      'home-ats-streak':all(eq(role,'Home'),every(prior(s,3,true),g=>grade(g,'W'))),
      'both-teams-on-over-streaks':all(streak(h,'W'),streak(a,'W')),'both-teams-on-under-streaks':all(streak(h,'L'),streak(a,'L')),
      'both-teams-four-overs-in-five':all(count(prior(h,5),'totalResult','W',4),count(prior(a,5),'totalResult','W',4)),
      'both-teams-four-unders-in-five':all(count(prior(h,5),'totalResult','L',4),count(prior(a,5),'totalResult','L',4)),
      'opposing-total-streaks':any(all(streak(h,'W'),streak(a,'L')),all(streak(h,'L'),streak(a,'W'))),
      'both-prior-games-exceeded-total-by-14':all(ge(prior(h,1)?.[0]?.totalMargin,14),ge(prior(a,1)?.[0]?.totalMargin,14)),
      'both-prior-games-missed-total-by-14':all(le(prior(h,1)?.[0]?.totalMargin,-14),le(prior(a,1)?.[0]?.totalMargin,-14)),
      'both-prior-games-had-overtime':all(bool(prior(h,1)?.[0]?.overtime),bool(prior(a,1)?.[0]?.overtime)),
      'both-teams-high-recent-scoring':all(ge(sumScore(h),35),ge(sumScore(a),35)),
      'both-teams-low-recent-scoring':all(le(sumScore(h),20),le(sumScore(a),20)),
    };return conditions[id] ?? null;
  }
  if(data==='X') {
    const books:Array<Facts>|null=Array.isArray(c.books)?c.books:null;
    const moves=books?.map(b=>number(b.support));
    const sourceBook=books?.find(b=>b.id===c.sourceBookId);
    const freshness=(kind:string,minimum:number)=>{
      const x=c[kind];if(!x || x.samePopulation!==true)return null;
      const mine=number(x.ownFinal),other=number(x.oppositeFinal),before=number(x.ownQ60),oppBefore=number(x.oppositeQ60);
      if(mine==null||other==null||before==null||oppBefore==null)return null;
      const p=mine-before,q=other-oppBefore;return p>=0&&q>=0&&p+q>=minimum&&p/(p+q)>=0.7;
    };
    if(id==='three-books-move-together')return !books||new Set(books.map(b=>b.id)).size!==books.length||moves?.some(m=>m==null)?null:Number(moves?.filter(m=>Number(m)>=1).length)>=3&&!moves!.some(m=>Number(m)<=-1);
    if(id==='book-disagreement') {const lines=books?.map(b=>number(b.homeSpreadOrTotal));return !lines||lines.length<2||lines.some(l=>l==null)?null:(['Home','Over'].includes(role))&&Math.max(...lines as number[])-Math.min(...lines as number[])>=1;}
    if(id==='leader-move-spreads-to-other-books'){if(!books||!sourceBook||number(sourceBook.firstSupportTime)==null)return null;return all(ge(sourceBook.support,1),ge(books.filter(b=>b.id!==c.sourceBookId&&number(b.firstSupportTime)!=null&&Number(b.firstSupportTime)-Number(sourceBook.firstSupportTime)>=30*60_000&&Number(b.support)>=1).length,2));}
    if(id==='source-book-alone-moves')return !books?null:all(ge(sourceBook?.support,1),ge(books.filter(b=>b.id!==c.sourceBookId&&b.support===0).length,2));
    if(id==='large-raw-ticket-count')return all(ge(value('bd_s'),70),ge(c.totalTickets,1000));
    if(id==='small-raw-ticket-count')return all(ge(value('bd_s'),70),le(c.totalTickets,100));
    if(id==='large-raw-handle-sharp-gap')return all(ge(value('Gd_s'),25),ge(c.totalHandle,100000));
    if(id==='fresh-money-concentration')return freshness('handle',10000);
    if(id==='fresh-ticket-concentration')return freshness('tickets',100);
  }
  return null;
}
