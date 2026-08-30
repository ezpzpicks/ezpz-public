import fs from "node:fs";

const path = "lib/footballPublicData.ts";
let text = fs.readFileSync(path, "utf8");

const oldBlock = `function trackerFinal(row: SheetRow, schedule: SheetRow[], sport: FootballSport) {
  const rowId = String(row["Game ID"] || row["Game Key"] || "").trim();
  return schedule.find((game) => {
    const complete = truthy(game.Completed) || (String(game["Away Score"] ?? "") !== "" && String(game["Home Score"] ?? "") !== "");
    if (!complete) return false;
    const gameId = String(game["Game ID"] || game["Game Key"] || "").trim();
    if (rowId && gameId) return rowId === gameId;
    return sameTeam(row["Away Team"], game["Away Team"], sport) && sameTeam(row["Home Team"], game["Home Team"], sport);
  });
}`;

const newBlock = `function trackerFinal(row: SheetRow, schedule: SheetRow[], sport: FootballSport) {
  const rowId = String(row["Game ID"] || row["Game Key"] || "").trim();
  const gameLabel = String(row.Game || row.Matchup || "").trim();
  const parts = gameLabel.split(/\\s+@\\s+/);
  const rowAway = String(row["Away Team"] || (parts.length === 2 ? parts[0] : "")).trim();
  const rowHome = String(row["Home Team"] || (parts.length === 2 ? parts[1] : "")).trim();
  return schedule.find((game) => {
    const complete = truthy(game.Completed) || (String(game["Away Score"] ?? "") !== "" && String(game["Home Score"] ?? "") !== "");
    if (!complete) return false;
    const gameId = String(game["Game ID"] || game["Game Key"] || "").trim();
    if (rowId && gameId && rowId === gameId) return true;
    return Boolean(rowAway && rowHome && sameTeam(rowAway, game["Away Team"], sport) && sameTeam(rowHome, game["Home Team"], sport));
  });
}`;

if (!text.includes(newBlock)) {
  const count = text.split(oldBlock).length - 1;
  if (count !== 1) throw new Error(`CFB records game-match fix: expected 1 trackerFinal block, found ${count}`);
  text = text.replace(oldBlock, newBlock);
}

fs.writeFileSync(path, text);
console.log("Fixed CFB completed-game matching for Best Play grading.");
