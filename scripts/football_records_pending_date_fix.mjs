import fs from "node:fs";

function replaceOnce(text, oldText, newText, label) {
  if (text.includes(newText)) return text;
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 target, found ${count}`);
  return text.replace(oldText, newText);
}

const path = "lib/footballPublicData.ts";
let text = fs.readFileSync(path, "utf8");

const oldMerge = `function mergeFootballSchedules(saved: SheetRow[], live: SheetRow[], sport: FootballSport) {
  const merged = new Map<string, SheetRow>();
  for (const row of live) merged.set(footballScheduleKey(row, sport), row);
  for (const row of saved) {
    const key = footballScheduleKey(row, sport);
    merged.set(key, nonEmptyMerge(merged.get(key) || {}, row));
  }
  return [...merged.values()];
}`;
const newMerge = `function mergeFootballSchedules(saved: SheetRow[], live: SheetRow[], sport: FootballSport) {
  const merged = new Map<string, SheetRow>();
  for (const row of saved) merged.set(footballScheduleKey(row, sport), row);
  for (const row of live) {
    const key = footballScheduleKey(row, sport);
    merged.set(key, nonEmptyMerge(merged.get(key) || {}, row));
  }
  return [...merged.values()];
}`;
text = replaceOnce(text, oldMerge, newMerge, "prefer live football schedule status and scores");

const oldScheduleBlock = `  const footballSchedule=mergeFootballSchedules(schedule,liveSchedule,sport);
  const trackingSlate=mergeFootballTrackingSlate(slateAll,footballSchedule,sport,today);`;
const newScheduleBlock = `  const footballSchedule=mergeFootballSchedules(schedule,liveSchedule,sport);
  const pendingTrackerDates=[...new Set(trackerRaw
    .filter((row)=>!resultCode(row.Result||row.Status))
    .map((row)=>isoDate(row.Date||row["Game Date"]||""))
    .filter((date)=>{
      if(!date||date>today)return false;
      const current=Date.parse(today+"T12:00:00Z"),stamp=Date.parse(date+"T12:00:00Z");
      return Number.isFinite(current)&&Number.isFinite(stamp)&&current-stamp<=14*86_400_000;
    }))].sort();
  const pendingLiveSchedule=pendingTrackerDates.length
    ? await loadFootballWeekSchedule(sport,pendingTrackerDates[0],pendingTrackerDates[pendingTrackerDates.length-1])
    : [];
  const settlementSchedule=mergeFootballSchedules(footballSchedule,pendingLiveSchedule,sport);
  const trackingSlate=mergeFootballTrackingSlate(slateAll,footballSchedule,sport,today);`;
text = replaceOnce(text, oldScheduleBlock, newScheduleBlock, "load final scores for recently pending Best Plays");
text = replaceOnce(text, "  let trendRows=settleTrendRows(trendExisting,footballSchedule,sport);", "  let trendRows=settleTrendRows(trendExisting,settlementSchedule,sport);", "grade trends against settlement schedule");
text = replaceOnce(text, "  const trackerSettlement=settleBestPlayTracker(trackerRaw,footballSchedule,sport);", "  const trackerSettlement=settleBestPlayTracker(trackerRaw,settlementSchedule,sport);", "grade Best Plays against settlement schedule");

fs.writeFileSync(path, text);
console.log("CFB Records grading now loads pending game dates across weekly rollover and prefers live final scores.");
