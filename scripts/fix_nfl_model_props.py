from pathlib import Path

PUBLIC = Path("lib/footballPublicData.ts")
BOARD = Path("app/FootballBoard.tsx")

public = PUBLIC.read_text()
board = BOARD.read_text()

old_best = '''function bestPlays(slate:SheetRow[],sport:FootballSport){
  const plays:any[]=[];for(const row of slate){const game=String(row.Game||`${row["Away Team"]} @ ${row["Home Team"]}`),away=String(row["Away Team"]||""),home=String(row["Home Team"]||"");
    const sg=String(row["Spread Grade"]||"");if(sg&&sg!=="No Play"){const pick=String(row["Spread Pick"]||"");plays.push({playType:sg,game,play:pick,oddsLine:String(row["Spread Odds"]||row["Market Home Spread"]||""),score:String(row["Spread Probability"]||""),isGreen:true,awayTeam:away,homeTeam:home,reliability:row.Reliability,selectedProbability:row["Spread Probability"],modelVersion:row["Model Version"],role:"Spread",publicBetsPct:row["Spread Public Bets %"],publicMoneyPct:row["Spread Public Money %"]});}
    const tg=String(row["Total Grade"]||"");if(tg&&tg!=="No Play"){plays.push({playType:tg,game,play:String(row["Total Pick"]||""),oddsLine:String(row["Total Odds"]||row["Market Total"]||""),score:String(row["Total Probability"]||""),isGreen:true,awayTeam:away,homeTeam:home,reliability:row.Reliability,selectedProbability:row["Total Probability"],modelVersion:row["Model Version"],role:"Total"});}
  }return plays;
}
'''

new_best = '''function qualifiedFootballModelGrade(value: unknown) {
  const grade = textKey(value);
  return Boolean(grade) &&
    !grade.includes("no play") &&
    !grade.includes("non edge") &&
    grade !== "research" &&
    grade !== "projection only" &&
    grade !== "no market line";
}

function qualifiedNflPropGrade(value: unknown) {
  const grade = textKey(value);
  return grade === "a prop" || grade === "b prop";
}

function playerPropTeams(row: SheetRow) {
  const game = String(row.Game || "").trim();
  const parts = game.split(/\\s+(?:@|at)\\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) return { away: parts[0], home: parts[1] };
  const team = String(row.Team || "").trim();
  const opponent = String(row.Opponent || "").trim();
  return textKey(row["Home/Away"]) === "home"
    ? { away: opponent, home: team }
    : { away: team, home: opponent };
}

function bestPlays(slate:SheetRow[],sport:FootballSport){
  const plays:any[]=[];for(const row of slate){const game=String(row.Game||`${row["Away Team"]} @ ${row["Home Team"]}`),away=String(row["Away Team"]||""),home=String(row["Home Team"]||"");
    const sg=String(row["Spread Grade"]||"");if(qualifiedFootballModelGrade(sg)){const pick=String(row["Spread Pick"]||"");plays.push({playType:sg,game,play:pick,oddsLine:String(row["Spread Odds"]||row["Market Home Spread"]||""),score:String(row["Spread Probability"]||""),isGreen:true,awayTeam:away,homeTeam:home,reliability:row.Reliability,selectedProbability:row["Spread Probability"],modelVersion:row["Model Version"],role:"Spread",publicBetsPct:row["Spread Public Bets %"],publicMoneyPct:row["Spread Public Money %"]});}
    const tg=String(row["Total Grade"]||"");if(qualifiedFootballModelGrade(tg)){plays.push({playType:tg,game,play:String(row["Total Pick"]||""),oddsLine:String(row["Total Odds"]||row["Market Total"]||""),score:String(row["Total Probability"]||""),isGreen:true,awayTeam:away,homeTeam:home,reliability:row.Reliability,selectedProbability:row["Total Probability"],modelVersion:row["Model Version"],role:"Total"});}
  }return plays;
}

function nflPlayerPropBestPlays(propRows: SheetRow[], slate: SheetRow[], today: string) {
  return propRows
    .filter((row) => isoDate(row.Date || row["Game Date"] || "") === today)
    .filter((row) => qualifiedNflPropGrade(row.Grade))
    .filter((row) => {
      const gameId = String(row["Game ID"] || row["Game Key"] || "").trim();
      const teams = playerPropTeams(row);
      return slate.some((game) => {
        const slateId = String(game["Game ID"] || game["Game Key"] || "").trim();
        if (gameId && slateId && gameId === slateId) return true;
        return sameTeam(teams.away, game["Away Team"], "NFL") && sameTeam(teams.home, game["Home Team"], "NFL");
      });
    })
    .map((row) => {
      const teams = playerPropTeams(row);
      const market = String(row.Market || "Player Prop").trim();
      const player = String(row.Player || "").trim();
      const pick = String(row.Pick || "").trim();
      const grade = String(row.Grade || "").trim();
      return {
        playType: grade,
        game: `${teams.away} @ ${teams.home}`,
        play: `${player} ${market} ${pick}`.replace(/\\s+/g, " ").trim(),
        oddsLine: String(row["Pick Odds"] || ""),
        score: String(row["Model Probability"] || ""),
        isGreen: true,
        awayTeam: teams.away,
        homeTeam: teams.home,
        reliability: row.Reliability,
        selectedProbability: row["Model Probability"],
        modelVersion: row["Model Version"],
        role: `Player Prop • ${market}`,
      };
    })
    .sort((a, b) => {
      const gradeRank = (value: unknown) => textKey(value) === "a prop" ? 2 : 1;
      const gradeDiff = gradeRank(b.playType) - gradeRank(a.playType);
      if (gradeDiff) return gradeDiff;
      return Number(b.score || 0) - Number(a.score || 0);
    });
}
'''

