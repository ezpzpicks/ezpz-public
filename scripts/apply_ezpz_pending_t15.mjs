import fs from "node:fs";

const mlbModelPath = "lib/mlbTrendV2.ts";
const mlbRoutePath = "app/api/public-data-v2/route.ts";
const footballDataPath = "lib/footballPublicData.ts";
const mlbUiPath = "app/page.tsx";
const footballUiPath = "app/FootballBoard.tsx";

let mlbModel = fs.readFileSync(mlbModelPath, "utf8");
let mlbRoute = fs.readFileSync(mlbRoutePath, "utf8");
let footballData = fs.readFileSync(footballDataPath, "utf8");
let mlbUi = fs.readFileSync(mlbUiPath, "utf8");
let footballUi = fs.readFileSync(footballUiPath, "utf8");

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) {
    console.log(`${label}: already applied`);
    return source;
  }
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  console.log(`${label}: applied`);
  return source.replace(from, to);
}

mlbModel = replaceOnce(
  mlbModel,
  'export const MLB_TREND_V2_DECISION_WINDOW_MINUTES = 5.5;',
  'export const MLB_TREND_V2_DECISION_WINDOW_MINUTES = 15;',
  'MLB final window T-15',
);

const dailyRowAnchor = 'function dailyPickRow(pick:AnyRow):AnyRow{';
const pendingHelper = `function pendingV2PickObject(play:V2TrendPlay,today:string,slateRows:AnyRow[],nowMs:number):AnyRow|null{\n  const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);\n  if(start==null||start<=nowMs||!play.v2Direction||!play.v2DailyEligible)return null;\n  const thresholdInfo=slateThresholdForStart(start,slateRows);\n  if(Number(play.v2MarketGap)<thresholdInfo.threshold)return null;\n  const minutesToStart=(start-nowMs)/60000;\n  const base=dailyPickObject({play,threshold:thresholdInfo.threshold,earlyPremium:thresholdInfo.earlyPremium,minutesToStart},today,nowMs);\n  return{...base,snapshotStatus:"LIVE",lockedAt:"",updatedAt:nowET(),verdict:\`PENDING MLB Trend v2 qualifier — \${base.play}\`,confidenceReason:[\`Currently clears the \${thresholdInfo.threshold.toFixed(0)}% V2 Market Gap threshold\`,\`Final evaluation occurs at T-\${MLB_TREND_V2_DECISION_WINDOW_MINUTES} minutes\`],whySelected:[...base.whySelected,\`PENDING until the final T-\${MLB_TREND_V2_DECISION_WINDOW_MINUTES} market lock\`],dataStatus:[\`Trend v2 model \${String(play.v2ModelVersion||MLB_TREND_V2_VERSION)}\`,\`V2 Market Gap \${play.v2MarketGap.toFixed(1)}\`,\`Currently \${minutesToStart.toFixed(1)} minutes before scheduled start\`,\`Final evaluation at T-\${MLB_TREND_V2_DECISION_WINDOW_MINUTES}\`],v2LockedEpoch:undefined};\n}\n`;
if (!mlbRoute.includes('function pendingV2PickObject(')) {
  if (!mlbRoute.includes(dailyRowAnchor)) throw new Error('Missing patch anchor: MLB pending helper');
  mlbRoute = mlbRoute.replace(dailyRowAnchor, `${pendingHelper}${dailyRowAnchor}`);
  console.log('MLB pending helper: applied');
} else console.log('MLB pending helper: already applied');

mlbRoute = replaceOnce(
  mlbRoute,
  `  const legacyAiPicks=Array.isArray(payload.aiPicks)?payload.aiPicks:[];\n  const filteredAiPicks=legacyAiPicks.filter((pick:AnyRow)=>!(isLaunchOrLater(pick?.date||today)&&pureLegacyTrendPick(pick)));\n  for(const lock of todayLocks)filteredAiPicks.push(lock);\n  payload.aiPicks=filteredAiPicks;`,
  `  const legacyAiPicks=Array.isArray(payload.aiPicks)?payload.aiPicks:[];\n  const filteredAiPicks=legacyAiPicks.filter((pick:AnyRow)=>!(isLaunchOrLater(pick?.date||today)&&pureLegacyTrendPick(pick)));\n  const lockedIds=new Set(todayLocks.map((pick:AnyRow)=>String(pick?.candidateId||"")));\n  const pendingV2Picks=scored\n    .map((play)=>pendingV2PickObject(play,today,slateRows,nowMs))\n    .filter((pick):pick is AnyRow=>Boolean(pick))\n    .filter((pick)=>!lockedIds.has(String(pick.candidateId||"")));\n  for(const pendingPick of pendingV2Picks)filteredAiPicks.push(pendingPick);\n  for(const lock of todayLocks)filteredAiPicks.push(lock);\n  payload.aiPicks=filteredAiPicks;`,
  'MLB pending picks in EZPZ payload',
);

