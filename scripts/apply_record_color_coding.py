from pathlib import Path
import re


def replace_function(path: Path, pattern: str, replacement: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        if "recordPerformanceRow" in text and "recordWinPctPill" in text:
            print(f"{label}: already applied")
            return
        raise RuntimeError(f"{label}: expected exactly one target, found {count}")
    path.write_text(updated, encoding="utf-8")
    print(f"{label}: updated")


page = Path("app/page.tsx")
football = Path("app/FootballBoardLegacy.tsx")
css = Path("app/globals.css")

main_table = r'''function RecordsTable\(\{ rows \}: \{ rows: Summary\[\] \}\) \{.*?\n\}\n\nfunction RecordsDropdown'''
main_replacement = '''function RecordsTable({ rows }: { rows: Summary[] }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Bet Type</th>
            <th>Status</th>
            <th>Record</th>
            <th>Win %</th>
            <th>Units</th>
            <th>ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = statusClass(row.wins, row.losses);
            return (
              <tr key={row.betType} className={`recordPerformanceRow ${tone}`}>
                <td>{row.betType}</td>
                <td>
                  <span className={`chip ${tone}`}>
                    {row.status}
                  </span>
                </td>
                <td>
                  {row.wins}-{row.losses}-{row.pushes}
                </td>
                <td>
                  <span className={`recordWinPctPill ${tone}`}>{row.winPct}%</span>
                </td>
                <td>{row.unitsWon}u</td>
                <td>{row.roiPct}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecordsDropdown'''
replace_function(page, main_table, main_replacement, "Shared/MLB records table")

football_table = r'''function FbRecordTable\(\{ rows \}: \{ rows: Summary\[\] \}\) \{.*?\n\}\n\nfunction FbRecordDropdown'''
football_replacement = '''function FbRecordTable({ rows }: { rows: Summary[] }) {
  return (
    <div className="tableWrap">
      <table className="recordsTable">
        <thead>
          <tr><th>Bet Type</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th><th>Bets</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = row.status === "WINNING" ? "green" : row.status === "LOSING" ? "red" : "yellow";
            return (
              <tr key={row.betType} className={`recordPerformanceRow ${tone}`}>
                <td><strong>{row.betType}</strong></td>
                <td>{row.record}</td>
                <td><span className={`recordWinPctPill ${tone}`}>{row.winPct.toFixed(1)}%</span></td>
                <td>{row.unitsWon > 0 ? "+" : ""}{row.unitsWon.toFixed(2)}u</td>
                <td>{row.roiPct > 0 ? "+" : ""}{row.roiPct.toFixed(1)}%</td>
                <td>{row.totalBets}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FbRecordDropdown'''
replace_function(football, football_table, football_replacement, "NFL/NCAAF records table")

marker = "/* ===== MLB-STYLE RECORD PERFORMANCE COLOR CODING ===== */"
styles = r'''

/* ===== MLB-STYLE RECORD PERFORMANCE COLOR CODING ===== */
/* Shared by MLB and football record tables so every sport uses the same visual language. */
.recordPerformanceRow td {
  position: relative;
  transition: background .16s ease, border-color .16s ease, box-shadow .16s ease;
}

.recordPerformanceRow.green td {
  background: linear-gradient(90deg, rgba(34, 197, 94, .15), rgba(34, 197, 94, .035));
  border-bottom-color: rgba(34, 197, 94, .20);
}

.recordPerformanceRow.yellow td {
  background: linear-gradient(90deg, rgba(245, 158, 11, .12), rgba(245, 158, 11, .025));
  border-bottom-color: rgba(245, 158, 11, .17);
}

.recordPerformanceRow.red td {
  background: linear-gradient(90deg, rgba(239, 68, 68, .14), rgba(239, 68, 68, .03));
  border-bottom-color: rgba(239, 68, 68, .19);
}

.recordPerformanceRow.green td:first-child {
  box-shadow: inset 4px 0 0 rgba(34, 197, 94, .92);
}

.recordPerformanceRow.yellow td:first-child {
  box-shadow: inset 4px 0 0 rgba(245, 158, 11, .90);
}

.recordPerformanceRow.red td:first-child {
  box-shadow: inset 4px 0 0 rgba(239, 68, 68, .94);
}

.recordWinPctPill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 74px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-weight: 950;
  letter-spacing: .01em;
  line-height: 1.15;
}

.recordWinPctPill.green {
  color: #bbf7d0;
  background: rgba(22, 101, 52, .24);
  border-color: rgba(34, 197, 94, .56);
  box-shadow: 0 0 16px rgba(34, 197, 94, .08), inset 0 1px 0 rgba(255,255,255,.04);
}

.recordWinPctPill.yellow {
  color: #fde68a;
  background: rgba(120, 53, 15, .20);
  border-color: rgba(245, 158, 11, .40);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
}

.recordWinPctPill.red {
  color: #fecaca;
  background: rgba(127, 29, 29, .23);
  border-color: rgba(239, 68, 68, .53);
  box-shadow: 0 0 16px rgba(239, 68, 68, .06), inset 0 1px 0 rgba(255,255,255,.03);
}

/* Keep the existing MLB status pills but harmonize them with the darker premium records styling. */
.recordPerformanceRow .chip {
  margin-top: 0;
  border: 1px solid transparent;
}
.recordPerformanceRow .chip.green {
  color: #bbf7d0;
  background: rgba(22, 101, 52, .24);
  border-color: rgba(34, 197, 94, .38);
}
.recordPerformanceRow .chip.yellow {
  color: #fde68a;
  background: rgba(120, 53, 15, .20);
  border-color: rgba(245, 158, 11, .34);
}
.recordPerformanceRow .chip.red {
  color: #fecaca;
  background: rgba(127, 29, 29, .23);
  border-color: rgba(239, 68, 68, .38);
}

@media (max-width: 700px) {
  .recordWinPctPill {
    min-width: 68px;
    padding: 5px 9px;
  }
  .recordPerformanceRow.green td:first-child,
  .recordPerformanceRow.yellow td:first-child,
  .recordPerformanceRow.red td:first-child {
    box-shadow: inset 3px 0 0 currentColor;
  }
  .recordPerformanceRow.green td:first-child { color: #e2e8f0; box-shadow: inset 3px 0 0 rgba(34,197,94,.92); }
  .recordPerformanceRow.yellow td:first-child { color: #e2e8f0; box-shadow: inset 3px 0 0 rgba(245,158,11,.90); }
  .recordPerformanceRow.red td:first-child { color: #e2e8f0; box-shadow: inset 3px 0 0 rgba(239,68,68,.94); }
}
'''
css_text = css.read_text(encoding="utf-8")
if marker not in css_text:
    css.write_text(css_text.rstrip() + styles + "\n", encoding="utf-8")
    print("Shared record color styles: appended")
else:
    print("Shared record color styles: already applied")

print("Record color coding patch completed.")