if old_best not in public:
    raise SystemExit("Expected bestPlays block not found")
public = public.replace(old_best, new_best, 1)

old_reads = 'const [slateAll,trackerRaw,schedule,trendExisting,snapshotExisting]=await Promise.all([readSportWorksheet(sport,"daily_slate"),readSportWorksheet(sport,"bet_tracker"),readSportWorksheet(sport,"schedule"),readSportWorksheet(sport,"all_game_trends",ALL_GAME_TRENDS_HEADERS),readSportWorksheet(sport,"public_split_snapshots",PUBLIC_SPLIT_HEADERS)]);'
new_reads = 'const [slateAll,trackerRaw,schedule,trendExisting,snapshotExisting,propProjectionRows]=await Promise.all([readSportWorksheet(sport,"daily_slate"),readSportWorksheet(sport,"bet_tracker"),readSportWorksheet(sport,"schedule"),readSportWorksheet(sport,"all_game_trends",ALL_GAME_TRENDS_HEADERS),readSportWorksheet(sport,"public_split_snapshots",PUBLIC_SPLIT_HEADERS),sport==="NFL"?readSportWorksheet(sport,"prop_projections"):Promise.resolve([] as SheetRow[])]);'
if old_reads not in public:
    raise SystemExit("Expected worksheet read block not found")
public = public.replace(old_reads, new_reads, 1)

old_best_use = '''  const best=bestPlays(todaySlate,sport);
  const aiPicks=buildFootballEzpzPicks(best,todayTrendPlays,tracker,todayEnriched,sport);'''
new_best_use = '''  const modelBest=bestPlays(todaySlate,sport);
  const propBest=sport==="NFL"?nflPlayerPropBestPlays(propProjectionRows,todaySlate,today):[];
  const best=[...modelBest,...propBest];
  const aiPicks=buildFootballEzpzPicks(modelBest,todayTrendPlays,tracker,todayEnriched,sport);'''
if old_best_use not in public:
    raise SystemExit("Expected best-play use block not found")
public = public.replace(old_best_use, new_best_use, 1)

expected_spread_qualified = public.count('spreadGrade!=="No Play"')
expected_total_qualified = public.count('totalGrade!=="No Play"')
if expected_spread_qualified != 2 or expected_total_qualified != 2:
    raise SystemExit(f"Unexpected trend qualification counts: spread={expected_spread_qualified}, total={expected_total_qualified}")
public = public.replace('spreadGrade!=="No Play"', 'qualifiedFootballModelGrade(spreadGrade)')
public = public.replace('totalGrade!=="No Play"', 'qualifiedFootballModelGrade(totalGrade)')

old_candidate = 'candidateCount:best.length+todayTrendPlays.length'
if old_candidate not in public:
    raise SystemExit("Expected candidateCount expression not found")
public = public.replace(old_candidate, 'candidateCount:modelBest.length+todayTrendPlays.length', 1)

old_card_head = '''function BestPlayCard({ play, splits, index, sport, recentByType, lastSevenBetsByType }: { play: Play; splits: DraftKingsSplit[]; index: number; sport: Sport; recentByType: Map<string, Summary>; lastSevenBetsByType: Map<string, Summary> }) {
  const split = selectedSplit(play, splits);
  const roleKey = textKey(play.role || play.playType);
  const market = roleKey.includes("total") ? "Total" : "Spread";
  const recordType = fbBestPlayRecordType(play, split, sport);'''
new_card_head = '''function BestPlayCard({ play, splits, index, sport, recentByType, lastSevenBetsByType }: { play: Play; splits: DraftKingsSplit[]; index: number; sport: Sport; recentByType: Map<string, Summary>; lastSevenBetsByType: Map<string, Summary> }) {
  const roleKey = textKey(play.role || play.playType);
  const isPlayerProp = roleKey.includes("player prop");
  const split = isPlayerProp ? undefined : selectedSplit(play, splits);
  const market = isPlayerProp ? "Player Prop" : roleKey.includes("total") ? "Total" : "Spread";
  const recordType = isPlayerProp ? "" : fbBestPlayRecordType(play, split, sport);'''
if old_card_head not in board:
    raise SystemExit("Expected BestPlayCard header not found")
board = board.replace(old_card_head, new_card_head, 1)

old_pending = '<span>DraftKings selected-side split pending</span>'
if old_pending not in board:
    raise SystemExit("Expected split pending label not found")
board = board.replace(old_pending, '<span>{isPlayerProp ? "Player prop market" : "DraftKings selected-side split pending"}</span>', 1)

old_footer_model = '<span>{recordType || "Regression model"}</span>'
if old_footer_model not in board:
    raise SystemExit("Expected card model footer not found")
board = board.replace(old_footer_model, '<span>{recordType || (isPlayerProp ? "NFL player prop model" : "Regression model")}</span>', 1)

old_footer_workflow = '<span>Spread + Total workflow</span>'
if old_footer_workflow not in board:
    raise SystemExit("Expected workflow footer not found")
board = board.replace(old_footer_workflow, '<span>{isPlayerProp ? "Player prop workflow" : "Spread + Total workflow"}</span>', 1)

PUBLIC.write_text(public)
BOARD.write_text(board)

print("NFL model plays now include A/B props and exclude Non-Edge grades.")
