const clock=Date.parse('2026-11-14T12:01:00Z');
function fixture(api,{margin=14,total=64,homeLine=-4,totalLine=54,policy=api.NCAAF_MATCHUP_POLICY,a=10,b=8}={}){
 const f={away:{team:'Away',offense:20,defense:35,tempo:13},home:{team:'Home',offense:40,defense:17,tempo:13},
  season:2026,observed_at:'2026-11-14T11:00:00Z',population_sha256:'a'.repeat(64),
  source:'Bill Connelly SP+ via CFB Update',source_url:'https://pay.cfbupdate.com/sp-ratings',
  pace_source:'SportsDataverse',pace_through_week:11,
  national:{offense:{mean:27,sd:7,teams:138},defense:{mean:27,sd:7,teams:138},tempo:{mean:12,sd:1,teams:138}}};
 const p={model_version:api.NCAAF_PROJECTION_MODEL,status:'provisional',data_as_of:'2026-11-14T12:00:00Z',
  kickoff:'2026-11-14T23:00:00Z',source_population_sha256:f.population_sha256,sha256:'c'.repeat(64),tempo_scale:1,
  away_points:(total-margin)/2,home_points:(total+margin)/2,margin,total,
  pairings:{away:{pace_adjusted_points:20},home:{pace_adjusted_points:30}}};
 const tier=edge=>edge>=a?'A':edge>=b?'B':'Research';
 const common={reason:'Point edge',as_of:p.data_as_of,published_at:p.data_as_of,kickoff:p.kickoff,
  policy_version:policy,policy_sha256:'b'.repeat(64),source_population_sha256:f.population_sha256,
  projection_model_version:api.NCAAF_PROJECTION_MODEL,projection_sha256:p.sha256,record_mode:'live',status:'provisional',
  grading_basis:'market_point_edge',confidence_flags:['Provisional model'],
  thresholds:{extreme_z:1,spread_max_market_line:20,spread_a_points:a,spread_b_points:b,total_a_points:a,total_b_points:b}};
 const spread={...common,grade:Math.abs(homeLine)>=20?'Research':tier(Math.abs(margin+homeLine)),edge_grade:tier(Math.abs(margin+homeLine)),
  eligible:Math.abs(margin+homeLine)>=b&&Math.abs(homeLine)<20,side:margin+homeLine>=0?'home':'away',
  selection_team:margin+homeLine>=0?'Home':'Away',line:margin+homeLine>=0?homeLine:-homeLine,
  home_line:homeLine,projected_margin:margin,edge:Math.abs(margin+homeLine)};
 const totals={...common,grade:tier(Math.abs(total-totalLine)),edge_grade:tier(Math.abs(total-totalLine)),
  eligible:Math.abs(total-totalLine)>=b,side:total>=totalLine?'Over':'Under',line:totalLine,
  projected_total:total,edge:Math.abs(total-totalLine)};
 const row={Date:'2026-11-14',Season:'2026','Game ID':'edge-test','Away Team':'Away','Home Team':'Home',
  Game:'Away @ Home','Game Time':p.kickoff,'Build Captured At':p.data_as_of,'Model Version':api.NCAAF_PROJECTION_MODEL,
  'Grading Policy Version':policy,'Projection Engine':api.NCAAF_PROJECTION_MODEL,
  'Projected Away':String(p.away_points),'Projected Home':String(p.home_points),'Projected Margin':String(margin),'Projected Total':String(total),
  'Market Home Spread':String(homeLine),'Market Total':String(totalLine),
  'Spread Pick':`${spread.selection_team} ${spread.line>=0?'+':''}${spread.line}`,'Spread Grade':spread.grade==='Research'?'No Play':`${spread.grade} Spread`,
  'Spread Edge':String(spread.edge),'Spread Probability':'.65','Margin Residual SD':'18','Spread Odds':'-110',
  'Total Pick':`${totals.side} ${totalLine}`,'Total Grade':totals.grade==='Research'?'No Play':`${totals.grade} Total`,
  'Total Edge':String(totals.edge),'Total Probability':'.65','Total Odds':'-110',
  'Matchup Factors JSON':JSON.stringify(f),'Matchup Projection JSON':JSON.stringify(p),
  'Matchup Spread JSON':JSON.stringify(spread),'Matchup Total JSON':JSON.stringify(totals),
  'Research Snapshot JSON':JSON.stringify({captureStatus:'PRE_GAME',gameId:'edge-test',capturedAt:p.data_as_of,simulation:{totals_sd:15}})};
 return{row,f,p,spread,total:totals};
}
module.exports={fixture,clock};
