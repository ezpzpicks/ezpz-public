import { readTursoDatasetByDateKeys, runTursoAtomicSql, type TursoRow } from "./tursoStore";
import { nbaRowKey } from "./nbaMarketCore";

const q = (value: unknown) => `'${String(value ?? "").replaceAll("'", "''")}'`;

/** Date-indexed, atomic upserts. Unrelated dates and builder rows stay intact. */
export async function saveNbaMarketRows(dataset: string, rows: TursoRow[], history = false) {
  if (!rows.length) return;
  const dates = [...new Set(rows.map(r => r.Date))];
  const existing = await readTursoDatasetByDateKeys("NBA", dataset, dates);
  const key = (r: TursoRow) => nbaRowKey(r) + (history ? `|${r["Snapshot Time ET"]}` : "");
  const canonical = (r: TursoRow) => JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a],[b]) => a.localeCompare(b))));
  const before = new Map(existing.map(r => [key(r), canonical(r)]));
  const previousRows = new Map(existing.map(r => [key(r), r]));
  const changed = rows.filter(r => before.get(key(r)) !== canonical(r));
  if (!changed.length) return;
  const statements: string[] = [];
  for (const row of changed) {
    const identity = `sport='NBA' AND dataset=${q(dataset)} AND date_key=${q(row.Date)} AND game_key=${q(row["Game Key"] || row["Game ID"])} AND market=${q(row.Market)} AND selection=${q(row.Selection)}`
      + (history ? ` AND snapshot_time=${q(row["Snapshot Time ET"])}` : "");
    const saved = new Date().toISOString(), payload = canonical(row);
    const values = ["'NBA'", q(dataset), `(SELECT COALESCE(MAX(row_index),0)+1 FROM dataset_rows WHERE sport='NBA' AND dataset=${q(dataset)})`,
      q(payload), "''", q(row.Date), q(row["Game Key"] || row["Game ID"]), q(row.Game), q(row.Market), q(row.Selection),
      q(row.Result || row.Status), q(row["Snapshot Time ET"]), q(saved)];
    statements.push(`INSERT INTO dataset_rows (sport,dataset,row_index,payload_json,source_hash,date_key,game_key,game,market,selection,result,snapshot_time,imported_at) SELECT ${values.join(",")} WHERE NOT EXISTS (SELECT 1 FROM dataset_rows WHERE ${identity})`);
    // Keep stable indexed identity columns out of ordinary freshness updates.
    const old = previousRows.get(key(row));
    const resultUpdate = (old?.Result || old?.Status || "") !== (row.Result || row.Status || "") ? `,result=${q(row.Result || row.Status)}` : "";
    statements.push(`UPDATE dataset_rows SET payload_json=${q(payload)},source_hash='',imported_at=${q(saved)}${resultUpdate} WHERE ${identity} AND payload_json!=${q(payload)}`);
  }
  const headers = [...new Set(rows.flatMap(Object.keys))];
  // These append/upsert-only datasets allocate contiguous positions under the
  // write lock. MAX uses the primary index, rather than COUNTing season archives.
  statements.push(`INSERT INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES ('NBA',${q(dataset)},'turso-native',${q(dataset)},${q(JSON.stringify(headers))},(SELECT COALESCE(MAX(row_index),0) FROM dataset_rows WHERE sport='NBA' AND dataset=${q(dataset)}),${q(new Date().toISOString())},'turso') ON CONFLICT(sport,dataset) DO UPDATE SET headers_json=excluded.headers_json,row_count=excluded.row_count,imported_at=excluded.imported_at`);
  await runTursoAtomicSql(statements);
}
