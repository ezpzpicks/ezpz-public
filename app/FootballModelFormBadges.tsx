"use client";

type SheetRow = Record<string, string>;
type Tone = "hot" | "cold" | "neutral" | "sample";

type Summary = {
  wins: number;
  losses: number;
  pushes: number;
  totalBets: number;
  winPct: number;
};

type Props = {
  rows?: SheetRow[];
  today?: string;
  grade?: unknown;
  market?: unknown;
  selection?: unknown;
  recordType?: unknown;
  qualification?: unknown;
  className?: string;
};

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/[^a-z0-9+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || String(new Date().getFullYear());
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function resultCode(value: unknown) {
  const valueKey = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(valueKey)) return "W";
  if (["L", "LOSS", "LOST"].includes(valueKey)) return "L";
  if (["P", "PUSH"].includes(valueKey)) return "P";
  return "";
}

function gradeBucket(value: unknown) {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/(?:^|[^A-Z])([AB])(?:[^A-Z]|$)/);
  return match?.[1] || "";
}

function marketLine(value: unknown) {
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\d+(?:\.\d+)?/g) || [];
  for (const raw of [...matches].reverse()) {
    const line = Number(raw);
    if (Number.isFinite(line) && Math.abs(line) <= 60) return line;
  }
  return null;
}

function explicitRecordType(...values: unknown[]) {
  const text = values.map((value) => String(value || "")).join(" ");
  const spread = text.match(/\b([AB])\s+Spread\s+(Favorite|Underdog)\b/i);
  if (spread) return `${spread[1].toUpperCase()} Spread ${spread[2][0].toUpperCase()}${spread[2].slice(1).toLowerCase()}`;
  const total = text.match(/\b([AB])\s+(?:Points\/Total|Total)\s+(Over|Under)\b/i);
  if (total) return `${total[1].toUpperCase()} Points/Total ${total[2][0].toUpperCase()}${total[2].slice(1).toLowerCase()}`;
  return "";
}

function targetRecordType({ grade, market, selection, recordType, qualification }: Pick<Props, "grade" | "market" | "selection" | "recordType" | "qualification">) {
  const explicit = explicitRecordType(recordType, qualification, grade);
  if (explicit) return explicit;

  const bucket = gradeBucket(grade);
  if (!bucket) return "";
  const marketKey = textKey(market);
  const selectionKey = textKey(selection);
  if (marketKey.includes("total")) {
    if (selectionKey.startsWith("over")) return `${bucket} Points/Total Over`;
    if (selectionKey.startsWith("under")) return `${bucket} Points/Total Under`;
    return "";
  }
  if (marketKey.includes("spread") || marketKey.includes("model play") || marketKey.includes("best play")) {
    const line = marketLine(selection);
    if (line == null || Math.abs(line) < 1e-9) return "";
    return `${bucket} Spread ${line < 0 ? "Favorite" : "Underdog"}`;
  }
  return "";
}

function rowRecordType(row: SheetRow) {
  const bucket = gradeBucket(row.Grade || row["Model Grade"] || row.Tier);
  if (!bucket) return "";
  const marketKey = textKey(row["Bet Type"] || row.Market);
  if (marketKey.includes("total")) {
    const side = textKey(row.Selection || row.Side || row.Pick);
    if (side.startsWith("over")) return `${bucket} Points/Total Over`;
    if (side.startsWith("under")) return `${bucket} Points/Total Under`;
    return "";
  }
  if (marketKey.includes("spread")) {
    const line = marketLine(row.Selection) ?? marketLine(row.Line) ?? marketLine(row["Odds/Line"]);
    if (line == null || Math.abs(line) < 1e-9) return "";
    return `${bucket} Spread ${line < 0 ? "Favorite" : "Underdog"}`;
  }
  return "";
}

function summarize(rows: SheetRow[]): Summary {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  for (const row of rows) {
    const result = resultCode(row.Result || row.Status);
    if (result === "W") wins += 1;
    else if (result === "L") losses += 1;
    else if (result === "P") pushes += 1;
  }
  const totalBets = wins + losses + pushes;
  const decisions = wins + losses;
  return { wins, losses, pushes, totalBets, winPct: decisions ? (wins / decisions) * 100 : 0 };
}

