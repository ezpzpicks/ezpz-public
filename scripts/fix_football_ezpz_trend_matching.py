from pathlib import Path


board = Path("app/FootballBoard.tsx")
text = board.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if new in text:
        print(f"{label}: already applied")
        return
    if old not in text:
        raise SystemExit(f"Could not find patch target: {label}")
    text = text.replace(old, new, 1)
    print(f"{label}: applied")


matchup_anchor = '''function fbComparableGame(value: unknown) {
  return textKey(value).replace(/\\b(?:at|vs|versus)\\b/g, " ").replace(/\\s+/g, " ").trim();
}
'''
matchup_helpers = matchup_anchor + r'''

function fbMatchupTeams(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const atParts = raw.split(/\s*@\s*/).map((part) => part.trim()).filter(Boolean);
  if (atParts.length === 2) return { away: atParts[0], home: atParts[1] };
  const wordParts = raw.split(/\s+(?:at|vs\.?|versus)\s+/i).map((part) => part.trim()).filter(Boolean);
  return wordParts.length === 2 ? { away: wordParts[0], home: wordParts[1] } : null;
}

function fbSameGame(a: unknown, b: unknown) {
  const left = fbComparableGame(a);
  const right = fbComparableGame(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTeams = fbMatchupTeams(a);
  const rightTeams = fbMatchupTeams(b);
  if (!leftTeams || !rightTeams) return false;
  return sameSlateTeam(leftTeams.away, rightTeams.away)
    && sameSlateTeam(leftTeams.home, rightTeams.home);
}
'''
replace_once(matchup_anchor, matchup_helpers, "add matchup-aware game matching")

replace_once(
    '  const sameGame = (split: DraftKingsSplit) => fbComparableGame(split.game) === fbComparableGame(pick.game);',
    '  const sameGame = (split: DraftKingsSplit) => fbSameGame(split.game, pick.game);',
    "match EZPZ picks to split games",
)

replace_once(
    '  const sameMarket = trendPlays.filter((play) => fbComparableGame(play.game) === fbComparableGame(pick.game) && play.market === pick.market);',
    '  const sameMarket = trendPlays.filter((play) => fbSameGame(play.game, pick.game) && play.market === pick.market);',
    "match EZPZ picks to trend games",
)

replace_once(
    '    .filter((candidate) => fbComparableGame(candidate.game) === fbComparableGame(play.game) && candidate.market === play.market)',
    '    .filter((candidate) => fbSameGame(candidate.game, play.game) && candidate.market === play.market)',
    "match opposing trend side for net ROI",
)

replace_once(
    '  const slateRow = slateRows.find((row) => fbComparableGame(row.Game || `${row["Away Team"]} @ ${row["Home Team"]}`) === fbComparableGame(pick.game));',
    '  const slateRow = slateRows.find((row) => fbSameGame(row.Game || `${row["Away Team"]} @ ${row["Home Team"]}`, pick.game));',
    "match EZPZ pick to slate row",
)

time_anchor = '''function compactTimestamp(value?: string) {
  const raw = String(value || "").trim();
  return raw || "—";
}
'''
time_helpers = time_anchor + r'''

function displayFootballTime(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "TBD";
  const simple = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s+ET)?$/i);
  if (simple) return `${Number(simple[1])}:${simple[2]} ${simple[3].toUpperCase()}`;
  const stamp = Date.parse(raw);
  if (!Number.isFinite(stamp)) return raw;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(stamp));
}
'''
replace_once(time_anchor, time_helpers, "add Eastern-time display formatter")

replace_once(
    '  const timeLabel = trendPlay?.gameTime || String(slateRow?.["Game Time"] || slateRow?.Time || "TBD");',
    '  const timeLabel = displayFootballTime(trendPlay?.gameTime || String(slateRow?.["Game Time"] || slateRow?.Time || ""));',
    "format EZPZ card game time",
)

board.write_text(text)
print("Football EZPZ trend matching patch complete")
