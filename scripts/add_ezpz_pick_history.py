from pathlib import Path

PAGE = Path("app/page.tsx")
CSS = Path("app/globals.css")


def insert_after_once(text: str, anchor: str, addition: str, marker: str, label: str) -> str:
    if marker in text:
        print(f"{label}: already applied")
        return text
    if anchor not in text:
        raise SystemExit(f"Could not find patch anchor: {label}")
    print(f"{label}: applied")
    return text.replace(anchor, anchor + addition, 1)


def replace_once(text: str, old: str, new: str, marker: str, label: str) -> str:
    if marker in text:
        print(f"{label}: already applied")
        return text
    if old not in text:
        raise SystemExit(f"Could not find patch target: {label}")
    print(f"{label}: applied")
    return text.replace(old, new, 1)


page = PAGE.read_text()

page = insert_after_once(
    page,
    '  const [active, setActive] = useState<Tab>("Today’s Best Plays");\n',
    '  const [selectedEzpzDate, setSelectedEzpzDate] = useState("");\n',
    'const [selectedEzpzDate, setSelectedEzpzDate]',
    "Add EZPZ selected-date state",
)

page = insert_after_once(
    page,
    '  const activeLoadControllerRef = useRef<AbortController | null>(null);\n',
    '''\n  useEffect(() => {\n    if (data?.today) setSelectedEzpzDate(data.today);\n  }, [activeSport, data?.today]);\n''',
    'if (data?.today) setSelectedEzpzDate(data.today);',
    "Default EZPZ history date to current board date",
)

if 'const historicalEzpzPickMap = new Map<string, AiPick>();' not in page:
    start = page.find('    const aiPicks = (data.aiPicks || []).filter(')
    if start < 0:
        raise SystemExit("Could not find current EZPZ pick selector declaration")
    end = page.find('\n\n    if (active === "Today’s Best Plays") {', start)
    if end < 0:
        raise SystemExit("Could not find end of current EZPZ pick selector declaration")
    history_logic = '''    const currentEzpzDate = normalizedDateKey(data.today);\n    const activeEzpzDate = normalizedDateKey(selectedEzpzDate) || currentEzpzDate;\n    const historicalEzpzPickMap = new Map<string, AiPick>();\n    for (const pick of data.aiPickRecordRows || []) {\n      if (!pick.selected || pick.protectionStatus !== "PASSED") continue;\n      const dateKey = normalizedDateKey(pick.date);\n      if (!dateKey) continue;\n      const key = `${dateKey}|${pick.candidateId}`;\n      const existing = historicalEzpzPickMap.get(key);\n      const shouldReplace =\n        !existing ||\n        (pick.snapshotStatus === "FINAL_PREGAME" &&\n          existing.snapshotStatus !== "FINAL_PREGAME") ||\n        Boolean(pick.result && !existing.result);\n      if (shouldReplace) historicalEzpzPickMap.set(key, pick);\n    }\n    const historicalEzpzPicks = [...historicalEzpzPickMap.values()];\n    const availableEzpzDates = Array.from(\n      new Set([\n        currentEzpzDate,\n        ...historicalEzpzPicks.map((pick) => normalizedDateKey(pick.date)),\n      ]),\n    )\n      .filter((date): date is string => Boolean(date))\n      .sort((a, b) => b.localeCompare(a));\n    const aiPicks =\n      activeEzpzDate === currentEzpzDate\n        ? (data.aiPicks || []).filter(\n            (pick) => pick.selected && pick.protectionStatus === "PASSED",\n          )\n        : historicalEzpzPicks.filter(\n            (pick) => normalizedDateKey(pick.date) === activeEzpzDate,\n          );\n    const activeEzpzDateLabel = (() => {\n      const [year, month, day] = activeEzpzDate.split("-").map(Number);\n      if (!year || !month || !day) return activeEzpzDate || data.today;\n      return new Intl.DateTimeFormat("en-US", {\n        month: "long",\n        day: "numeric",\n        year: "numeric",\n      }).format(new Date(year, month - 1, day, 12));\n    })();'''
    page = page[:start] + history_logic + page[end:]
    print("Build current and historical EZPZ pick slates: applied")
else:
    print("Build current and historical EZPZ pick slates: already applied")

