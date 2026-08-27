import fs from "node:fs";

const path = "app/FootballBoard.tsx";
let text = fs.readFileSync(path, "utf8");

const typeBefore = '  game: string; market: "Spread" | "Total"; selection: string; selectionTeam: string;';
const typeAfter = '  game: string; awayTeam?: string; homeTeam?: string; market: "Spread" | "Total"; selection: string; selectionTeam: string;';
if (text.includes(typeBefore)) text = text.replace(typeBefore, typeAfter);

const keyBlock = `function textKey(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}`;
const helperBlock = `${keyBlock}

function sameSlateTeam(a: unknown, b: unknown) {
  const left = textKey(a);
  const right = textKey(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const compactLeft = left.replace(/\\s+/g, "");
  const compactRight = right.replace(/\\s+/g, "");
  if (compactLeft.includes(compactRight) || compactRight.includes(compactLeft)) return true;
  const leftParts = left.split(" ").filter(Boolean);
  const rightParts = right.split(" ").filter(Boolean);
  const leftLast = leftParts[leftParts.length - 1] || "";
  const rightLast = rightParts[rightParts.length - 1] || "";
  return leftLast.length >= 3 && leftLast === rightLast;
}

function splitMatchesTeams(awayTeam: unknown, homeTeam: unknown, split: DraftKingsSplit) {
  return Boolean(split.awayTeam && split.homeTeam &&
    sameSlateTeam(awayTeam, split.awayTeam) && sameSlateTeam(homeTeam, split.homeTeam));
}`;
if (text.includes(keyBlock) && !text.includes("function sameSlateTeam")) text = text.replace(keyBlock, helperBlock);

const selectedBefore = `function selectedSplit(play: Play, splits: DraftKingsSplit[]) {
  const role = textKey(play.role || play.playType);
  if (role.includes("total")) {
    const side = textKey(play.play).startsWith("under") ? "Under" : "Over";
    return splits.find((split) => split.game === play.game && split.market === "Total" && split.side === side) ||
      splits.find((split) => split.market === "Total" && split.side === side && textKey(split.game) === textKey(play.game));
  }
  const selection = textKey(String(play.play).replace(/\\s+[+-]?\\d+(?:\\.\\d+)?(?:\\s|$).*/, ""));
  return splits.find((split) => split.market === "Spread" && textKey(split.selectionTeam) === selection && textKey(split.game) === textKey(play.game)) ||
    splits.find((split) => split.market === "Spread" && (textKey(play.play).includes(textKey(split.selectionTeam)) || textKey(split.selectionTeam).includes(selection)));
}`;
const selectedAfter = `function selectedSplit(play: Play, splits: DraftKingsSplit[]) {
  const role = textKey(play.role || play.playType);
  const sameGame = (split: DraftKingsSplit) => textKey(split.game) === textKey(play.game) ||
    splitMatchesTeams(play.awayTeam, play.homeTeam, split);
  if (role.includes("total")) {
    const side = textKey(play.play).startsWith("under") ? "Under" : "Over";
    return splits.find((split) => split.market === "Total" && split.side === side && sameGame(split));
  }
  const selection = textKey(String(play.play).replace(/\\s+[+-]?\\d+(?:\\.\\d+)?(?:\\s|$).*/, ""));
  return splits.find((split) => split.market === "Spread" && sameGame(split) &&
      (textKey(split.selectionTeam) === selection || sameSlateTeam(play.play, split.selectionTeam))) ||
    splits.find((split) => split.market === "Spread" && (textKey(play.play).includes(textKey(split.selectionTeam)) || textKey(split.selectionTeam).includes(selection)));
}`;
if (text.includes(selectedBefore)) text = text.replace(selectedBefore, selectedAfter);

const slateBefore = '  const gameSplits = splits.filter((split) => textKey(split.game) === textKey(game));';
const slateAfter = '  const gameSplits = splits.filter((split) => textKey(split.game) === textKey(game) || splitMatchesTeams(row["Away Team"], row["Home Team"], split));';
if (text.includes(slateBefore)) text = text.replace(slateBefore, slateAfter);
else if (!text.includes(slateAfter)) throw new Error("Could not find football Full Slate split matcher");

const displayBefore = '{split.market}: {split.selection} {split.odds} • {split.betsPct}% bets / {split.moneyPct}% handle';
const displayAfter = '{split.market}: {split.selection} {split.odds} • {split.betsPct}% bets / {split.moneyPct}% handle • {split.warning}';
if (text.includes(displayBefore)) text = text.replace(displayBefore, displayAfter);

fs.writeFileSync(path, text);
console.log("patched football Full Slate DraftKings team matching and split display");
