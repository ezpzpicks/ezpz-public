import fs from "node:fs";
import path from "node:path";

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function write(relativePath, source) {
  fs.writeFileSync(path.join(process.cwd(), relativePath), source);
}

function replaceOnce(source, oldValue, newValue, label) {
  if (source.includes(newValue)) return { source, changed: false };
  if (!source.includes(oldValue)) {
    throw new Error(`Trend V2 patch could not locate ${label}.`);
  }
  return { source: source.replace(oldValue, newValue), changed: true };
}

let changed = false;

// ---------------------------------------------------------------------------
// DraftKings Trend V2 grading
// ---------------------------------------------------------------------------
const routePath = "app/api/public-data-v2/route.ts";
let route = read(routePath);

const lifecycleImport = 'import { applyMlbTrendV2Adaptive } from "../../../lib/mlbTrendV2Lifecycle";';
const storeImport = 'import { readWorksheet as readMlbWorksheet } from "../../../lib/mlbStore";';
if (!route.includes(storeImport)) {
  if (!route.includes(lifecycleImport)) {
    throw new Error("Trend V2 patch could not locate lifecycle import.");
  }
  route = route.replace(lifecycleImport, `${lifecycleImport}\n${storeImport}`);
  changed = true;
}

const gradingMarker = "// AUTHORITATIVE_TREND_V2_GRADING_V1";
if (!route.includes(gradingMarker)) {
  const startMarker = "function normalize(value:unknown){return String(value||\"\").toLowerCase().replace(/[^a-z0-9]+/g,\" \").replace(/\\s+/g,\" \").trim()}\nfunction gradeDailyPick";
  const start = route.indexOf(startMarker);
  const end = start >= 0 ? route.indexOf("\n\nasync function postProcessMlbPayload", start) : -1;
  if (start < 0 || end < 0) {
    throw new Error("Trend V2 patch could not locate gradeDailyPick block.");
  }

  const gradingBlock = `function normalize(value:unknown){return String(value||\"\").toLowerCase().replace(/[^a-z0-9]+/g,\" \").replace(/\\s+/g,\" \").trim()}

// AUTHORITATIVE_TREND_V2_GRADING_V1
// Daily Trend V2 picks are frozen wagers. Grade them from all_game_trends,
// never from the display-only trendRecordRows. The pick's saved side/line/odds
// remain authoritative while any completed row for the same game may supply the
// final score.
const MLB_GRADE_ABBR:Record<string,string>={bal:\"orioles\",bos:\"red sox\",nyy:\"yankees\",tb:\"rays\",tbr:\"rays\",tor:\"blue jays\",cws:\"white sox\",cle:\"guardians\",det:\"tigers\",kc:\"royals\",kcr:\"royals\",min:\"twins\",hou:\"astros\",laa:\"angels\",ath:\"athletics\",oak:\"athletics\",sea:\"mariners\",tex:\"rangers\",atl:\"braves\",mia:\"marlins\",nym:\"mets\",phi:\"phillies\",wsh:\"nationals\",was:\"nationals\",chc:\"cubs\",cin:\"reds\",mil:\"brewers\",pit:\"pirates\",stl:\"cardinals\",ari:\"diamondbacks\",az:\"diamondbacks\",col:\"rockies\",lad:\"dodgers\",sd:\"padres\",sdp:\"padres\",sf:\"giants\",sfg:\"giants\"};
function gradeTeamIdentity(value:unknown){
  const cleaned=normalize(value).replace(/\\b(?:moneyline|ml)\\b/g,\" \").replace(/\\b\\d+(?:\\.\\d+)?\\b/g,\" \").replace(/\\s+/g,\" \").trim();
  if(!cleaned)return\"\";
  if(MLB_GRADE_ABBR[cleaned])return MLB_GRADE_ABBR[cleaned];
  for(const multi of [\"red sox\",\"white sox\",\"blue jays\"]){if(cleaned.endsWith(multi))return multi}
  const tokens=cleaned.split(\" \").filter(Boolean);
  const last=tokens[tokens.length-1]||cleaned;
  return MLB_GRADE_ABBR[last]||last;
}
function sameGradeTeam(left:unknown,right:unknown){const a=gradeTeamIdentity(left),b=gradeTeamIdentity(right);return Boolean(a&&b&&a===b)}
function gradeNumber(value:unknown){const raw=String(value??\"\").trim();if(!raw)return null;const match=raw.match(/-?\\d+(?:\\.\\d+)?/);if(!match)return null;const parsed=Number(match[0]);return Number.isFinite(parsed)?parsed:null}
function gradeResult(value:unknown){const raw=String(value||\"\").trim().toUpperCase();if(raw.startsWith(\"W\"))return\"W\";if(raw.startsWith(\"L\"))return\"L\";if(raw.startsWith(\"P\"))return\"P\";return\"\"}
function totalGradeSide(value:unknown){const raw=normalize(value);if(raw.includes(\"under\"))return\"under\";if(raw.includes(\"over\"))return\"over\";return\"\"}
function sameGradeGame(row:AnyRow,pick:AnyRow){
  if(isoDate(row?.Date||row?.date)!==isoDate(pick.date))return false;
  const pk=cleanGameKey(pick.gameKey),rk=cleanGameKey(row?.[\"Game Key\"]||row?.gameKey);
  if(pk&&rk)return pk===rk;
  const rowAway=row?.[\"Away Team\"]||row?.awayTeam,rowHome=row?.[\"Home Team\"]||row?.homeTeam;
  if(rowAway&&rowHome&&pick.awayTeam&&pick.homeTeam)return sameGradeTeam(rowAway,pick.awayTeam)&&sameGradeTeam(rowHome,pick.homeTeam);
  const rg=normalize(row?.Game||row?.game),pg=normalize(pick.game);
  return Boolean(rg&&pg&&(rg===pg||rg.includes(pg)||pg.includes(rg)));
}
function sameFrozenTrendPick(row:AnyRow,pick:AnyRow){
  if(!sameGradeGame(row,pick))return false;
  if(String(row?.Market||row?.market||\"\").trim().toLowerCase()!==String(pick.market||\"\").trim().toLowerCase())return false;
  if(String(pick.market||\"\").toLowerCase()===\"total\"){
    const pickSide=totalGradeSide(pick.selection||pick.play),rowSide=totalGradeSide(row?.Side||row?.Selection||row?.selection);
    if(!pickSide||rowSide!==pickSide)return false;
    const pickLine=gradeNumber(pick.line||pick.play||pick.selection),rowLine=gradeNumber(row?.Line||row?.[\"Odds/Line\"]||row?.Selection||row?.selection);
    return pickLine!=null&&rowLine!=null&&Math.abs(pickLine-rowLine)<0.001;
  }
  return sameGradeTeam(row?.Selection||row?.selection||row?.Side,pick.selection||pick.play);
}
function finalScoreForTrendPick(pick:AnyRow,records:AnyRow[]){
  for(const row of records){
    if(!sameGradeGame(row,pick))continue;
    const away=gradeNumber(row?.[\"Actual Away Runs\"]),home=gradeNumber(row?.[\"Actual Home Runs\"]);
    if(away!=null&&home!=null)return{row,away,home,total:gradeNumber(row?.[\"Actual Total\"])??away+home};
  }
  return null;
}
function gradeDailyPick(pick:AnyRow,records:AnyRow[]):AnyRow{
  const frozenRecord=records.find(row=>sameFrozenTrendPick(row,pick));
  if(!frozenRecord)return pick;
  const finalScore=finalScoreForTrendPick(pick,records);
  let result=\"\";
  if(finalScore){
    if(String(pick.market||\"\").toLowerCase()===\"total\"){
      const line=gradeNumber(pick.line||pick.play||pick.selection),side=totalGradeSide(pick.selection||pick.play);
      if(line!=null&&side){result=Math.abs(finalScore.total-line)<0.001?\"P\":side===\"over\"?(finalScore.total>line?\"W\":\"L\"):(finalScore.total<line?\"W\":\"L\")}
    }else if(String(pick.market||\"\").toLowerCase()===\"moneyline\"&&finalScore.away!==finalScore.home){
      const awayTeam=finalScore.row?.[\"Away Team\"]||finalScore.row?.awayTeam||pick.awayTeam;
      const homeTeam=finalScore.row?.[\"Home Team\"]||finalScore.row?.homeTeam||pick.homeTeam;
      const winner=finalScore.away>finalScore.home?awayTeam:homeTeam;
      if(gradeTeamIdentity(pick.selection||pick.play)&&gradeTeamIdentity(winner))result=sameGradeTeam(pick.selection||pick.play,winner)?\"W\":\"L\";
    }
  }
  if(!result)result=gradeResult(frozenRecord?.Result||frozenRecord?.result);
  if(!result)return pick;
  // Always settle units from the pick's locked odds. A later source row may have
  // a different price (for example Pittsburgh +112 must settle +1.12, not +1.09).
  const units=round(resultProfit(result,pick.odds),2);
  if(pick.result===result&&Math.abs(Number(pick.units||0)-units)<0.005)return pick;
  return{...pick,result,units,resultUpdated:nowET(),updatedAt:nowET()};
}`;

  route = route.slice(0, start) + gradingBlock + route.slice(end);
  changed = true;
}

