import { NextRequest, NextResponse } from "next/server";
import { patchTursoDatasetRows, readTursoDataset } from "../../../../lib/tursoStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;

function normalizedGameKey(row: Row) {
  return String(row["Game Key"] || row["Game ID"] || "").trim().replace(/\.0$/, "");
}

function recentRows(rows: Row[], limit = 12) {
  return rows.slice(Math.max(0, rows.length - limit));
}

function newest(rows: Row[]) {
  return rows.length ? rows[rows.length - 1] : null;
}

function compact(value: unknown) {
  return String(value ?? "").trim();
}

function oddsText(value: unknown) {
  const raw = compact(value);
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n > 0 ? `+${Math.trunc(n)}` : String(Math.trunc(n));
}

function percentText(value: unknown) {
  const raw = compact(value).replace("%", "");
  if (!raw) return "";
  let n = Number(raw);
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) <= 1) n *= 100;
  return `${Math.round(n * 10) / 10}%`;
}

function titleGrade(value: unknown) {
  return compact(value).toLowerCase();
}

function pitcherKey(value: unknown) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trackerForPitcher(rows: Row[], pitcher: string) {
  const target = pitcherKey(pitcher);
  if (!target) return null;
  return (
    rows.find((row) => {
      const candidate = pitcherKey(row.Selection || row.Pitcher || "");
      return candidate && candidate.includes(target);
    }) ||
    rows.find((row) => {
      const candidate = pitcherKey(row.Selection || row.Pitcher || "");
      return candidate && target.includes(candidate);
    }) ||
    null
  );
}

function projectionRepairFields(projection: Row | null) {
  const fields: Row = {};
  if (!projection) return fields;

  const copy = (target: string, source = target) => {
    const value = compact(projection[source]);
    if (value) fields[target] = value;
  };

  copy("ML Grade");
  copy("Model Version");
  copy("Correlation Block");
  copy("Correlation Play Count");
  copy("Correlation Reason");
  copy("Away Runs Projection");
  copy("Home Runs Projection");
  copy("Total Projection");
  copy("Raw Total Projection");
  copy("Calibrated Total Projection");
  copy("Total Grade");
  copy("Total Side");
  copy("Total Selected Odds");
  copy("Total Selection Basis");
  copy("Total Restriction Reason");
  copy("Total Confluence");
  copy("Total Shadow Grade");

  const better = compact(projection["Better ML"]);
  if (better) {
    const away = compact(projection["Away Team"]);
    const home = compact(projection["Home Team"]);
    const probability =
      better === away
        ? percentText(projection["Away Win Probability"])
        : better === home
          ? percentText(projection["Home Win Probability"])
          : "";
    fields["Better ML"] = probability ? `${better} (${probability})` : better;
  }

  const firstInningGrade = compact(projection["First Inning Grade"]);
  if (firstInningGrade) fields["NRFI Grade"] = firstInningGrade;
  const nrfiProbability = percentText(projection["NRFI Probability"]);
  if (nrfiProbability) fields["NRFI Probability"] = nrfiProbability;
  const totalProbability = percentText(projection["Total Selected Probability"]);
  if (totalProbability) fields["Total Selected Probability"] = totalProbability;

  return fields;
}