mlbRoute = replaceOnce(
  mlbRoute,
  `  const finalCount=filteredAiPicks.filter((pick:AnyRow)=>pick?.snapshotStatus==="FINAL_PREGAME").length;\n  const lockedCount=todayLocks.length;\n  const lockedNames=todayLocks.map(pick=>pick.play).filter(Boolean).join("; ");\n  const trendMessage=lockedCount>0\n    ? \`MLB Trend v2 has \${lockedCount} locked 15%+ pick\${lockedCount===1?"":"s"}: \${lockedNames}. Every additional otherwise-eligible play that reaches 15% will also lock.\`\n    : filteredAiPicks.length\n      ? \`HOT Best Plays are final; MLB Trend v2 will lock every otherwise-eligible play that reaches a 15% Market Gap.\`\n      : \`MLB Trend v2 is tracking the slate. Every otherwise-eligible play that reaches a 15% Market Gap will lock as an EZPZ Pick.\`;`,
  `  const finalCount=filteredAiPicks.filter((pick:AnyRow)=>pick?.snapshotStatus==="FINAL_PREGAME").length;\n  const lockedCount=todayLocks.length;\n  const pendingCount=pendingV2Picks.length;\n  const lockedNames=todayLocks.map(pick=>pick.play).filter(Boolean).join("; ");\n  const pendingNames=pendingV2Picks.map(pick=>pick.play).filter(Boolean).join("; ");\n  const trendMessage=pendingCount>0\n    ? \`MLB Trend v2 has \${pendingCount} PENDING 15%+ qualifier\${pendingCount===1?"":"s"} awaiting the T-\${MLB_TREND_V2_DECISION_WINDOW_MINUTES} final lock: \${pendingNames}.\${lockedCount?\` \${lockedCount} pick\${lockedCount===1?" is":"s are"} already FINAL: \${lockedNames}.\`:""}\`\n    : lockedCount>0\n      ? \`MLB Trend v2 has \${lockedCount} FINAL 15%+ pick\${lockedCount===1?"":"s"}: \${lockedNames}. New qualifiers appear as PENDING before T-\${MLB_TREND_V2_DECISION_WINDOW_MINUTES}.\`\n      : filteredAiPicks.length\n        ? \`HOT Best Plays are final; any MLB Trend v2 play that currently clears 15% appears as PENDING until the T-\${MLB_TREND_V2_DECISION_WINDOW_MINUTES} final lock.\`\n        : \`MLB Trend v2 is tracking the slate. A play appears as PENDING as soon as it currently clears 15%, then becomes FINAL only at the T-\${MLB_TREND_V2_DECISION_WINDOW_MINUTES} lock.\`;`,
  'MLB pending status message',
);

footballData = replaceOnce(
  footballData,
  'message:aiPicks.length?`${sport} EZPZ Picks are live for ${today}: HOT Best Plays plus all-green Strong/Elite Trend Plays with 10%+ net ROI advantage; max price -150.`:`No ${sport} EZPZ Picks for ${today} currently qualify under the HOT / all-green 10%+ ROI / Strong-Elite / -150 rules.`',
  'message:aiPicks.length?`${sport} EZPZ Picks are live for ${today}: HOT Best Plays are FINAL immediately; currently qualifying all-green Strong/Elite Trend Plays appear as PENDING until the T-15 final market lock; max price -150.`:`No ${sport} EZPZ Picks for ${today} currently qualify under the HOT / all-green 10%+ ROI / Strong-Elite / -150 rules. Qualifying Trend Plays will appear as PENDING before the T-15 final lock.`',
  'football pending status copy',
);

mlbUi = mlbUi.replaceAll('LIVE — NOT LOCKED', 'PENDING');
footballUi = footballUi.replaceAll('LIVE — NOT LOCKED', 'PENDING');

fs.writeFileSync(mlbModelPath, mlbModel);
fs.writeFileSync(mlbRoutePath, mlbRoute);
fs.writeFileSync(footballDataPath, footballData);
fs.writeFileSync(mlbUiPath, mlbUi);
fs.writeFileSync(footballUiPath, footballUi);
console.log('Applied universal T-15 finalization and PENDING EZPZ preview behavior.');
