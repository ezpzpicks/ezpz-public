import { runTursoAtomicSql, runTursoSql, type TursoRow } from "./tursoStore";
import { FOOTBALL_SIGNALS_TAB, signalRecord, type FootballSignalSide, type FootballSignalsBoard } from "./footballSignals";
import { reviewSituationRules, savedSituationRule, situationFinalWindow, situationWinners, situationPreviews, SITUATION_START_DATE, SITUATION_VERSION, usesSituationRules,
  type SituationPolicy, type SituationResult, type SituationSport } from "./situationRules";

const q = (value: unknown) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const source = (sport: SituationSport) => sport === "NFL" || sport === "NCAAF" ? FOOTBALL_SIGNALS_TAB : `${sport.toLowerCase()}_signal_observations`;
const clock = (value: string) => Date.parse((value || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"));
const missingTable = (error: unknown) => /no such table: (ezpz_situation_policy|ezpz_situation_picks)\b/i.test(String(error));

async function readRows(statements: string[]): Promise<TursoRow[][]> {
  try { return await runTursoSql(statements); }
  catch (error) { if (missingTable(error)) return statements.map(() => []); throw error; }
}

const policySql = (sport: SituationSport, date: string, previous = false) => `SELECT policy FROM ezpz_situation_policy
  WHERE sport=${q(sport)} AND date${previous ? "<" : "="}${q(date)} ORDER BY date DESC LIMIT 1`;

function parsePolicy(row: TursoRow | undefined): SituationPolicy | undefined {
  if (!row) return;
  const policy = JSON.parse(row.policy) as SituationPolicy;
  if (policy.version !== SITUATION_VERSION || !Array.isArray(policy.rules)) throw new Error("Saved EZPZ situation policy is invalid.");
  return policy;
}

export async function readSituationPolicy(sport: SituationSport, date: string) {
  const [rows] = await readRows([policySql(sport, date)]);
  return parsePolicy(rows[0]);
}

export async function reviewSituations(sport: SituationSport, date: string, now = Date.now()) {
  if (!usesSituationRules(sport, date)) return;
  const saved = await readSituationPolicy(sport, date);
  if (saved) return saved;
  const detail = `json_extract(payload_json,'$."Details JSON"')`;
  const [prior, rows] = await readRows([policySql(sport, date, true), `SELECT date_key AS date, r.result,
    json_extract(${detail},'$.gameKey') AS gameKey, json_extract(${detail},'$.snapshotAt') AS snapshotAt,
    json_extract(${detail},'$.situationQuote') AS quote, json_extract(payload_json,'$."Result Updated"') AS settledAt,
    json_extract(p.pick,'$.situationRuleId') AS officialRuleId FROM dataset_rows r INDEXED BY idx_dataset_rows_date
    LEFT JOIN ezpz_situation_picks p ON p.sport=r.sport AND p.date=r.date_key AND p.game_key=json_extract(${detail},'$.gameKey')
    WHERE r.sport=${q(sport)} AND dataset=${q(source(sport))} AND date_key>=${q(SITUATION_START_DATE)} AND date_key<${q(date)} AND r.result IN ('W','L','P')
    AND CASE WHEN json_valid(${detail}) THEN json_type(${detail},'$.situationQuote.ruleIds')='array'
      AND json_array_length(${detail},'$.situationQuote.ruleIds')>0
      AND json_extract(payload_json,'$."Captured At"')=json_extract(${detail},'$.snapshotAt')
      AND json_extract(payload_json,'$.Line')=CAST(json_extract(${detail},'$.line') AS TEXT) ELSE 0 END`]);
  const results = rows.flatMap(row => {
    const stamp = clock(row.settledAt);
    if (!(stamp >= clock(row.snapshotAt) && stamp <= now)) return [];
    return [{ date: row.date, gameKey: row.gameKey, snapshotAt: row.snapshotAt, result: row.result,
      quote: JSON.parse(row.quote), officialRuleId: row.officialRuleId } as SituationResult];
  });
  const policy = reviewSituationRules(sport, date, now, parsePolicy(prior[0]), results);
  await runTursoAtomicSql([
    `CREATE TABLE IF NOT EXISTS ezpz_situation_policy (sport TEXT, date TEXT, policy TEXT NOT NULL, PRIMARY KEY(sport,date))`,
    `CREATE TABLE IF NOT EXISTS ezpz_situation_picks (sport TEXT, date TEXT, game_key TEXT, side_id TEXT NOT NULL,
      snapshot_at TEXT NOT NULL, line TEXT NOT NULL, pick TEXT NOT NULL, result TEXT NOT NULL DEFAULT '',
      result_updated TEXT NOT NULL DEFAULT '', PRIMARY KEY(sport,date,game_key))`,
    `CREATE INDEX IF NOT EXISTS ezpz_situation_pending ON ezpz_situation_picks(sport,date) WHERE result=''`,
    `INSERT OR IGNORE INTO ezpz_situation_policy (sport,date,policy) VALUES (${q(sport)},${q(date)},${q(JSON.stringify(policy))})`,
  ]);
  return (await readSituationPolicy(sport, date))!;
}

const observationSql = (sport: SituationSport, date: string, id: string, snapshot: string, line: string) => `FROM dataset_rows r
  INDEXED BY idx_dataset_rows_date WHERE r.sport=${q(sport)} AND r.dataset=${q(source(sport))} AND r.date_key=${date}
  AND json_extract(r.payload_json,'$."Pick Key"')=${id} AND json_extract(r.payload_json,'$."Captured At"')=${snapshot}
  AND json_extract(r.payload_json,'$.Line')=${line}`;

// Grade the exact frozen line from the existing settled observation, once.
function settleSql(sport: SituationSport) {
  return `WITH pending AS MATERIALIZED (SELECT p.date,p.game_key,
    (SELECT json_object('result',r.result,'updated',json_extract(r.payload_json,'$."Result Updated"'))
    ${observationSql(sport, "p.date", "p.side_id", "p.snapshot_at", "p.line")} AND r.result IN ('W','L','P')
    ORDER BY r.row_index DESC LIMIT 1) AS grade
    FROM ezpz_situation_picks p WHERE p.sport=${q(sport)} AND p.result='')
    UPDATE ezpz_situation_picks AS p SET result=json_extract(pending.grade,'$.result'),
      result_updated=COALESCE(json_extract(pending.grade,'$.updated'),'') FROM pending
    WHERE p.sport=${q(sport)} AND p.date=pending.date AND p.game_key=pending.game_key AND pending.grade IS NOT NULL`;
}

function pendingSql(sport: SituationSport) {
  return `SELECT 1 FROM ezpz_situation_picks p WHERE p.sport=${q(sport)} AND p.result=''
    AND EXISTS (SELECT 1 ${observationSql(sport, "p.date", "p.side_id", "p.snapshot_at", "p.line")}
      AND r.result IN ('W','L','P')) LIMIT 1`;
}

function picksSql(sport: SituationSport, date: string) {
  return `SELECT pick,result,result_updated FROM ezpz_situation_picks
    WHERE sport=${q(sport)} AND date=${q(date)} ORDER BY game_key`;
}

function parsePicks(rows: TursoRow[], sport: SituationSport) {
  return rows.flatMap(row => {
    const side = JSON.parse(row.pick) as FootballSignalSide;
    return savedSituationRule(side, sport, Date.now())
      ? [{ ...side, result: row.result, resultUpdated: row.result_updated } as FootballSignalSide] : [];
  });
}

export async function readSituationPicks(sport: SituationSport, date: string) {
  const [rows] = await readRows([picksSql(sport, date)]);
  return parsePicks(rows, sport);
}

export function applySituationPicks(sides: FootballSignalSide[], picks: FootballSignalSide[]) {
  const saved = new Map(picks.map(side => [side.id, side]));
  const visible = sides.map(side => {
    const pick = saved.get(side.id);
    if (!pick) return side;
    saved.delete(side.id);
    return side.snapshotAt === pick.snapshotAt && side.line === pick.line ? { ...side, ...pick,
      publicMatches: side.publicMatches, teamGames: side.teamGames, marketContext: side.marketContext } : pick;
  });
  return [...visible, ...saved.values()];
}

export async function attachSituationBoard(board: FootballSignalsBoard, sport: string, capture = false): Promise<FootballSignalsBoard> {
  const date = board.today;
  if (!usesSituationRules(sport, date)) return board;
  if (capture && board.captureAvailable) {
    const now = Date.now();
    const finalAvailable = board.sides.some(side => side.date === date && side.situationQuote && side.recorded
      && clock(side.gameTime) > now && situationFinalWindow(side, now));
    const reviewDue = date === SITUATION_START_DATE || now >= Date.parse(`${date}T11:00:00Z`) || finalAvailable;
    const policy = reviewDue ? await reviewSituations(sport, date, now) : undefined;
    const [existing, pending] = await readRows([`SELECT game_key FROM ezpz_situation_picks WHERE sport=${q(sport)} AND date=${q(date)}`,
      pendingSql(sport)]);
    const locked = new Set(existing.map(row => row.game_key));
    const picks = policy ? situationWinners(board.sides, policy, Date.now()).filter(side => !locked.has(side.gameKey)) : [];
    const inserts = picks.map(side => {
      const { comboScore, ...pick } = side;
      const payload = { ...pick, publicMatches: [], teamGames: [], marketContext: { ...side.marketContext, history: [] } };
      const original = observationSql(sport, q(date), q(side.id), q(side.snapshotAt), q(side.line));
      return `INSERT OR IGNORE INTO ezpz_situation_picks (sport,date,game_key,side_id,snapshot_at,line,pick)
        SELECT ${q(sport)},${q(date)},${q(side.gameKey)},${q(side.id)},${q(side.snapshotAt)},${q(side.line)},${q(JSON.stringify(payload))}
        WHERE EXISTS (SELECT 1 ${original})`;
    });
    if (pending.length) inserts.push(settleSql(sport));
    if (inserts.length) await runTursoAtomicSql(inserts);
  }
  const [policies, current, history] = await readRows([policySql(sport, date), picksSql(sport, date),
    `SELECT p.date, json_extract(p.pick,'$.game') AS game, json_extract(p.pick,'$.selection') AS selection,
      json_extract(p.pick,'$.market') AS market, json_extract(p.pick,'$.odds') AS odds, json_extract(p.pick,'$.situationRuleId') AS ruleId,
      p.result, json_extract(p.pick,'$.gameTime') AS gameTime, p.side_id AS id
      FROM ezpz_situation_picks p WHERE p.sport=${q(sport)} AND p.date<=${q(date)}
      ORDER BY p.date DESC, json_extract(p.pick,'$.gameTime') DESC, p.game_key`]);
  const policy = parsePolicy(policies[0]);
  const picks = parsePicks(current, sport);
  const liveSides = board.sides.map(side => {
    if (!side.situationPending) return side;
    const { situationPending, situationRuleId, situationQuote, ...live } = side;
    return { ...live, selected: false };
  });
  const sides = applySituationPicks(liveSides, picks);
  const previews = policy && board.captureAvailable ? situationPreviews(sides, policy, Date.now()) : [];
  const rows = history.map(row => ({ date: row.date, game: row.game, selection: row.selection, market: row.market, odds: row.odds,
    ruleLabel: policy?.rules.find(rule => rule.id === row.ruleId)?.label, selectorVersion: SITUATION_VERSION,
    id: row.id, gameTime: row.gameTime, signalCount: 0, combination: "", result: row.result as FootballSignalSide["result"] }));
  const breakdowns = (policy?.rules || []).flatMap(rule => {
    const group = rows.filter(row => row.ruleLabel === rule.label);
    return group.length ? [{ dimension: "Play type", label: rule.label, record: signalRecord(group) }] : [];
  });
  return { ...board, situationPolicy: policy, sides: applySituationPicks(sides, previews), summary: signalRecord(rows),
    breakdowns, history: rows.slice(0, 200) };
}