const oldGradeCall = 'const graded=dailyPicks.map(pick=>gradeDailyPick(pick,Array.isArray(payload.trendRecordRows)?payload.trendRecordRows:[]));';
const newGradeCall = `let authoritativeTrendRows:AnyRow[]=[];
  try{authoritativeTrendRows=await readMlbWorksheet(\"all_game_trends\")}catch(error){console.error(\"Trend v2 authoritative grading read failed\",error)}
  const graded=dailyPicks.map(pick=>gradeDailyPick(pick,authoritativeTrendRows));`;
if (!route.includes(newGradeCall)) {
  if (!route.includes(oldGradeCall)) {
    throw new Error("Trend V2 patch could not locate displayed-record grading call.");
  }
  route = route.replace(oldGradeCall, newGradeCall);
  changed = true;
}

write(routePath, route);

// ---------------------------------------------------------------------------
// Current Model EZPZ naming + policy wording
// ---------------------------------------------------------------------------
const corePath = "app/api/public-data-core.ts";
let core = read(corePath);
for (const [oldValue, newValue] of [
  ["// PERMANENT EZPZ PICKS POLICY. Best Play qualification is market-specific.", "// PERMANENT EZPZ PICKS POLICY. Model EZPZ Pick qualification is market-specific."],
  ["EZPZ Best Play is final for the full day; no separate pregame finalization is required", "Model EZPZ Pick is final for the full day; no separate pregame finalization is required"],
  ["Qualified as a Best Play", "Qualified as a Model EZPZ Pick"],
  ["priority market-specific Best Play / Strong/Elite qualification", "priority market-specific Model EZPZ Pick / Strong/Elite qualification"],
  ["Best Play and Strong/Elite Trend Play paths", "Model EZPZ Pick and Strong/Elite Trend Play paths"],
  [" Best Play path; it locks", " Model EZPZ Pick path; it locks"],
]) {
  if (core.includes(oldValue)) {
    core = core.split(oldValue).join(newValue);
    changed = true;
  }
}

