import fs from "node:fs";

function replaceOnce(text, oldText, newText, label) {
  if (text.includes(newText)) return text;
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 target, found ${count}`);
  return text.replace(oldText, newText);
}

const path = "lib/footballPublicData.ts";
let text = fs.readFileSync(path, "utf8");

const oldTrendMatch = `    if(resultCode(row.Result)) return row; const game=finals.find((g)=>{const gid=String(g["Game ID"]||"");const rid=String(row["Game Key"]||"");return gid&&rid?gid===rid:sameTeam(g["Away Team"],row["Away Team"],sport)&&sameTeam(g["Home Team"],row["Home Team"],sport);}); if(!game)return row;`;
const newTrendMatch = `    if(resultCode(row.Result)) return row;
    const rowGame=String(row.Game||row.Matchup||"").trim();
    const rowParts=rowGame.split(/\\s+@\\s+/);
    const rowAway=String(row["Away Team"]||(rowParts.length===2?rowParts[0]:"")).trim();
    const rowHome=String(row["Home Team"]||(rowParts.length===2?rowParts[1]:"")).trim();
    const game=finals.find((g)=>{
      const gid=String(g["Game ID"]||g["Game Key"]||"").trim();
      const rid=String(row["Game Key"]||row["Game ID"]||"").trim();
      if(gid&&rid&&gid===rid)return true;
      return Boolean(rowAway&&rowHome&&sameTeam(g["Away Team"],rowAway,sport)&&sameTeam(g["Home Team"],rowHome,sport));
    });
    if(!game)return row;`;
text = replaceOnce(text, oldTrendMatch, newTrendMatch, "CFB trend final game matching");

const oldSpread = `    if(row.Market==="Spread"){const selectedHome=sameTeam(row.Selection,row["Home Team"],sport);const margin=selectedHome?home-away:away-home;const value=margin+line;result=value>0?"Win":value<0?"Loss":"Push";} else {`;
const newSpread = `    if(row.Market==="Spread"){
      const selectedHome=sameTeam(row.Selection,game["Home Team"],sport);
      const selectedAway=sameTeam(row.Selection,game["Away Team"],sport);
      if(!selectedHome&&!selectedAway)return row;
      const margin=selectedHome?home-away:away-home;
      const value=margin+line;
      result=value>0?"Win":value<0?"Loss":"Push";
    } else {`;
text = replaceOnce(text, oldSpread, newSpread, "CFB trend spread selection matching");

const oldPendingDates = `  const pendingTrackerDates=[...new Set(trackerRaw
    .filter((row)=>!resultCode(row.Result||row.Status))
    .map((row)=>isoDate(row.Date||row["Game Date"]||""))
    .filter((date)=>{
      if(!date||date>today)return false;
      const current=Date.parse(today+"T12:00:00Z"),stamp=Date.parse(date+"T12:00:00Z");
      return Number.isFinite(current)&&Number.isFinite(stamp)&&current-stamp<=14*86_400_000;
    }))].sort();
  const pendingLiveSchedule=pendingTrackerDates.length
    ? await loadFootballWeekSchedule(sport,pendingTrackerDates[0],pendingTrackerDates[pendingTrackerDates.length-1])
    : [];`;
const newPendingDates = `  const pendingRecordDates=[...new Set([...trackerRaw,...trendExisting]
    .filter((row)=>!resultCode(row.Result||row.Status))
    .map((row)=>isoDate(row.Date||row["Game Date"]||""))
    .filter((date)=>{
      if(!date||date>today)return false;
      const current=Date.parse(today+"T12:00:00Z"),stamp=Date.parse(date+"T12:00:00Z");
      return Number.isFinite(current)&&Number.isFinite(stamp)&&current-stamp<=14*86_400_000;
    }))].sort();
  const pendingLiveSchedule=pendingRecordDates.length
    ? await loadFootballWeekSchedule(sport,pendingRecordDates[0],pendingRecordDates[pendingRecordDates.length-1])
    : [];`;
text = replaceOnce(text, oldPendingDates, newPendingDates, "load finals for pending CFB trend dates");

fs.writeFileSync(path, text);
console.log("Fixed CFB trend result grading, team fallback matching, and historical trend final-score loading.");