function matchupRepairFields(matchup: Row | null, trackerRows: Row[]) {
  const fields: Row = {};
  if (!matchup) return fields;

  let details: any = {};
  try {
    details = JSON.parse(compact(matchup["Details JSON"]) || "{}");
  } catch {
    details = {};
  }

  for (const [sideKey, prefix] of [["away", "Away"], ["home", "Home"]] as const) {
    const pitcher = details?.pitchers?.[sideKey];
    if (!pitcher || typeof pitcher !== "object") continue;

    const name = compact(pitcher.pitcher);
    const projected = Number(pitcher.expected_ks);
    const line = Number(pitcher.line);
    const odds = oddsText(pitcher.odds);
    const grade = compact(pitcher.grade);
    const score = Number(pitcher.k_score);
    const sixIp = Number(pitcher.six_ip_ks);
    const tracker = trackerForPitcher(trackerRows, name);

    if (name && Number.isFinite(projected) && Number.isFinite(line) && grade) {
      fields[`${prefix} Pitcher K + Grade`] =
        `${name} ${projected.toFixed(2)} (${titleGrade(grade)}) Line ${line} / ${odds}`;
    }
    if (Number.isFinite(score)) fields[`${prefix} Pitcher K Score`] = String(Math.round(score * 10) / 10);
    if (Number.isFinite(projected)) fields[`${prefix} Pitcher Most Likely K`] = String(Math.round(projected));
    if (Number.isFinite(sixIp)) fields[`${prefix} Pitcher 6 IP K`] = String(Math.round(sixIp * 100) / 100);
    if (odds) fields[`${prefix} Pitcher K Odds`] = odds;

    const probability =
      percentText(tracker?.["Selected Probability"]) ||
      percentText(pitcher.selected_probability) ||
      percentText(pitcher.probability);
    if (probability) fields[`${prefix} Pitcher K Probability`] = probability;

    const reliability =
      compact(tracker?.["Reliability Score"]) ||
      compact(pitcher.reliability_score) ||
      compact(pitcher.reliability);
    if (reliability) fields[`${prefix} Pitcher K Reliability`] = reliability;
  }

  return fields;
}

function repairPreview(row: Row | null) {
  if (!row) return null;
  const keys = [
    "Date", "Game Key", "Game Label", "Away Team", "Home Team", "Model Version",
    "Better ML", "ML Grade", "NRFI Grade", "NRFI Probability",
    "Total Grade", "Total Projection", "Total Side",
    "Away Pitcher K + Grade", "Away Pitcher K Score", "Away Pitcher K Probability", "Away Pitcher K Reliability",
    "Home Pitcher K + Grade", "Home Pitcher K Score", "Home Pitcher K Probability", "Home Pitcher K Reliability",
    "Public Data Status", "Public Data Updated",
  ];
  return Object.fromEntries(keys.map((key) => [key, compact(row[key])]));
}

export async function GET(request: NextRequest) {
  const gameKey = String(request.nextUrl.searchParams.get("gameKey") || "").trim().replace(/\.0$/, "");
  const repair = request.nextUrl.searchParams.get("repair") === "1";

  const datasets = [
    "matchup_details_today",
    "game_projection_history",
    "daily_slate",
    "bet_tracker",
    "all_game_trends",
    "pitcher_recent_form",
    "builder_completed",
  ] as const;
  const result: Record<string, Row[]> = {};

  await Promise.all(datasets.map(async (dataset) => {
    const rows = await readTursoDataset("MLB", dataset);
    result[dataset] = gameKey
      ? rows.filter((row) => normalizedGameKey(row) === gameKey)
      : recentRows(rows);
  }));

  let repairResult: Record<string, unknown> | null = null;
  if (repair) {
    if (!gameKey) {
      return NextResponse.json(
        { ok: false, error: "gameKey is required for repair" },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    const slateRow = newest(result.daily_slate);
    const projection = newest(result.game_projection_history);
    const matchup = newest(result.matchup_details_today);
    if (!slateRow) {
      return NextResponse.json(
        { ok: false, error: "No daily_slate row found for gameKey", gameKey },
        { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    const before = repairPreview(slateRow);
    const fields = {
      ...projectionRepairFields(projection),
      ...matchupRepairFields(matchup, result.bet_tracker),
    };

    await patchTursoDatasetRows("MLB", "daily_slate", [{ match: slateRow, fields }]);
    const refreshed = (await readTursoDataset("MLB", "daily_slate"))
      .filter((row) => normalizedGameKey(row) === gameKey);
    const after = repairPreview(newest(refreshed));

    repairResult = {
      patchedFieldCount: Object.keys(fields).length,
      before,
      after,
    };
    result.daily_slate = refreshed;
  }

  return NextResponse.json(
    {
      ok: true,
      gameKey: gameKey || null,
      mode: gameKey ? "game" : "recent",
      repair: repairResult,
      datasets: result,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