const stalePolicyStart = "For any candidate backed by a Best Play, its exact Best Play bet type uses the rolling Last-7-Bets quantitative gates:";
const stalePolicyEnd = "The AI is the qualitative filter; the selector remains the final numeric gatekeeper.";
if (core.includes(stalePolicyStart)) {
  const start = core.indexOf(stalePolicyStart);
  const end = core.indexOf(stalePolicyEnd, start);
  if (end < 0) throw new Error("Model EZPZ wording patch could not locate stale policy end.");
  const currentPolicy = "For any candidate backed by a Model EZPZ Pick, use the existing market-specific Model EZPZ qualification gate; do not apply the retired HOT-only / rolling Last-7-Bets rule. Moneyline requires model edge at least 8%, Bayesian form at least 55%, at least 7 historical decisions, and odds no worse than -150. Totals require selected probability at least 70%, projection edge at least 2%, and odds no worse than -150. First Inning requires an Elite model grade, selected probability at least 68%, and odds no worse than -150. Pitcher Strikeouts require reliability at least 80%, selected probability at least 65%, and odds no worse than -150. DraftKings Trend V2 is a separate path: it uses the 15% V2 Market Gap plus RLM gate with its own guardrails and lock logic. Never substitute the Model EZPZ gate for DraftKings Trend V2 or vice versa. The selector remains the final numeric gatekeeper.";
  core = core.slice(0, start) + currentPolicy + core.slice(end + stalePolicyEnd.length);
  changed = true;
}
write(corePath, core);

const pagePath = "app/page.tsx";
let page = read(pagePath);
for (const [oldValue, newValue] of [
  ["EZPZ Best Play is final for the full day", "Model EZPZ Pick is final for the full day"],
  ["EZPZ Best Play saved as final for the full day", "Model EZPZ Pick saved as final for the full day"],
  ['normalizeType(pick.bestPlayType || "Best Play")', 'normalizeType(pick.bestPlayType || "Model EZPZ Pick")'],
]) {
  if (page.includes(oldValue)) {
    page = page.split(oldValue).join(newValue);
    changed = true;
  }
}
write(pagePath, page);

console.log(changed
  ? "Applied Trend V2 authoritative grading and Model EZPZ naming patch."
  : "Trend V2 grading and Model EZPZ naming patch is already present.");