if 'className="ezpzHistoryDropdown"' not in page:
    search_from = page.find('const historicalEzpzPickMap = new Map<string, AiPick>();')
    start = page.find('    if (active === "EZPZ Picks") {', max(0, search_from))
    if start < 0:
        raise SystemExit("Could not find EZPZ Picks render block")
    end = page.find('\n\n    if (active === "Full Slate") {', start)
    if end < 0:
        raise SystemExit("Could not find end of EZPZ Picks render block")
    ezpz_block = '''    if (active === "EZPZ Picks") {\n      const viewingToday = activeEzpzDate === currentEzpzDate;\n      return (\n        <section>\n          <div className="sectionHead aiSelectorHead">\n            <div>\n              <h2>EZPZ Picks</h2>\n              <p className="aiSelectorStatusText">\n                {viewingToday\n                  ? data.aiSelectorStatus?.message ||\n                    "The selector is evaluating today’s Best Plays and Trend Plays with deterministic EZPZ gates."\n                  : `Showing the locked EZPZ Picks saved for ${activeEzpzDateLabel}. Final grading is shown on each pick.`}\n              </p>\n            </div>\n            <span className="countPill">{aiPicks.length} picks</span>\n          </div>\n\n          <details className="ezpzHistoryDropdown">\n            <summary className="ezpzHistorySummary">\n              <div>\n                <strong>Pick history</strong>\n                <span>\n                  {activeEzpzDateLabel} • {aiPicks.length} saved {aiPicks.length === 1 ? "pick" : "picks"}\n                </span>\n              </div>\n              <span className="ezpzHistoryAction">Choose date ▾</span>\n            </summary>\n            <div className="ezpzHistoryBody">\n              <label className="ezpzHistoryField">\n                <span>Calendar date</span>\n                <input\n                  type="date"\n                  value={activeEzpzDate}\n                  max={currentEzpzDate || undefined}\n                  onChange={(event) => setSelectedEzpzDate(event.target.value)}\n                />\n              </label>\n              <label className="ezpzHistoryField">\n                <span>Dates with saved picks</span>\n                <select\n                  value={availableEzpzDates.includes(activeEzpzDate) ? activeEzpzDate : ""}\n                  onChange={(event) => setSelectedEzpzDate(event.target.value)}\n                >\n                  {!availableEzpzDates.includes(activeEzpzDate) ? (\n                    <option value="" disabled>No saved picks on selected date</option>\n                  ) : null}\n                  {availableEzpzDates.map((date) => (\n                    <option key={date} value={date}>\n                      {date === currentEzpzDate ? `${date} — Today` : date}\n                    </option>\n                  ))}\n                </select>\n              </label>\n              {!viewingToday ? (\n                <button\n                  type="button"\n                  className="ezpzTodayBtn"\n                  onClick={() => setSelectedEzpzDate(currentEzpzDate)}\n                >\n                  Back to today\n                </button>\n              ) : null}\n            </div>\n          </details>\n\n          {aiPicks.length ? (\n            <div className="aiPickStack">\n              {aiPicks.map((pick) => {\n                const resultClass =\n                  pick.result === "W"\n                    ? "won"\n                    : pick.result === "L"\n                      ? "lost"\n                      : pick.result === "P"\n                        ? "push"\n                        : "pending";\n                const resultLabel =\n                  pick.result === "W"\n                    ? "WON"\n                    : pick.result === "L"\n                      ? "LOST"\n                      : pick.result === "P"\n                        ? "PUSH"\n                        : "PENDING";\n                return (\n                  <div\n                    className="aiPickHistoryItem"\n                    key={`${normalizedDateKey(pick.date)}-${pick.candidateId}`}\n                  >\n                    <div className={`aiPickResultStrip ${resultClass}`}>\n                      <span>{pick.result ? "Final result" : "Result"}</span>\n                      <strong>{resultLabel}</strong>\n                    </div>\n                    <AiPickSelectorCard\n                      pick={pick}\n                      todaySummary={\n                        viewingToday && pick.bestPlayType\n                          ? todayByType.get(normalizeType(pick.bestPlayType)) || null\n                          : null\n                      }\n                      last7DaysSummary={\n                        viewingToday && pick.bestPlayType\n                          ? recentByType.get(normalizeType(pick.bestPlayType)) || null\n                          : null\n                      }\n                      lastSevenBetsSummary={\n                        viewingToday && pick.bestPlayType\n                          ? lastSevenBetsByType.get(normalizeType(pick.bestPlayType)) || null\n                          : null\n                      }\n                      overallSummary={\n                        viewingToday && pick.bestPlayType\n                          ? overallByType.get(normalizeType(pick.bestPlayType)) || null\n                          : null\n                      }\n                      trendPlay={viewingToday ? aiTrendPlayForPick(pick, trendPlays) : null}\n                      trendPlays={viewingToday ? trendPlays : []}\n                      handpicked={\n                        viewingToday &&\n                        Boolean(\n                          favoriteRowMap.get(favoriteKeyFromAiPick(pick, data.today)),\n                        )\n                      }\n                    />\n                  </div>\n                );\n              })}\n            </div>\n          ) : (\n            <div className="empty">\n              {viewingToday\n                ? "No EZPZ Picks currently pass every selection and protection rule."\n                : `No EZPZ Picks were saved for ${activeEzpzDateLabel}. Choose another date from Pick history.`}\n            </div>\n          )}\n        </section>\n      );\n    }'''
    page = page[:start] + ezpz_block + page[end:]
    print("Add EZPZ history dropdown and result badges: applied")