function formInfo(summary: Summary, window: "days" | "bets"): { icon: string; label: string; tone: Tone; detail: string } {
  const record = `${summary.wins}-${summary.losses}-${summary.pushes}`;
  if (window === "bets") {
    if (summary.totalBets < 7) return { icon: "➖", label: "Need 7 Bets", tone: "sample", detail: `${record} • ${summary.totalBets}/7 completed` };
    if (summary.wins >= 5) return { icon: "🔥", label: "Hot", tone: "hot", detail: `${record} most recent` };
    if (summary.losses >= 5) return { icon: "❄️", label: "Cold", tone: "cold", detail: `${record} most recent` };
    return { icon: "➖", label: "Neutral", tone: "neutral", detail: `${record} most recent` };
  }
  if (summary.totalBets < 5) return { icon: "⚠️", label: "Small Sample", tone: "sample", detail: `${record} • ${summary.totalBets}/5 minimum` };
  if (summary.wins > summary.losses && summary.winPct >= 60) return { icon: "🔥", label: "Hot", tone: "hot", detail: `${record} in 7 days` };
  if (summary.losses > summary.wins && summary.winPct <= 40) return { icon: "❄️", label: "Cold", tone: "cold", detail: `${record} in 7 days` };
  return { icon: "➖", label: "Neutral", tone: "neutral", detail: `${record} in 7 days` };
}

export default function FootballModelFormBadges(props: Props) {
  const recordType = targetRecordType(props);
  if (!recordType) return null;

  const reference = isoDate(props.today) || new Date().toISOString().slice(0, 10);
  const completed = (props.rows || [])
    .map((row, index) => ({ row, index, date: isoDate(row.Date || row["Game Date"]), type: rowRecordType(row) }))
    .filter((item) => item.type === recordType && item.date && resultCode(item.row.Result || item.row.Status));

  const lastSevenDaysRows = completed
    .filter((item) => {
      const diff = Math.round((Date.parse(`${reference}T12:00:00Z`) - Date.parse(`${item.date}T12:00:00Z`)) / 86_400_000);
      return Number.isFinite(diff) && diff >= 0 && diff < 7;
    })
    .map((item) => item.row);

  const lastSevenBetRows = [...completed]
    .sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index)
    .slice(0, 7)
    .map((item) => item.row);

  const days = formInfo(summarize(lastSevenDaysRows), "days");
  const bets = formInfo(summarize(lastSevenBetRows), "bets");

  return (
    <div className={`footballMlbFormRow ${props.className || ""}`}>
      <span className={`footballMlbFormPill ${days.tone}`}>{days.icon} 7 Days: <b>{days.label}</b><em> • {days.detail}</em></span>
      <span className={`footballMlbFormPill ${bets.tone}`}>{bets.icon} Last 7 Bets: <b>{bets.label}</b><em> • {bets.detail}</em></span>
      <style jsx>{`
        .footballMlbFormRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;margin-top:11px}
        .footballMlbFormPill{display:inline-flex;align-items:center;gap:3px;max-width:100%;border:1px solid rgba(112,145,186,.2);border-radius:999px;padding:7px 11px;color:#cbd5e1;background:rgba(100,120,146,.1);font-size:.72rem;font-weight:800;line-height:1.2;white-space:normal}
        .footballMlbFormPill b{font-weight:950}.footballMlbFormPill em{font-style:normal;opacity:.78;font-weight:750}
        .footballMlbFormPill.hot{color:#fed7aa;border-color:rgba(249,115,22,.26);background:rgba(249,115,22,.11)}
        .footballMlbFormPill.cold{color:#bae6fd;border-color:rgba(56,189,248,.26);background:rgba(56,189,248,.11)}
        .footballMlbFormPill.neutral{color:#cbd5e1;border-color:rgba(148,163,184,.17);background:rgba(148,163,184,.08)}
        .footballMlbFormPill.sample{color:#fde3a7;border-color:rgba(245,158,11,.27);background:rgba(245,158,11,.09)}
        @media(max-width:620px){.footballMlbFormRow{display:grid;grid-template-columns:1fr;gap:7px}.footballMlbFormPill{width:max-content;max-width:100%}}
      `}</style>
    </div>
  );
}
