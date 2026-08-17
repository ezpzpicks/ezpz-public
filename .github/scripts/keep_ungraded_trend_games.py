from pathlib import Path

path = Path("app/page.tsx")
text = path.read_text()

old = '''function trendSlateRow(
  group: TrendGameGroup,
  slateRows: SheetRow[],
): { row?: SheetRow; index: number } {
  const index = slateRows.findIndex((row) => {
    const teamsMatch =
      publicMatchKey(row["Away Team"]) === publicMatchKey(group.awayTeam) &&
      publicMatchKey(row["Home Team"]) === publicMatchKey(group.homeTeam);
    const rowDate = scheduleInfoForRow(row).dateKey;
    const sameDate = !group.date || !rowDate || group.date === rowDate;
    if (teamsMatch && sameDate) return true;

    const rowGame = firstValue(row, ["Game Label", "Game", "Matchup"]);
    return Boolean(
      sameDate && rowGame && publicMatchKey(rowGame) === publicMatchKey(group.game),
    );
  });

  return { row: index >= 0 ? slateRows[index] : undefined, index };
}
'''
new = '''function trendSlateRow(
  group: TrendGameGroup,
  slateRows: SheetRow[],
): { row?: SheetRow; index: number } {
  const groupSchedule = scheduleInfoFromRaw(group.gameTime, group.date);
  const index = slateRows.findIndex((row) => {
    const teamsMatch =
      publicMatchKey(row["Away Team"]) === publicMatchKey(group.awayTeam) &&
      publicMatchKey(row["Home Team"]) === publicMatchKey(group.homeTeam);
    const rowSchedule = scheduleInfoForRow(row);
    const rowDate = rowSchedule.dateKey;
    const sameDate = !group.date || !rowDate || group.date === rowDate;
    const sameTime =
      !Number.isFinite(groupSchedule.minutes) ||
      !Number.isFinite(rowSchedule.minutes) ||
      groupSchedule.minutes === rowSchedule.minutes;
    if (teamsMatch && sameDate && sameTime) return true;

    const rowGame = firstValue(row, ["Game Label", "Game", "Matchup"]);
    return Boolean(
      sameDate &&
        sameTime &&
        rowGame &&
        publicMatchKey(rowGame) === publicMatchKey(group.game),
    );
  });

  return { row: index >= 0 ? slateRows[index] : undefined, index };
}
'''
assert old in text, "trendSlateRow target not found"
text = text.replace(old, new, 1)

old = '''    grouped.set(key, {
      key,
      date,
      gameTime,
      game: play.game,
      awayTeam: play.awayTeam,
      homeTeam: play.homeTeam,
      plays: [play],
      topScore: 0,
      secondScore: 0,
      maxExactSample: trendExactSample(play),
    });
  });

  return [...grouped.values()]
'''
new = '''    grouped.set(key, {
      key,
      date,
      gameTime,
      game: play.game,
      awayTeam: play.awayTeam,
      homeTeam: play.homeTeam,
      plays: [play],
      topScore: 0,
      secondScore: 0,
      maxExactSample: trendExactSample(play),
    });
  });

  // Keep every saved slate game visible, even when every tracked side grades Pass.
  // Empty groups contain no qualified plays, so they never enter AI selection.
  slateRows.forEach((row) => {
    const awayTeam = firstValue(row, ["Away Team"]);
    const homeTeam = firstValue(row, ["Home Team"]);
    if (!awayTeam || !homeTeam) return;

    const schedule = scheduleInfoForRow(row, boardDate);
    const date = schedule.dateKey || normalizedDateKey(boardDate);
    const gameTime = firstValue(row, TREND_GAME_TIME_KEYS);
    const matchupKey = `${publicMatchKey(awayTeam)}|${publicMatchKey(homeTeam)}`;
    const timeKey = Number.isFinite(schedule.minutes) ? String(schedule.minutes) : "";
    const recordGameKey = String(row["Game Key"] || row["Game ID"] || "")
      .trim()
      .replace(/\\.0$/, "");
    const gameInstanceKey = timeKey || recordGameKey;
    const key = [date, matchupKey, gameInstanceKey].filter(Boolean).join("|");
    if (grouped.has(key)) return;

    grouped.set(key, {
      key,
      date,
      gameTime,
      game:
        firstValue(row, ["Game Label", "Game", "Matchup"]) ||
        `${awayTeam} at ${homeTeam}`,
      awayTeam,
      homeTeam,
      plays: [],
      topScore: 0,
      secondScore: 0,
      maxExactSample: 0,
    });
  });

  return [...grouped.values()]
'''
assert old in text, "group seeding target not found"
text = text.replace(old, new, 1)

old = '''    })
    .filter((group) => group.plays.length > 0)
    .sort((a, b) => {
'''
new = '''    })
    .sort((a, b) => {
'''
assert old in text, "empty-group filter target not found"
text = text.replace(old, new, 1)

old = '''      <div className="trendGameLeader">
        <div>
          <span className="trendGameLeaderLabel">Top trend in this game</span>
          <strong>{topPick}</strong>
          <small>{leader?.tier || "Pass"}</small>
        </div>
        <div className="trendGameLeaderScore">
          <span>TREND</span>
          <strong>{group.topScore}</strong>
        </div>
      </div>
'''
new = '''      <div className="trendGameLeader">
        <div>
          <span className="trendGameLeaderLabel">
            {leader ? "Top trend in this game" : "Trend status"}
          </span>
          <strong>{leader ? topPick : "No graded trend plays"}</strong>
          <small>{leader?.tier || "No current side qualifies"}</small>
        </div>
        <div className="trendGameLeaderScore">
          <span>TREND</span>
          <strong>{leader ? group.topScore : "—"}</strong>
        </div>
      </div>
'''
assert old in text, "trend card target not found"
text = text.replace(old, new, 1)

path.write_text(text)