else:
    print("Add EZPZ history dropdown and result badges: already applied")

page = replace_once(
    page,
    '    active,\n    bestPlays,',
    '    active,\n    selectedEzpzDate,\n    bestPlays,',
    '    selectedEzpzDate,\n    bestPlays,',
    "Add selected EZPZ date to memo dependencies",
)

PAGE.write_text(page)

css = CSS.read_text()
marker = "/* ===== EZPZ PICK HISTORY ===== */"
if marker not in css:
    css += r'''

/* ===== EZPZ PICK HISTORY ===== */
.ezpzHistoryDropdown {
  margin: 0 0 16px;
  border: 1px solid rgba(56, 189, 248, 0.22);
  border-radius: 18px;
  background: rgba(8, 20, 38, 0.72);
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.ezpzHistorySummary {
  cursor: pointer;
  list-style: none;
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  padding: 14px 16px;
}

.ezpzHistorySummary::-webkit-details-marker { display: none; }
.ezpzHistorySummary div { display: grid; gap: 3px; }
.ezpzHistorySummary strong { font-weight: 950; color: #e0f2fe; }
.ezpzHistorySummary span { color: var(--muted); font-size: .82rem; font-weight: 750; }
.ezpzHistoryAction { color: #7dd3fc !important; white-space: nowrap; font-weight: 900 !important; }

.ezpzHistoryBody {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
  padding: 14px 16px 16px;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(15, 23, 42, 0.5);
}

.ezpzHistoryField { display: grid; gap: 6px; }
.ezpzHistoryField > span {
  color: var(--muted);
  font-size: .72rem;
  font-weight: 900;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.ezpzHistoryField input,
.ezpzHistoryField select {
  width: 100%;
  min-height: 42px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  background: #0b1629;
  color: var(--text);
  padding: 9px 11px;
  font: inherit;
  font-weight: 800;
  color-scheme: dark;
}

.ezpzTodayBtn {
  min-height: 42px;
  cursor: pointer;
  border: 1px solid rgba(56, 189, 248, 0.34);
  border-radius: 12px;
  background: rgba(37, 99, 235, 0.18);
  color: #dbeafe;
  padding: 9px 13px;
  font-weight: 900;
}

.aiPickHistoryItem { display: grid; gap: 7px; }
.aiPickResultStrip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 13px;
  background: rgba(15, 23, 42, 0.82);
  font-size: .76rem;
  font-weight: 900;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.aiPickResultStrip span { color: var(--muted); }
.aiPickResultStrip strong { font-size: .8rem; }
.aiPickResultStrip.won { border-color: rgba(34, 197, 94, .45); background: rgba(34, 197, 94, .10); }
.aiPickResultStrip.won strong { color: #86efac; }
.aiPickResultStrip.lost { border-color: rgba(239, 68, 68, .45); background: rgba(239, 68, 68, .10); }
.aiPickResultStrip.lost strong { color: #fca5a5; }
.aiPickResultStrip.push { border-color: rgba(56, 189, 248, .40); background: rgba(56, 189, 248, .09); }
.aiPickResultStrip.push strong { color: #7dd3fc; }
.aiPickResultStrip.pending { border-color: rgba(245, 158, 11, .34); background: rgba(245, 158, 11, .08); }
.aiPickResultStrip.pending strong { color: #fcd34d; }

@media (max-width: 720px) {
  .ezpzHistoryBody { grid-template-columns: 1fr; }
  .ezpzHistorySummary { align-items: flex-start; }
  .ezpzHistoryAction { margin-top: 2px; }
}
'''
    CSS.write_text(css)
    print("Add EZPZ pick-history styles: applied")
else:
    print("Add EZPZ pick-history styles: already applied")
