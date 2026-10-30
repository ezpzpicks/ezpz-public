import { runTursoAtomicSql, runTursoSql } from "./tursoStore";
import type { SheetRow } from "./sportSheets";
import { TOTAL_FORWARD_POLICY, TOTAL_FORWARD_PARAMETERS, TOTAL_FORWARD_PARAMETER_HASH, TOTAL_FORWARD_PARAMETER_JSON,
  totalForwardGame, settleTotalForward, type TotalForwardGame, type TotalForwardPrediction } from "./ncaafTotalForwardPolicy";

const q = (value: unknown) => `'${String(value ?? "").replaceAll("'", "''")}'`;
let ready: Promise<void> | null = null;
async function initialize() {
  if (!ready) ready = (async () => {
    await runTursoAtomicSql([
      "CREATE TABLE IF NOT EXISTS ncaaf_total_forward_policies (policy TEXT PRIMARY KEY, parameter_hash TEXT NOT NULL, parameters_json TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS ncaaf_total_forward_games (policy TEXT NOT NULL, game_id TEXT NOT NULL, date_key TEXT NOT NULL, kickoff TEXT NOT NULL, captured_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(policy,game_id))",
      "CREATE TABLE IF NOT EXISTS ncaaf_total_forward_predictions (policy TEXT NOT NULL, game_id TEXT NOT NULL, strategy TEXT NOT NULL, date_key TEXT NOT NULL, kickoff TEXT NOT NULL, result TEXT NOT NULL DEFAULT '', units REAL, settled_at TEXT, actual_away REAL, actual_home REAL, payload_json TEXT NOT NULL, PRIMARY KEY(policy,game_id,strategy))",
      "CREATE INDEX IF NOT EXISTS idx_ncaaf_total_forward_pending ON ncaaf_total_forward_predictions(policy,result,kickoff)",
      "CREATE INDEX IF NOT EXISTS idx_ncaaf_total_forward_dates ON ncaaf_total_forward_predictions(policy,date_key DESC)",
      `INSERT OR IGNORE INTO ncaaf_total_forward_policies VALUES (${q(TOTAL_FORWARD_POLICY)},${q(TOTAL_FORWARD_PARAMETER_HASH)},${q(TOTAL_FORWARD_PARAMETER_JSON)})`,
    ]);
    const [rows] = await runTursoSql([`SELECT parameter_hash FROM ncaaf_total_forward_policies WHERE policy=${q(TOTAL_FORWARD_POLICY)}`]);
    if (rows[0]?.parameter_hash !== TOTAL_FORWARD_PARAMETER_HASH) throw new Error("NCAAF forward parameters changed without a new policy version.");
  })().catch(error => { ready = null; throw error; });
  return ready;
}
export function totalForwardCaptureSql(game: TotalForwardGame) {
  if (game.policy !== TOTAL_FORWARD_POLICY || game.parameterHash !== TOTAL_FORWARD_PARAMETER_HASH) throw new Error("Unexpected NCAAF forward policy.");
  const p = q(game.policy), id = q(game.gameId), day = q(game.date), start = q(game.kickoff), at = q(game.capturedAt), payload = q(JSON.stringify(game));
  const clockGuard = `datetime('now')>=datetime(${q(TOTAL_FORWARD_PARAMETERS.startedAt)}) AND datetime('now')<datetime(${start}) AND datetime(${at})<datetime(${start})`;
  const gate = `EXISTS(SELECT 1 FROM ncaaf_total_forward_games WHERE policy=${p} AND game_id=${id} AND captured_at=${at} AND payload_json=${payload}) AND ${clockGuard}`;
  return [
    `INSERT OR IGNORE INTO ncaaf_total_forward_games SELECT ${p},${id},${day},${start},${at},${payload} WHERE ${clockGuard}`,
    ...game.predictions.map(prediction => `INSERT OR IGNORE INTO ncaaf_total_forward_predictions (policy,game_id,strategy,date_key,kickoff,payload_json) SELECT ${p},${id},${q(prediction.strategy)},${day},${start},${q(JSON.stringify(prediction))} WHERE ${gate}`),
  ];
}
/** The existing scheduled snapshot job supplies frames it has already loaded. */
export async function captureNcaafTotalForward(slates: SheetRow[], schedule: SheetRow[], now = Date.now()) {
  await initialize();
  const scheduleById = new Map(schedule.map(row => [String(row["Game ID"] || ""), row]));
  const candidates = new Map<string, TotalForwardGame>();
  for (const row of slates) {
    const game = totalForwardGame(row, scheduleById.get(String(row["Game ID"] || "")) || {}, now);
    if (game && !candidates.has(game.gameId)) candidates.set(game.gameId, game);
    if (candidates.size >= 100) break;
  }
  let captured = 0;
  if (candidates.size) {
    const [existing] = await runTursoSql([`SELECT game_id FROM ncaaf_total_forward_games WHERE policy=${q(TOTAL_FORWARD_POLICY)} AND game_id IN (${[...candidates.keys()].map(q).join(",")})`]);
    const seen = new Set(existing.map(row => row.game_id));
    const fresh = [...candidates.values()].filter(game => !seen.has(game.gameId));
    if (fresh.length) {
      await runTursoAtomicSql(fresh.flatMap(totalForwardCaptureSql));
      const [confirmed] = await runTursoSql([`SELECT COUNT(*) AS n FROM ncaaf_total_forward_games WHERE policy=${q(TOTAL_FORWARD_POLICY)} AND captured_at=${q(new Date(now).toISOString())} AND game_id IN (${fresh.map(game => q(game.gameId)).join(",")})`]);
      captured = Number(confirmed[0]?.n || 0);
    }
  }
  const [pending] = await runTursoSql([`SELECT p.game_id,p.strategy,p.payload_json AS prediction_json,g.payload_json AS game_json FROM ncaaf_total_forward_predictions p JOIN ncaaf_total_forward_games g ON g.policy=p.policy AND g.game_id=p.game_id WHERE p.policy=${q(TOTAL_FORWARD_POLICY)} AND p.result='' AND p.kickoff<=${q(new Date(now).toISOString())} ORDER BY p.kickoff LIMIT 1000`]);
  const commands: string[] = [];
  for (const row of pending) {
    const game = JSON.parse(row.game_json) as TotalForwardGame, prediction = JSON.parse(row.prediction_json) as TotalForwardPrediction;
    const grade = settleTotalForward(game, prediction, scheduleById.get(row.game_id) || {}, now);
    if (!grade) continue;
    commands.push(`UPDATE ncaaf_total_forward_predictions SET result=${q(grade.result)},units=${grade.units},settled_at=${q(grade.settledAt)},actual_away=${grade.actualAway},actual_home=${grade.actualHome} WHERE policy=${q(TOTAL_FORWARD_POLICY)} AND game_id=${q(row.game_id)} AND strategy=${q(row.strategy)} AND result=''`);
  }
  if (commands.length) await runTursoAtomicSql(commands);
  return { policy: TOTAL_FORWARD_POLICY, capturedGames: captured, settledPredictions: commands.length, official: false };
}
/** Read-only summaries; paired controls are never pooled with candidates. */
export async function readNcaafTotalForward() {
  const [tables] = await runTursoSql(["SELECT name FROM sqlite_master WHERE type='table' AND name='ncaaf_total_forward_predictions'"]);
  const labels = { a_total_fade: "A Total Fade", a_total_original_control: "Original A Total (control)", b_total_original: "Original B Total" };
  if (!tables.length) return { ok: true, initialized: false, policy: TOTAL_FORWARD_PARAMETERS, strategies: [], recent: [] };
  const [totals, recent] = await runTursoSql([
    `SELECT strategy,COUNT(*) AS entries,SUM(CASE WHEN result='W' THEN 1 ELSE 0 END) AS wins,SUM(CASE WHEN result='L' THEN 1 ELSE 0 END) AS losses,SUM(CASE WHEN result='P' THEN 1 ELSE 0 END) AS pushes,SUM(CASE WHEN result='' THEN 1 ELSE 0 END) AS pending,COALESCE(SUM(units),0) AS units FROM ncaaf_total_forward_predictions WHERE policy=${q(TOTAL_FORWARD_POLICY)} GROUP BY strategy`,
    `SELECT p.strategy,p.result,p.units,p.settled_at,p.payload_json,g.payload_json AS game_json FROM ncaaf_total_forward_predictions p JOIN ncaaf_total_forward_games g ON g.policy=p.policy AND g.game_id=p.game_id WHERE p.policy=${q(TOTAL_FORWARD_POLICY)} ORDER BY p.date_key DESC,p.kickoff DESC,p.game_id,p.strategy LIMIT 100`,
  ]);
  return { ok: true, initialized: true, policy: TOTAL_FORWARD_PARAMETERS, parameterHash: TOTAL_FORWARD_PARAMETER_HASH,
    priceNote: "Paper returns at assumed -110 on the saved model line; actual opposite-side availability is not verified.", official: false, eligibleForPosting: false,
    strategies: Object.entries(labels).map(([strategy, label]) => {
      const row = totals.find(row => row.strategy === strategy) || {};
      const wins = Number(row.wins || 0), losses = Number(row.losses || 0), pushes = Number(row.pushes || 0), units = Number(row.units || 0);
      return { strategy, label, wins, losses, pushes, pending: Number(row.pending || 0), record: `${wins}-${losses}-${pushes}`,
        units: Math.round(units * 10000) / 10000, winPct: wins + losses ? 100 * wins / (wins + losses) : null,
        roiPct: wins + losses + pushes ? 100 * units / (wins + losses + pushes) : null };
    }),
    recent: recent.map(row => {
      const game = JSON.parse(row.game_json) as TotalForwardGame, prediction = JSON.parse(row.payload_json) as TotalForwardPrediction;
      return { ...prediction, policy: game.policy, gameId: game.gameId, date: game.date, game: game.game, kickoff: game.kickoff,
        capturedAt: game.capturedAt, modelVersion: game.modelVersion, originalSide: game.originalSide, edgePoints: game.edgePoints,
        result: row.result || "Pending", units: row.units === "" || row.units == null ? null : Number(row.units), settledAt: row.settled_at || null };
    }),
  };
}
